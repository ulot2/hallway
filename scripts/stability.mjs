#!/usr/bin/env node
// Does the same component produce the same answers across runs?
//
// If a finding flips on and off across pushes of identical code, developers stop
// trusting the bot within a week. Run this before shipping and put the numbers in
// the README.
//
//   JEV_API_KEY=... npm run stability -- 10

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../src/browser.js';
import { extractState, describe } from '../src/extract.js';
import { evaluate } from '../src/jev.js';
import { failureProbability } from '../src/tier.js';

const runs = Number(process.argv[2] ?? 10);
const questionSet = JSON.parse(fs.readFileSync('questions.json', 'utf8'));

const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(pathToFileURL(path.resolve('fixtures', 'bad-component.html')).href);
const state = await extractState(page, { name: 'bad-component' });
await browser.close();

const description = describe(state);
const series = new Map(questionSet.questions.map((q) => [q.id, []]));

for (let i = 0; i < runs; i += 1) {
  const answers = await evaluate({
    state: description,
    specs: questionSet.questions,
    apiKey: process.env.JEV_API_KEY,
  });
  for (const spec of questionSet.questions) {
    const { p } = failureProbability(answers[spec.id], spec);
    if (p != null) series.get(spec.id).push(p);
  }
  process.stdout.write('.');
}
console.log('\n');

const THRESHOLDS = [
  Number(process.env.HALLWAY_LOOK_AT ?? 0.55),
  Number(process.env.HALLWAY_BLOCKING_AT ?? 0.85),
];

console.log('  question                        mean     sd      min     max   margin  verdict');
const atRisk = [];
for (const [id, xs] of series) {
  if (!xs.length) continue;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const crosses = THRESHOLDS.some((t) => xs.some((x) => x >= t) && xs.some((x) => x < t));

  // Distance to the nearest tier boundary, in standard deviations. A question sitting
  // on a threshold will flip on noise even when its sd looks reassuringly small, and a
  // stable answer far from any boundary proves nothing about one sitting on it.
  const margin = Math.min(...THRESHOLDS.map((t) => Math.abs(mean - t)));
  const sigmas = sd > 0 ? margin / sd : Infinity;
  const verdict = crosses ? 'FLIPPED' : sigmas < 2 ? 'at risk' : 'stable';
  if (verdict !== 'stable') atRisk.push(id);

  console.log(
    `  ${id.padEnd(30)} ${mean.toFixed(3)}  ${sd.toFixed(3)}  ` +
      `${Math.min(...xs).toFixed(3)}  ${Math.max(...xs).toFixed(3)}   ` +
      `${margin.toFixed(3)}   ${verdict}${sigmas < 2 && sd > 0 ? ` (${sigmas.toFixed(1)}σ)` : ''}`
  );
}

console.log('');
if (atRisk.length) {
  console.log(`At risk of flipping between runs: ${atRisk.join(', ')}`);
  console.log('Their answers sit within 2 standard deviations of a tier boundary.');
} else {
  console.log('No question sits within 2 standard deviations of a tier boundary.');
}
console.log(
  '\nNote: a component with obvious problems produces confident answers far from any\n' +
    'threshold, so low variance here says little about borderline components. Re-run this\n' +
    'against a genuinely ambiguous component before trusting the thresholds.'
);

const live = process.env.JEV_LIVE === '1' || Boolean(process.env.JEV_API_KEY);
console.log(
  live
    ? '\n[live API — these are real measurements]'
    : '\n[MOCK MODE — the mock is deterministic by construction, so sd is 0 and these\n' +
        ' numbers mean nothing. Set JEV_API_KEY, or JEV_LIVE=1 for a proxy-injected key.]'
);
