#!/usr/bin/env node
// Integration check: run the real pipeline against the example Storybook build.
//
// Simulates a pull request that changes example/src/Button.jsx — a shared component
// that neither story file mentions — and asserts both stories are still reviewed.
//
//   cd example && npm install && npm run build-storybook
//   npm run example

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const example = path.resolve('example');
const staticDir = path.join(example, 'storybook-static');

if (!fs.existsSync(path.join(staticDir, 'index.json'))) {
  console.error('No example Storybook build. Run:\n  cd example && npm install && npm run build-storybook');
  process.exit(1);
}

const env = {
  ...process.env,
  HALLWAY_CHANGED_FILES: 'src/Button.jsx',
  HALLWAY_STORYBOOK_DIR: 'storybook-static',
  HALLWAY_ROOT: '.',
  HALLWAY_OUT: '.hallway',
};

execFileSync('node', [path.resolve('src/extract-main.js')], { cwd: example, env, stdio: 'inherit' });

const state = JSON.parse(fs.readFileSync(path.join(example, '.hallway/state.json'), 'utf8'));

// A change to a shared component must reach every story that renders it, even though
// neither story file changed and neither imports Button directly.
if (state.components.length !== 2) {
  console.error(`Expected 2 affected stories, got ${state.components.length}`);
  process.exit(1);
}
for (const c of state.components) {
  const leaked = c.description.match(/propertyName|Set string|Decorators documentation/);
  if (leaked) {
    console.error(`Storybook scaffolding leaked into ${c.name}: ${leaked[0]}`);
    process.exit(1);
  }
  if (!c.root) {
    console.error(`No story root recorded for ${c.name}`);
    process.exit(1);
  }
}

execFileSync('node', [path.resolve('src/review-main.js')], {
  cwd: example,
  env: { ...env, HALLWAY_QUESTIONS: path.resolve('questions.json'), HALLWAY_CALIBRATION: path.resolve('calibration.json') },
  stdio: 'inherit',
});

console.log('\n✓ Integration check passed: 2 stories reviewed, no scaffolding leaked.');
