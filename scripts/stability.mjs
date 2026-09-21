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

console.log('  question                        mean     sd      min     max   flips@0.85');
for (const [id, xs] of series) {
  if (!xs.length) continue;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const crosses = xs.some((x) => x >= 0.85) && xs.some((x) => x < 0.85);
  console.log(
    `  ${id.padEnd(30)} ${mean.toFixed(3)}  ${sd.toFixed(3)}  ` +
      `${Math.min(...xs).toFixed(3)}  ${Math.max(...xs).toFixed(3)}   ${crosses ? 'YES' : 'no'}`
  );
}
if (!process.env.JEV_API_KEY) {
  console.log('\n[mock mode is deterministic by construction — sd will be 0.');
  console.log(' set JEV_API_KEY to measure the real model]');
}
