#!/usr/bin/env node
// Fit and report calibration, per question.
//
//   npm run calibrate            # uses calibration-set.jsonl
//   npm run calibrate -- --demo  # synthetic overconfident data, to see it work
//
// Input is JSONL of { question_id, p, y } where y is the human label (1 = really did
// fail). Writes calibration.json, which tier.js applies to every future probability.

import fs from 'node:fs';
import { fitIsotonic, applyIsotonic, ece, brier, asciiDiagram } from '../src/calibrate.js';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const file = args.find((a) => !a.startsWith('--')) ?? 'calibration-set.jsonl';
const MIN_SAMPLES = 30;

function loadSamples() {
  if (demo) {
    // A deliberately overconfident model: it says 0.9, it is right 0.65 of the time.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    return Array.from({ length: 200 }, () => {
      const p = rand();
      const truth = p ** 1.8; // real probability is lower than claimed
      return { question_id: 'primary_action_obvious', p, y: rand() < truth ? 1 : 0 };
    });
  }
  if (!fs.existsSync(file)) {
    console.error(`No ${file}. Label some findings first: npm run label`);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Deterministic k-fold split, so repeated runs report the same numbers. */
function kFold(rows, k) {
  const shuffled = [...rows];
  let seed = 7;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return Array.from({ length: k }, (_, f) => ({
    train: shuffled.filter((_, i) => i % k !== f),
    test: shuffled.filter((_, i) => i % k === f),
  }));
}

const samples = loadSamples();
const byQuestion = new Map();
for (const s of samples) {
  if (!byQuestion.has(s.question_id)) byQuestion.set(s.question_id, []);
  byQuestion.get(s.question_id).push({ p: Number(s.p), y: Number(s.y) });
}

const calibration = {};
for (const [id, rows] of byQuestion) {
  console.log(`\n${'='.repeat(72)}\n${id}  (n=${rows.length})\n${'='.repeat(72)}`);
  if (rows.length < MIN_SAMPLES) {
    console.log(`Only ${rows.length} samples; need ${MIN_SAMPLES}+ to fit. Skipping.`);
    continue;
  }
  console.log(asciiDiagram(rows));

  // Isotonic regression can fit its own training data perfectly, so an in-sample
  // improvement is meaningless. Report held-out numbers, then refit on everything.
  const folds = kFold(rows, 5);
  const heldOutRaw = [];
  const heldOutFixed = [];
  for (const { train, test } of folds) {
    const m = fitIsotonic(train);
    for (const r of test) {
      heldOutRaw.push(r);
      heldOutFixed.push({ p: applyIsotonic(m, r.p), y: r.y });
    }
  }
  console.log(
    `\n  held out, 5-fold:` +
      `\n  ECE    ${ece(heldOutRaw).toFixed(4)}  ->  ${ece(heldOutFixed).toFixed(4)}` +
      `\n  Brier  ${brier(heldOutRaw).toFixed(4)}  ->  ${brier(heldOutFixed).toFixed(4)}`
  );
  if (ece(heldOutFixed) >= ece(heldOutRaw)) {
    console.log('  NOTE: correction does not help out of sample. Leaving this question uncalibrated.');
    continue;
  }
  calibration[id] = fitIsotonic(rows);
}

if (Object.keys(calibration).length) {
  fs.writeFileSync('calibration.json', JSON.stringify(calibration, null, 2));
  console.log(`\nWrote calibration.json for ${Object.keys(calibration).length} question(s).`);
  if (demo) console.log('(--demo data: do not commit this calibration.json)');
} else {
  console.log('\nNothing fitted. Label more findings.');
}
