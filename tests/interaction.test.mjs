import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureGate, paginateLetter, nextState } from '../app/src/interaction.js';

test('a pinch triggers once, requires release, and respects the cooldown', () => {
  const gate = new GestureGate();
  const frame = (ratio, now, options = {}) => gate.update({ ratio, now, open: false, tracked: true, pinch: ratio < .24, ...options }).pinch;
  assert.equal(frame(.1, 0), false, 'a hand first appearing closed must not turn a page');
  assert.equal(frame(.7, 50), false);
  assert.equal(frame(.1, 100), false, 'the pinch must remain stable briefly');
  assert.equal(frame(.1, 220), true);
  assert.equal(frame(.1, 1000), false, 'holding a pinch must not repeat');
  assert.equal(frame(.7, 1100), false);
  assert.equal(frame(.1, 1200), false, 'cooldown still blocks a fast repeat');
  assert.equal(frame(.1, 1320), true);
  frame(.7, 1400);
  assert.equal(frame(.1, 1500), false, 'a fast repeat is blocked');
});

test('a closed palm never triggers a pinch until the fingers release', () => {
  const gate = new GestureGate();
  const update = (now, options = {}) => gate.update({ ratio: .16, open: false, tracked: true, pinch: true, fist: true, now, ...options }).pinch;
  assert.equal(update(0), false);
  assert.equal(update(500), false);
  assert.equal(update(600, { ratio: .7, pinch: false, fist: false }), false);
  assert.equal(update(700, { fist: false }), false);
  assert.equal(update(820, { fist: false }), true);
});

test('losing a hand clears the hold and requires a fresh release', () => {
  const gate = new GestureGate();
  const frame = (now) => gate.update({ ratio: 1, open: true, tracked: true, now });
  assert.equal(frame(0).progress, 0);
  assert.equal(frame(500).progress, .5);
  gate.update({ tracked: false, now: 700 });
  assert.equal(frame(800).progress, 0);
  assert.equal(frame(1800).progress, 1);
  gate.update({ tracked: false, now: 2000 });
  assert.equal(gate.update({ ratio: .1, tracked: true, open: false, now: 2100 }).pinch, false);
});

test('the entire eight-memory sequence leads to the envelope, letter pages, and finale', () => {
  let state = { stage: 'tutorial', index: 0, page: 0 };
  state = nextState(state, 8, 3); assert.equal(state.stage, 'blessing'); assert.equal(state.blessingStep, 0);
  state = nextState(state, 8, 3); assert.equal(state.blessingStep, 1);
  state = nextState(state, 8, 3); assert.equal(state.stage, 'memories');
  for (let i = 1; i < 8; i++) { state = nextState(state, 8, 3); assert.equal(state.index, i); }
  state = nextState(state, 8, 3); assert.equal(state.stage, 'envelope');
  state = nextState(state, 8, 3); assert.equal(state.stage, 'letter'); assert.equal(state.page, 0);
  state = nextState(state, 8, 3); assert.equal(state.page, 1);
  state = nextState(state, 8, 3); assert.equal(state.page, 2);
  state = nextState(state, 8, 3); assert.equal(state.stage, 'finale');
});

test('a long letter fits measured lines and preserves every character and paragraph', () => {
  const letter = '致xxx：\n\n' + '这是很长的一封信，我记得那些日子。'.repeat(40) + '\n生日快乐♡';
  const pages = paginateLetter(letter, 130, 100, (s) => [...s].length * 10, 20);
  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.ok(page.split('\n').length <= 5);
    for (const line of page.split('\n')) assert.ok([...line].length <= 13);
  }
  assert.equal(pages.join('').replaceAll('\n', ''), letter.replaceAll('\n', ''));
  assert.deepEqual(paginateLetter('', 130, 100, (s) => s.length * 10, 20), ['']);
});
