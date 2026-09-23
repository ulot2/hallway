import test from 'node:test';
import assert from 'node:assert/strict';
import { failureProbability, tierFor, tierWithHysteresis, applies, assess } from '../src/tier.js';

const noul = { id: 'q', type: 'noul', question: '?', fail_when: 'false' };
const choice = {
  id: 'c', type: 'choice', question: '?',
  options: ['good', 'bad'], fail_options: ['bad'],
};
const score = {
  id: 's', type: 'score', question: '?',
  levels: ['none', 'some', 'lots'], fail_when: 'below', fail_at: 1.5,
};

test('noul fail_when=false inverts the probability', () => {
  assert.ok(Math.abs(failureProbability({ value: 0.9 }, noul).p - 0.1) < 1e-9);
});

test('noul fail_when=true passes it through', () => {
  const spec = { ...noul, fail_when: 'true' };
  assert.equal(failureProbability({ value: 0.9 }, spec).p, 0.9);
});

test('choice sums the probability mass of the failing options', () => {
  const answer = { value: 'good', probabilities: { good: 0.3, bad: 0.7 } };
  const { p, basis } = failureProbability(answer, choice);
  assert.equal(p, 0.7);
  assert.equal(basis, 'distribution');
  // Note this disagrees with the argmax: the distribution is the point.
});

test('choice without a distribution falls back and says so', () => {
  const { p, basis } = failureProbability({ value: 'bad', confidence: 0.8 }, choice);
  assert.equal(p, 0.8);
  assert.equal(basis, 'point-estimate');
});

test('score below the threshold yields a high failure probability', () => {
  const { p } = failureProbability({ value: 0.2, confidence: 0.9 }, score);
  assert.ok(p > 0.9, `expected > 0.9, got ${p}`);
});

test('score above the threshold yields a low one', () => {
  const { p } = failureProbability({ value: 2.4, confidence: 0.9 }, score);
  assert.ok(p < 0.1, `expected < 0.1, got ${p}`);
});

test('low confidence flattens the score curve toward 0.5', () => {
  const confident = failureProbability({ value: 1.2, confidence: 1 }, score).p;
  const unsure = failureProbability({ value: 1.2, confidence: 0 }, score).p;
  assert.ok(Math.abs(unsure - 0.5) < Math.abs(confident - 0.5));
});

test('missing or unparseable answers are not reported', () => {
  assert.equal(failureProbability(null, noul).p, null);
  assert.equal(failureProbability({ value: 'wat' }, noul).p, null);
  assert.equal(tierFor(null), 'silent');
});

test('tiers respect their thresholds', () => {
  assert.equal(tierFor(0.9), 'blocking');
  assert.equal(tierFor(0.6), 'look');
  assert.equal(tierFor(0.2), 'silent');
});

test('hysteresis keeps a finding reported just below its threshold', () => {
  assert.equal(tierWithHysteresis(0.82, 'blocking'), 'blocking');
  assert.equal(tierWithHysteresis(0.82, undefined), 'look');
});

test('a finding decays a tier at a time rather than vanishing', () => {
  // Was blocking, now mid-band: step down to "look", do not disappear outright.
  assert.equal(tierWithHysteresis(0.52, 'blocking'), 'look');
  // Well clear of both thresholds: drop it.
  assert.equal(tierWithHysteresis(0.3, 'blocking'), 'silent');
});

test('keyword preconditions skip questions that do not apply', () => {
  const spec = { ...noul, applies_when: 'has_error_text' };
  assert.equal(applies(spec, { has_error_text: false }), false);
  assert.equal(applies(spec, { has_error_text: true }), true);
  assert.equal(applies(noul, {}), true);
});

test('a gate question decides whether a question applies', () => {
  const spec = { ...noul, applies_when: { question: 'shows_empty_state', min_probability: 0.5 } };
  assert.equal(applies(spec, {}, { shows_empty_state: { value: 0.9 } }), true);
  assert.equal(applies(spec, {}, { shows_empty_state: { value: 0.2 } }), false);
});

test('a missing or unparseable gate answer skips the question', () => {
  const spec = { ...noul, applies_when: { question: 'shows_empty_state' } };
  assert.equal(applies(spec, {}, {}), false);
  assert.equal(applies(spec, {}, { shows_empty_state: { value: 'huh' } }), false);
});

