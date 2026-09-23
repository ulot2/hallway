import test from 'node:test';
import assert from 'node:assert/strict';
import { pava, fitIsotonic, applyIsotonic, ece, brier, reliability } from '../src/calibrate.js';

test('pava returns a non-decreasing fit', () => {
  const out = pava([3, 1, 2, 5, 4]);
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i] >= out[i - 1] - 1e-9);
});

test('pava leaves an already-isotonic sequence alone', () => {
  assert.deepEqual(pava([0, 1, 2, 3]), [0, 1, 2, 3]);
});

test('pava pools violators to their mean', () => {
  assert.deepEqual(pava([1, 0]), [0.5, 0.5]);
});

test('isotonic correction is monotone in p', () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({ p: i / 100, y: i / 100 > 0.6 ? 1 : 0 }));
  const model = fitIsotonic(samples);
  let prev = -Infinity;
  for (let p = 0; p <= 1; p += 0.05) {
    const v = applyIsotonic(model, p);
    assert.ok(v >= prev - 1e-9, `not monotone at ${p}`);
    prev = v;
  }
});

test('applyIsotonic is identity when there is no fitted model', () => {
  assert.equal(applyIsotonic({ knots: [] }, 0.42), 0.42);
  assert.equal(applyIsotonic(undefined, 0.42), 0.42);
});

test('a perfectly calibrated set has near-zero ECE', () => {
  const samples = [];
  for (const p of [0.1, 0.5, 0.9]) {
    for (let i = 0; i < 100; i += 1) samples.push({ p, y: i < p * 100 ? 1 : 0 });
  }
  assert.ok(ece(samples) < 0.01, `ece was ${ece(samples)}`);
});

test('brier rewards confident correctness', () => {
  assert.ok(brier([{ p: 0.99, y: 1 }]) < brier([{ p: 0.6, y: 1 }]));
});

test('reliability bins cover every sample exactly once', () => {
  const samples = Array.from({ length: 57 }, (_, i) => ({ p: i / 57, y: i % 2 }));
  const total = reliability(samples).reduce((a, b) => a + b.n, 0);
  assert.equal(total, 57);
});

test('p = 1.0 lands in the last bin, not out of bounds', () => {
  const bins = reliability([{ p: 1, y: 1 }], 10);
  assert.equal(bins[9].n, 1);
});
