#!/usr/bin/env node
// Turns a review run into a blind labeling set.
//
//   node scripts/build-label-set.mjs example/.jev-calibration/findings.json
//
// Writes two files, deliberately split:
//   calibration/items.json        what the labeler sees: the component and a question
//   calibration/predictions.json  what Jev said, keyed by item id — never published
//
// Keeping Jev's answers out of the page is the point. A labeler who sees "95% likely
// a problem" before deciding will tend to agree, and calibration measured against
// anchored labels looks better than it really is.

import fs from 'node:fs';

const src = process.argv[2] ?? 'example/.jev-calibration/findings.json';
const components = JSON.parse(fs.readFileSync(src, 'utf8'));
const questions = JSON.parse(fs.readFileSync('questions.json', 'utf8')).questions;
const promptFor = Object.fromEntries(questions.map((q) => [q.id, q.label_prompt]));

// Deterministic shuffle of component order, so the labeler does not meet the cases in
// the order they were designed (which runs roughly good, bad, good, bad).
let seed = 20260922;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const order = [...components];
for (let i = order.length - 1; i > 0; i -= 1) {
  const j = Math.floor(rand() * (i + 1));
  [order[i], order[j]] = [order[j], order[i]];
}

const items = [];
const predictions = {};
for (const c of order) {
  // Questions for one component stay together: the labeler reads it once and answers
  // several, which is faster and does not leak anything about Jev's answers.
  for (const f of c.findings) {
    if (f.skipped || f.p == null) continue;
    if (!promptFor[f.id]) throw new Error(`No label_prompt for question "${f.id}"`);
    const id = `${c.storyId}::${f.id}`;
    items.push({
      id,
      case: c.name.replace(/^Calibration \/ /, ''),
      question_id: f.id,
      prompt: promptFor[f.id],
      html: c.html,
    });
    predictions[id] = { question_id: f.id, component: c.name, p: f.p, rawP: f.rawP };
  }
}

fs.mkdirSync('calibration', { recursive: true });
fs.writeFileSync('calibration/items.json', JSON.stringify(items, null, 2) + '\n');
fs.writeFileSync('calibration/predictions.json', JSON.stringify(predictions, null, 2) + '\n');
console.log(`${items.length} items from ${order.length} components`);
console.log('  calibration/items.json        (for the labeling page)');
console.log('  calibration/predictions.json  (kept out of the page)');
