import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItemId, latestPerItem } from '../src/labels.js';

test('an untagged id is round 0', () => {
  assert.deepEqual(parseItemId('calibration--case-05::competing_actions'), {
    base: 'calibration--case-05::competing_actions', round: 0,
  });
});

test('a round tag is split off', () => {
  assert.deepEqual(parseItemId('calibration--case-05::competing_actions@r4'), {
    base: 'calibration--case-05::competing_actions', round: 4,
  });
});

test('the latest round supersedes earlier labels for the same item', () => {
  const kept = latestPerItem([
    { id: 'c1::q', answer: 'yes' },
    { id: 'c1::q@r4', answer: 'no' },
    { id: 'c2::q', answer: 'yes' },
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept.find((l) => l.id.startsWith('c1')).answer, 'no');
  assert.equal(kept.find((l) => l.id.startsWith('c2')).answer, 'yes');
});

test('order of arrival does not matter', () => {
  const kept = latestPerItem([{ id: 'c1::q@r4', answer: 'no' }, { id: 'c1::q', answer: 'yes' }]);
  assert.deepEqual(kept.map((l) => l.answer), ['no']);
});
