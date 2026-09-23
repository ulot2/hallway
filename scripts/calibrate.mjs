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
// Isotonic fits on this few points are noisy, but every fit must also beat the raw
// probabilities on 5-fold held-out data before it is saved, which is the real guard.
const MIN_SAMPLES = 20;

function loadSamples() {
  if (demo) {
    // A deliberately overconfident model: it says 0.9, it is right 0.65 of the time.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    return Array.from({ length: 200 }, () => {
      const p = rand();
      const truth = p ** 1.8; // real probability is lower than claimed
      return { question_id: 'purpose_clear_from_text', p, y: rand() < truth ? 1 : 0 };
    });
  }
  if (!fs.existsSync(file)) {
    console.error(`No ${file}. Label some findings first: npm run label`);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * A correction is kept only if it improves BOTH measures on held-out data. ECE alone is
 * not enough: it is a binned, noisy metric, and an isotonic fit on a small sample can
 * lower it by flattening probabilities into a few steps while making them worse as
 * forecasts. Brier is a proper scoring rule and cannot be gamed that way. (A pooled fit
 * over 96 labels once cut ECE from 0.126 to 0.074 while Brier rose from 0.184 to 0.188,
 * and was nearly saved.)
 */
function helps(raw, fixed) {
  return ece(fixed) < ece(raw) && brier(fixed) < brier(raw);
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
  if (!helps(heldOutRaw, heldOutFixed)) {
    console.log('  NOTE: correction does not help out of sample. Leaving this question uncalibrated.');
    continue;
  }
  calibration[id] = fitIsotonic(rows);
}

// Pooled fallback. Per-question fitting needs ~30 labels each, and gated questions
// (only asked when, say, an error is showing) rarely get that many. One map fitted
// across every question is less specific but actually fittable, and tier.js uses it
// for any question without a model of its own.
const all = [...byQuestion.values()].flat();
if (all.length >= MIN_SAMPLES) {
  console.log(`\n${'='.repeat(72)}\nALL QUESTIONS POOLED  (n=${all.length})\n${'='.repeat(72)}`);
  console.log(asciiDiagram(all));
  const heldOutRaw = [];
  const heldOutFixed = [];
  for (const { train, test } of kFold(all, 5)) {
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
  if (helps(heldOutRaw, heldOutFixed)) {
    calibration['*'] = fitIsotonic(all);
  } else {
    console.log('  NOTE: pooled correction does not help out of sample. Not saved.');
  }
}

// Which questions have earned the right to fail a build. Calibration rescales a signal;
// this asks whether there is one. A question may block only once it has been measured
// against enough human labels and ranks them well. Below that bar its findings still
// appear, collapsed, as advice — they just never fail the check.
const TRUST_MIN_N = 10;
const TRUST_MIN_AUC = 0.75;
function auc(rows) {
  const pos = rows.filter((r) => r.y);
  const neg = rows.filter((r) => !r.y);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0;
  return s / (pos.length * neg.length);
}
const trust = {};
console.log(`\n${'='.repeat(72)}\nBLOCKING ELIGIBILITY  (needs n >= ${TRUST_MIN_N} and AUC >= ${TRUST_MIN_AUC})\n${'='.repeat(72)}`);
for (const [id, rows] of byQuestion) {
  const a = auc(rows);
  const blocking = rows.length >= TRUST_MIN_N && a != null && a >= TRUST_MIN_AUC;
  trust[id] = { n: rows.length, auc: a == null ? null : Number(a.toFixed(3)), blocking };
  console.log(
    `  ${id.padEnd(30)} n=${String(rows.length).padStart(3)}  AUC ${a == null ? ' n/a' : a.toFixed(2)}  ` +
      (blocking ? 'may block' : 'advisory only')
  );
}
if (!demo) calibration._trust = trust;

if (Object.keys(calibration).length) {
  fs.writeFileSync('calibration.json', JSON.stringify(calibration, null, 2));
  const models = Object.keys(calibration).filter((k) => k !== '_trust').length;
  console.log(`\nWrote calibration.json: ${models} correction model(s), blocking eligibility for ${Object.keys(trust).length} question(s).`);
  if (demo) console.log('(--demo data: do not commit this calibration.json)');
} else {
  console.log('\nNothing fitted. Label more findings.');
  // Don't leave an earlier, now-contradicted correction in place.
  if (fs.existsSync('calibration.json')) {
    fs.unlinkSync('calibration.json');
    console.log('Removed the previous calibration.json.');
  }
}
