const modes = new Set(['assembly', 'exploded', 'shell', 'section']);
const axes = new Set(['x', 'y', 'z']);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));

export const initialViewState = Object.freeze({
  mode: 'assembly', explosion: 0, shellTransparency: 0,
  clipAxis: 'x', clipPosition: 0, selectedPart: null
});
export const createViewState = () => ({ ...initialViewState });

export function reduceViewState(state, action) {
  switch (action.type) {
    case 'SET_MODE': return { ...state, mode: modes.has(action.mode) ? action.mode : 'assembly' };
    case 'SET_EXPLOSION': return { ...state, explosion: clamp(action.value) };
    case 'SET_SHELL_TRANSPARENCY': return { ...state, shellTransparency: clamp(action.value) };
    case 'SET_CLIP_AXIS': return { ...state, clipAxis: axes.has(action.axis) ? action.axis : 'x' };
    case 'SET_CLIP_POSITION': return { ...state, clipPosition: clamp(action.value, -1, 1) };
    case 'SELECT_PART': return { ...state, selectedPart: action.partId ?? null };
    case 'RESET': return createViewState();
    default: return state;
  }
}

export function clipPlaneDefinition(state) {
  return { axis: state.clipAxis, position: state.clipPosition };
}
