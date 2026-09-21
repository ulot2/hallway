#!/usr/bin/env node
// End-to-end dry run: extract the fixtures, score them, render the PR comment.
// Uses the deterministic mock unless JEV_API_KEY is set.
//   npm run review:demo

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../src/browser.js';
import { extractState, runAxe, describe } from '../src/extract.js';
import { review } from '../src/review-main.js';
import { renderReport } from '../src/report.js';

const questionSet = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
const calibration = fs.existsSync('calibration.json')
  ? JSON.parse(fs.readFileSync('calibration.json', 'utf8'))
  : {};
const thresholds = { blockingAt: 0.85, lookAt: 0.55 };

const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();
const components = [];

for (const f of ['bad-component.html', 'good-component.html']) {
  const url = pathToFileURL(path.resolve('fixtures', f)).href;
  await page.goto(url);
  const state = await extractState(page, { url, name: f.replace('.html', '') });
  components.push({
    name: state.name,
    storyId: f,
    signals: state.signals,
    axe: await runAxe(page),
    description: describe(state),
  });
}
await browser.close();

const scored = await review({
  state: { components, skipped: 0 },
  questionSet,
  calibration,
  thresholds,
  apiKey: process.env.JEV_API_KEY,
});

const body = renderReport(scored, {
  questionSetVersion: questionSet.version,
  thresholds,
  stateArtifact: 'jev-ui-review-state',
});

fs.mkdirSync('.jev-review', { recursive: true });
fs.writeFileSync('.jev-review/report.md', body);
console.log(body);
console.warn(
  process.env.JEV_API_KEY
    ? '\n[live Jev call]'
    : '\n[deterministic mock — set JEV_API_KEY for real answers]'
);
