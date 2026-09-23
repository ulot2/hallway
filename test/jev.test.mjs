import test from 'node:test';
import assert from 'node:assert/strict';
import { toWire, normalizeAnswer, mockEvaluate } from '../src/jev.js';

const specs = [
  { id: 'a', type: 'noul', question: 'yes?', instructions: 'say yes when yes' },
  { id: 'b', type: 'choice', question: 'which?', options: ['x', 'y'] },
  { id: 'c', type: 'score', question: 'how much?', levels: ['low', 'high'] },
];

// Shapes below are the ones the live API accepts (verified against jev-1.13.0).
test('every question type maps onto the wire format', () => {
  const wire = toWire(specs);
  assert.deepEqual(wire.a, { type: 'noul', question: 'yes?', instructions: 'say yes when yes' });
  assert.deepEqual(wire.b, { type: 'choice', question: 'which?', criteria: { x: 'x', y: 'y' } });
  assert.deepEqual(wire.c, { type: 'score', question: 'how much?', criteria: ['low', 'high'] });
});

test('choice criteria pass through as written when given', () => {
  const criteria = { x: 'the x case', y: 'the y case' };
  const wire = toWire([{ id: 'b', type: 'choice', question: 'which?', criteria }]);
  assert.deepEqual(wire.b.criteria, criteria);
});

test('a noul question without instructions is rejected before the request', () => {
  // The API answers 400 for this; failing locally costs nothing and explains itself.
  assert.throws(
    () => toWire([{ id: 'a', type: 'noul', question: 'yes?' }]),
    /needs "instructions"/
  );
});

test('a noul question falls back to its rationale as instructions', () => {
  const wire = toWire([{ id: 'a', type: 'noul', question: 'yes?', rationale: 'because' }]);
  assert.equal(wire.a.instructions, 'because');
});

test('live answer shapes parse, including the type-named value keys', () => {
  assert.equal(normalizeAnswer({ type: 'noul', noul: 0.84 }, { type: 'noul' }).value, 0.84);
  assert.equal(
    normalizeAnswer({ type: 'choice', choice: 'billing', confidence: 0.98 }, { type: 'choice' }).value,
    'billing'
  );
  assert.equal(normalizeAnswer({ type: 'score', score: 1.53 }, { type: 'score' }).value, 1.53);
});

test('a noul answer gets a confidence derived from its distance from 0.5', () => {
  // The API sends no confidence for noul; the probability is the whole answer.
  const norm = normalizeAnswer({ type: 'noul', noul: 0.9 }, { type: 'noul' });
  assert.ok(Math.abs(norm.confidence - 0.8) < 1e-9);
  assert.equal(normalizeAnswer({ type: 'noul', noul: 0.5 }, { type: 'noul' }).confidence, 0);
});

test('score probabilities are re-keyed from indices to level names', () => {
  const raw = {
    type: 'score', score: 1.53, confidence: 0.29,
    legend: { 0: 'calm', 1: 'annoyed', 2: 'angry' },
    probabilities: { 0: 0, 1: 0.47, 2: 0.53 },
  };
  const norm = normalizeAnswer(raw, { type: 'score' });
  assert.deepEqual(norm.probabilities, { calm: 0, annoyed: 0.47, angry: 0.53 });
});

test('an unknown question type fails loudly at build time', () => {
  assert.throws(() => toWire([{ id: 'z', type: 'vibes', question: '?' }]), /Unknown question type/);
});

test('normalizeAnswer accepts the field names a beta API might use', () => {
  const spec = { type: 'noul' };
  assert.equal(normalizeAnswer({ value: 0.8 }, spec).value, 0.8);
  assert.equal(normalizeAnswer({ answer: 0.8 }, spec).value, 0.8);
  assert.equal(normalizeAnswer({ probability: 0.8 }, spec).value, 0.8);
  assert.equal(normalizeAnswer({ score: 0.8 }, spec).value, 0.8);
  assert.equal(normalizeAnswer({ value: 0.8, certainty: 0.9 }, spec).confidence, 0.9);
  assert.equal(normalizeAnswer({ value: 0.8, probs: { a: 1 } }, spec).probabilities.a, 1);
});

test('normalizeAnswer returns null for a missing answer rather than inventing one', () => {
  assert.equal(normalizeAnswer(undefined, { type: 'noul' }), null);
});

test('the mock is deterministic for the same state and question', () => {
  const a = mockEvaluate({ state: 'hello', specs });
  const b = mockEvaluate({ state: 'hello', specs });
  assert.deepEqual(a, b);
});

test('the mock varies with the state, so stability runs are meaningful', () => {
  const a = mockEvaluate({ state: 'hello', specs });
  const b = mockEvaluate({ state: 'different', specs });
  assert.notDeepEqual(a, b);
});

test('mock choice probabilities form a distribution', () => {
  const { b } = mockEvaluate({ state: 's', specs });
  const total = Object.values(b.probabilities).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `probabilities summed to ${total}`);
});

test('mock score stays inside the level range', () => {
  const { c } = mockEvaluate({ state: 's', specs });
  assert.ok(c.value >= 0 && c.value <= specs[2].levels.length - 1);
});

test('JEV_LIVE=1 prevents the silent fall back to the mock', async () => {
  // A proxy-injected credential means no key is present in the session. Without this
  // escape hatch, evaluate() would quietly return made-up answers.
  const { evaluate } = await import('../src/jev.js');
  process.env.JEV_LIVE = '1';
  try {
    await assert.rejects(
      evaluate({ state: 's', specs, apiKey: undefined, timeoutMs: 1 }),
      (err) => !/mock/i.test(err.message)
    );
  } finally {
    delete process.env.JEV_LIVE;
  }
});

test('without JEV_LIVE, a missing key still yields the mock', async () => {
  const { evaluate } = await import('../src/jev.js');
  const out = await evaluate({ state: 's', specs, apiKey: undefined });
  assert.equal(out.a.raw.mock, true);
});
