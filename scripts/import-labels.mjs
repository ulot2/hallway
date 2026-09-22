#!/usr/bin/env node
// Joins the labels saved by the Calibration Bench page with Jev's hidden predictions
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

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node scripts/import-labels.mjs <directory of exported label documents>');
  process.exit(1);
}

const predictions = JSON.parse(fs.readFileSync('calibration/predictions.json', 'utf8'));

function* files(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) yield* files(full);
    else if (e.name.endsWith('.json')) yield full;
  }
}

const rows = [];
const counts = { yes: 0, no: 0, unsure: 0, unknown: 0 };
for (const file of files(dir)) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Tolerate an export that wraps the body with its metadata.
  const body = raw.answer ? raw : raw.data ?? raw.body ?? raw;
  const id = raw.id ?? raw.doc_id ?? path.basename(file, '.json');
  const pred = predictions[id];
  if (!pred) {
    counts.unknown += 1;
    continue;
  }
  if (!(body.answer in counts)) continue;
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
  (counts.unknown ? ` · ${counts.unknown} not matched to a prediction` : ''));
console.log(`Wrote ${rows.length} rows to calibration-set.jsonl. Next: npm run calibrate`);
