#!/usr/bin/env node
// Joins the labels saved by the Hallway Bench page with Jev's hidden predictions
// and writes the calibration set that `npm run calibrate` fits.
//
//   node scripts/import-labels.mjs <labels-dir>
//
// <labels-dir> holds one JSON file per saved label, as exported from the page's
// `labels` collection. Answers of "yes" mean the human saw the problem (y = 1), "no"
// means they did not (y = 0), and "unsure" is dropped: a coin-flip label teaches the
// calibration nothing and would only add noise.

import fs from 'node:fs';
import path from 'node:path';
import { latestPerItem } from '../src/labels.js';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node scripts/import-labels.mjs <directory of exported label documents>');
  process.exit(1);
}

const predictions = JSON.parse(fs.readFileSync('calibration/predictions.json', 'utf8'));
// Labels for retired questions stay in the store as history, but they must not shape
// the calibration of the questions that replaced them.
const live = new Set(JSON.parse(fs.readFileSync('questions.json', 'utf8')).questions.map((q) => q.id));

function* files(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) yield* files(full);
    else if (e.name.endsWith('.json')) yield full;
  }
}

const all = [];
for (const file of files(dir)) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Tolerate an export that wraps the body with its metadata.
  const body = raw.answer ? raw : raw.data ?? raw.body ?? raw;
  all.push({ id: raw.id ?? raw.doc_id ?? path.basename(file, '.json'), body });
}
const latest = latestPerItem(all);
const superseded = all.length - latest.length;

const rows = [];
const counts = { yes: 0, no: 0, unsure: 0, unknown: 0, retired: 0 };
for (const { id, body } of latest) {
  const pred = predictions[id];
  if (!pred) {
    counts.unknown += 1;
    continue;
  }
  if (!live.has(pred.question_id)) {
    counts.retired += 1;
    continue;
  }
  if (!['yes', 'no', 'unsure'].includes(body.answer)) continue;
  counts[body.answer] += 1;
  if (body.answer === 'unsure') continue;
  rows.push({
    component: pred.component,
    question_id: pred.question_id,
    // Calibrate the model's own number, before any correction was applied.
    p: pred.rawP ?? pred.p,
    y: body.answer === 'yes' ? 1 : 0,
  });
}

fs.writeFileSync('calibration-set.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`yes ${counts.yes} · no ${counts.no} · skipped ${counts.unsure}` +
  (counts.unknown ? ` · ${counts.unknown} not matched to a prediction` : '') +
  (counts.retired ? ` · ${counts.retired} for retired questions, left out` : '') +
  (superseded ? ` · ${superseded} superseded by a later round` : ''));
console.log(`Wrote ${rows.length} rows to calibration-set.jsonl. Next: npm run calibrate`);
