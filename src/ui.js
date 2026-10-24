export function createUI(model, dispatch, { focusAssembly = () => false } = {}) {
  const listenerController = new AbortController();
  const { signal } = listenerController;
  let disposed = false;
  const assemblyTree = document.querySelector('#assembly-tree');
  const details = document.querySelector('#part-details');
  const modeButtons = Array.from(document.querySelectorAll('[data-mode]'));
  const axisButtons = Array.from(document.querySelectorAll('[data-axis]'));
  const assemblyButtons = [];
  const rangePanels = document.querySelector('.range-panels');
  const parameterPanels = {
    exploded: document.querySelector('#explosion-control'),
    shell: document.querySelector('#shell-control'),
    section: document.querySelector('#section-control')
  };

  for (const [index, [id, assembly]] of Array.from(model.assemblies.entries()).entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.assembly = id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `聚焦${assembly.name}`);

    const number = document.createElement('span');
    number.className = 'assembly-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'assembly-name';
    name.textContent = assembly.name;
    const count = document.createElement('span');
    count.className = 'assembly-count';
    const partCount = Array.from(model.parts.values()).filter(part => part.assembly === id).length;
    count.textContent = `${partCount} 件`;
    count.setAttribute('aria-hidden', 'true');

    button.append(number, name, count);
    button.addEventListener('click', () => focusAssembly(id), { signal });
    assemblyTree.appendChild(button);
    assemblyButtons.push(button);
  }

  const emptyHint = document.querySelector('#assembly-panel .panel-empty');
  emptyHint.textContent = '点击总成聚焦观察，点击模型零件查看说明';

  for (const button of modeButtons) {
    button.type = 'button';
    button.addEventListener('click', () => dispatch({ type: 'SET_MODE', mode: button.dataset.mode }), { signal });
  }
  for (const button of axisButtons) {
    button.type = 'button';
    button.setAttribute('aria-label', `${button.dataset.axis.toUpperCase()} 轴剖切`);
    button.addEventListener('click', () => dispatch({ type: 'SET_CLIP_AXIS', axis: button.dataset.axis }), { signal });
  }

  function bindRange(id, actionType, scale) {
    const input = document.querySelector(`#${id}`);
    const output = document.querySelector(`#${id === 'clip-position' ? 'clip' : id}-value`);
    output.setAttribute('for', id);
    input.addEventListener('input', () => {
      dispatch({ type: actionType, value: Number(input.value) / scale });
    }, { signal });
    return input;
  }

  const explosionInput = bindRange('explosion', 'SET_EXPLOSION', 100);
  const shellInput = bindRange('shell', 'SET_SHELL_TRANSPARENCY', 100);
  const clipInput = bindRange('clip-position', 'SET_CLIP_POSITION', 100);
  document.querySelector('#reset-view').type = 'button';
  document.querySelector('#reset-view').addEventListener('click', () => dispatch({ type: 'RESET' }), { signal });

  function showPart(partId) {
    const part = partId ? model.parts.get(partId) : null;
    const icon = document.createElement('span');
    icon.className = 'details-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = part ? 'i' : 'i';
    const content = document.createElement('div');
    content.className = 'details-content';
    const kicker = document.createElement('p');
    kicker.className = 'panel-index';
    kicker.textContent = 'COMPONENT INSPECTOR';
    content.appendChild(kicker);

    if (part) {
      const title = document.createElement('h2');
      title.className = 'part-name';
      title.textContent = part.name;
      const assembly = document.createElement('p');
      assembly.className = 'part-assembly';
      assembly.textContent = `所属总成：${model.assemblies.get(part.assembly)?.name ?? part.assembly}`;
      const description = document.createElement('p');
      description.className = 'part-description';
      description.textContent = part.description;
      content.append(title, assembly, description);
      details.dataset.partId = part.id;
    } else {
      const hint = document.createElement('p');
      hint.className = 'details-hint';
      hint.textContent = '点击零件查看结构说明';
      content.appendChild(hint);
      delete details.dataset.partId;
    }
    details.replaceChildren(icon, content);
  }

  const mobile = window.matchMedia('(max-width: 760px)');
  const panelControllers = [];

  function setPanelExpanded(controller, expanded) {
    controller.panel.classList.toggle('is-collapsed', !expanded);
    controller.button.setAttribute('aria-expanded', String(expanded));
    controller.button.textContent = expanded ? '收起' : '展开';
    controller.button.setAttribute('aria-label', `${expanded ? '收起' : '展开'}${controller.label}`);
    controller.content.hidden = !expanded;
  }

  function makeCollapsible(panelId, label) {
    const panel = document.querySelector(panelId);
    const heading = panel.querySelector('.panel-heading');
    const content = document.createElement('div');
    content.id = `${panel.id}-content`;
    content.className = 'panel-content';
    for (const child of Array.from(panel.children)) {
      if (child !== heading) content.appendChild(child);
    }
    panel.appendChild(content);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-toggle';
    button.setAttribute('aria-controls', content.id);
    heading.appendChild(button);
    const controller = { panel, heading, content, button, label };
    panelControllers.push(controller);
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      if (expanded && mobile.matches) {
        for (const other of panelControllers) {
          if (other !== controller) setPanelExpanded(other, false);
        }
      }
      setPanelExpanded(controller, expanded);
    }, { signal });
  }

  makeCollapsible('#assembly-panel', '总成层级面板');
  makeCollapsible('#control-panel', '结构展示面板');

  function syncPanelsToViewport() {
    for (const controller of panelControllers) setPanelExpanded(controller, !mobile.matches);
  }
  mobile.addEventListener('change', syncPanelsToViewport, { signal });
  syncPanelsToViewport();

  let renderedPart;

  function render(state) {
    for (const button of modeButtons) {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of axisButtons) {
      const active = button.dataset.axis === state.clipAxis;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of assemblyButtons) {
      const active = button.dataset.assembly === state.focusedAssembly;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    rangePanels.hidden = state.mode === 'assembly';
    for (const [mode, panel] of Object.entries(parameterPanels)) panel.hidden = state.mode !== mode;

    explosionInput.value = String(Math.round(state.explosion * 100));
    shellInput.value = String(Math.round(state.shellTransparency * 100));
    clipInput.value = String(Math.round(state.clipPosition * 100));
    document.querySelector('#explosion-value').textContent = `${explosionInput.value}%`;
    document.querySelector('#shell-value').textContent = `${shellInput.value}%`;
    document.querySelector('#clip-value').textContent = state.clipPosition.toFixed(2);

    if (renderedPart !== state.selectedPart) {
      renderedPart = state.selectedPart;
      showPart(state.selectedPart);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    listenerController.abort();
  }

  showPart(null);
  return { render, showPart, dispose };
}