test('gate questions never become findings', () => {
  const specs = [
    { id: 'g', type: 'noul', gate: true, question: 'Is there an empty state?' },
    { ...noul, id: 'real', applies_when: { question: 'g' } },
  ];
  const findings = assess({
    answers: { g: { value: 0.9 }, real: { value: 0.1 } },
    specs,
    signals: {},
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'real');
});

test('assess records skipped questions rather than dropping them', () => {
  const specs = [{ ...noul, applies_when: 'has_empty_state' }];
  const findings = assess({ answers: {}, specs, signals: { has_empty_state: false } });
  assert.equal(findings.length, 1);
  assert.match(findings[0].skipped, /precondition/);
});

test('a gated skip explains which gate closed it', () => {
  const specs = [{ ...noul, applies_when: { question: 'shows_empty_state', min_probability: 0.5 } }];
  const findings = assess({ answers: { shows_empty_state: { value: 0.1 } }, specs, signals: {} });
  assert.match(findings[0].skipped, /shows_empty_state below 0.5/);
});

test('calibration is applied and flagged', () => {
  const calibration = { q: { knots: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }] } };
  const [f] = assess({
    answers: { q: { value: 0 } }, specs: [noul], signals: {}, calibration,
  });
  assert.equal(f.rawP, 1);
  assert.equal(f.p, 0.5);
  assert.equal(f.calibrated, true);
});

test('hysteresis absorbs the flapping measured against the live API', () => {
  // Real values for empty_state_actionable across ten live runs on the same unchanged
  // component: mean 0.875, sd 0.022, straddling the 0.85 blocking threshold.
  const observed = [0.86, 0.84, 0.9, 0.88, 0.85, 0.84, 0.89, 0.87, 0.9, 0.86];
  const changes = (arr) => arr.filter((t, i) => i > 0 && t !== arr[i - 1]).length;

  const naive = observed.map((p) => tierFor(p));
  assert.ok(changes(naive) > 0, 'this sequence should flap without hysteresis');

  let prev;
  const damped = observed.map((p) => (prev = tierWithHysteresis(p, prev)));
  assert.equal(changes(damped), 0, 'hysteresis should hold the tier steady');
});

test('a question without its own calibration falls back to the pooled model', () => {
  const calibration = { '*': { knots: [{ x: 0, y: 0 }, { x: 1, y: 0.4 }] } };
  const [f] = assess({ answers: { q: { value: 0 } }, specs: [noul], signals: {}, calibration });
  assert.equal(f.rawP, 1);
  assert.equal(f.p, 0.4);
  assert.equal(f.calibrated, true);
});

test("a question's own calibration beats the pooled one", () => {
  const calibration = {
    q: { knots: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }] },
    '*': { knots: [{ x: 0, y: 0 }, { x: 1, y: 0.4 }] },
  };
  const [f] = assess({ answers: { q: { value: 0 } }, specs: [noul], signals: {}, calibration });
  assert.equal(f.p, 0.9);
});

test('a question not trusted to block is capped at "worth a look"', () => {
  const calibration = { _trust: { q: { n: 25, auc: 0.65, blocking: false } } };
  const [f] = assess({ answers: { q: { value: 0 } }, specs: [noul], signals: {}, calibration });
  assert.equal(f.p, 1);
  assert.equal(f.tier, 'look');
  assert.equal(f.capped, true);
});

test('a trusted question may still block', () => {
  const calibration = { _trust: { q: { n: 28, auc: 0.94, blocking: true } } };
  const [f] = assess({ answers: { q: { value: 0 } }, specs: [noul], signals: {}, calibration });
  assert.equal(f.tier, 'blocking');
  assert.equal(f.capped, false);
});

test('once any trust data exists, an unmeasured question cannot block', () => {
  const calibration = { _trust: { other: { n: 30, auc: 0.9, blocking: true } } };
  const [f] = assess({ answers: { q: { value: 0 } }, specs: [noul], signals: {}, calibration });
  assert.equal(f.tier, 'look');
});

test('with no calibration at all, blocking is unchanged', () => {
  const [f] = assess({ answers: { q: { value: 0 } }, specs: [noul], signals: {} });
  assert.equal(f.tier, 'blocking');
  assert.equal(f.capped, false);
});
