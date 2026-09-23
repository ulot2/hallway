import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport, encodeState, decodeState, checkConclusion, MARKER } from '../src/report.js';

const component = (name, tier) => ({
  name,
  axe: [],
  findings: [{ id: 'q', question: 'Is it good?', type: 'noul', value: 0.1, confidence: 0.9, p: 0.9, tier, basis: 'distribution' }],
});

test('the sticky marker is always present', () => {
  assert.ok(renderReport([component('A', 'silent')]).includes(MARKER));
});

test('state round-trips so hysteresis survives a rerun', () => {
  const body = renderReport([component('A', 'blocking')]);
  assert.deepEqual(decodeState(body), { A: { q: 'blocking' } });
});

test('decodeState tolerates a missing or corrupt block', () => {
  assert.deepEqual(decodeState('nothing here'), {});
  assert.deepEqual(decodeState('<!-- hallway-state {oops -->'), {});
  assert.deepEqual(decodeState(undefined), {});
});

test('uncertain findings are collapsed, not raised as errors', () => {
  const body = renderReport([component('A', 'look')]);
  assert.ok(body.includes('<details>'));
  assert.ok(body.includes('Worth a look'));
  assert.ok(!body.includes('### Blocking'));
});

test('only blocking findings fail the check', () => {
  assert.equal(checkConclusion([component('A', 'look')]), 'success');
  assert.equal(checkConclusion([component('A', 'blocking')]), 'failure');
});

test('an uncalibrated run says so', () => {
  assert.match(renderReport([component('A', 'blocking')]), /Uncalibrated/);
});

test('axe findings are labelled as certain and kept separate', () => {
  const c = component('A', 'silent');
  c.axe = [{ id: 'heading-order', impact: 'moderate', help: 'Headings must be in order', nodes: 1 }];
  const body = renderReport([c]);
  assert.ok(body.includes('These are certain, not probabilistic.'));
  assert.ok(body.includes('heading-order'));
});

test('a skipped-stories cap is disclosed', () => {
  assert.match(renderReport([component('A', 'silent')], { skipped: 4 }), /4 further affected story/);
});

test('a capped finding says why it is advisory', () => {
  const c = component('A', 'look');
  c.findings[0].capped = true;
  c.findings[0].trust = { n: 25, auc: 0.65, blocking: false };
  const body = renderReport([c]);
  assert.match(body, /advisory: agrees with human review at AUC 0.65 over 25 labels/);
  assert.equal(checkConclusion([c]), 'success');
});
