// Behaviour the GitHub Action depends on that the scripts' own tests don't cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { changedFiles } from '../src/extract-main.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function repoWithSubproject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hallway-git-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'example/src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'example/src/Button.jsx'), 'a');
  fs.writeFileSync(path.join(dir, 'README.md'), 'a');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'example/src/Button.jsx'), 'b');
  fs.writeFileSync(path.join(dir, 'README.md'), 'b');
  git(dir, 'commit', '-q', '-am', 'change');
  return dir;
}

test('changed files are relative to a Storybook project in a subdirectory', () => {
  const dir = repoWithSubproject();
  const files = changedFiles('main', path.join(dir, 'example'));
  // Storybook importPaths look like "src/Button.jsx" relative to the project, so the
  // repository-root path "example/src/Button.jsx" would never match; and README.md is
  // outside the project entirely.
  assert.deepEqual(files, ['src/Button.jsx']);
});

test('at the repository root, every changed file is listed as before', () => {
  const dir = repoWithSubproject();
  assert.deepEqual(changedFiles('main', dir).sort(), ['README.md', 'example/src/Button.jsx']);
});

test('in CI with no API key, the review is skipped rather than mocked', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hallway-out-'));
  fs.writeFileSync(
    path.join(out, 'state.json'),
    JSON.stringify({ components: [{ name: 'X', description: 'Component: X', signals: {} }] })
  );
  const env = { ...process.env, GITHUB_ACTIONS: 'true', HALLWAY_OUT: out };
  delete env.JEV_API_KEY;
  delete env.JEV_LIVE;
  delete env.JEV_MOCK;
  const res = spawnSync('node', ['src/review-main.js'], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /::warning::Hallway skipped the review: no Jev API key/);
  assert.equal(fs.existsSync(path.join(out, 'report.md')), false, 'no report should be written');
});
