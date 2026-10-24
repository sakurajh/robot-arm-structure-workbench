import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewState, reduceViewState, clipPlaneDefinition } from '../src/state.js';

test('mode actions and numeric controls clamp to documented ranges', () => {
  let s = createViewState();
  s = reduceViewState(s, { type: 'SET_MODE', mode: 'exploded' });
  s = reduceViewState(s, { type: 'SET_EXPLOSION', value: 2 });
  s = reduceViewState(s, { type: 'SET_SHELL_TRANSPARENCY', value: -1 });
  s = reduceViewState(s, { type: 'SET_CLIP_POSITION', value: -3 });
  assert.equal(s.mode, 'exploded');
  assert.equal(s.explosion, 1);
  assert.equal(s.shellTransparency, 0);
  assert.equal(s.clipPosition, -1);
});

test('section axis and reset are deterministic', () => {
  let s = reduceViewState(createViewState(), { type: 'SET_CLIP_AXIS', axis: 'z' });
  s = reduceViewState(s, { type: 'SELECT_PART', partId: 'elbow-motor' });
  assert.deepEqual(clipPlaneDefinition(s), { axis: 'z', position: 0 });
  assert.equal(reduceViewState(s, { type: 'RESET' }).selectedPart, null);
  assert.equal(reduceViewState(s, { type: 'SET_MODE', mode: 'invalid' }).mode, 'assembly');
});
