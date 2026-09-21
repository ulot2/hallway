#!/usr/bin/env node
// Runs the state extractor against the local fixtures. No Storybook, no API key.
//   npm run extract:demo

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../src/browser.js';
import { extractState, runAxe, describe } from '../src/extract.js';

const fixtures = ['bad-component.html', 'good-component.html'];

const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();

for (const f of fixtures) {
  const url = pathToFileURL(path.resolve('fixtures', f)).href;
  await page.goto(url);
  const state = await extractState(page, { url, name: f });
  const axe = await runAxe(page);

  console.log(`\n${'='.repeat(72)}\n${f}\n${'='.repeat(72)}`);
  console.log(describe(state));
  console.log('\nSignals:', state.signals);
  console.log('axe violations:', Array.isArray(axe) ? axe.map((v) => v.id) : axe);
}

await browser.close();
