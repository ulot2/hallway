#!/usr/bin/env node
// Phase 1, runs on `pull_request` with NO secrets in scope.
//
// It executes untrusted PR code (building and rendering the branch's components), so
// it must never hold the Jev key. It writes state to disk for phase 2 to pick up.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { launch } from './browser.js';
import { serve } from './serve.js';
import { loadStoriesIndex, buildImportGraph, affectedStories } from './stories.js';
import { extractState, runAxe, describe } from './extract.js';

const env = (k, d) => process.env[k] ?? d;

/**
 * Files changed on this branch, relative to `cwd`. `--relative` matters when the
 * Storybook project lives in a subdirectory: Storybook's importPaths are relative to
 * that project, so repository-root paths ("example/src/Button.jsx") would never match
 * them, and files outside the project are dropped rather than mismatched.
 */
export function changedFiles(baseRef, cwd = process.cwd()) {
  if (process.env.HALLWAY_CHANGED_FILES) {
    return process.env.HALLWAY_CHANGED_FILES.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  const out = execFileSync('git', ['diff', '--name-only', '--relative', `${baseRef}...HEAD`], {
    encoding: 'utf8',
    cwd,
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const staticDir = env('HALLWAY_STORYBOOK_DIR', 'storybook-static');
  const rootDir = env('HALLWAY_ROOT', process.cwd());
  const outDir = env('HALLWAY_OUT', '.hallway');
  const maxStories = Number(env('HALLWAY_MAX_STORIES', '25'));
  const baseRef = env('HALLWAY_BASE_REF', 'origin/main');

  const changed = changedFiles(baseRef);
  console.log(`Changed files: ${changed.length}`);

  const index = loadStoriesIndex(staticDir);
  const importers = buildImportGraph(rootDir);
  const { stories, skipped, totalMatched } = affectedStories({
    changedFiles: changed, index, importers, maxStories,
  });
  console.log(`Affected stories: ${totalMatched} (reviewing ${stories.length}, skipping ${skipped})`);

  // Phase 2 runs from a different workflow and cannot see this PR's context, so the
  // identifiers travel with the artifact.
  const meta = {
    prNumber: Number(env('HALLWAY_PR_NUMBER', '0')) || null,
    headSha: env('HALLWAY_HEAD_SHA', null),
    baseRef,
  };

  fs.mkdirSync(outDir, { recursive: true });
  if (!stories.length) {
    fs.writeFileSync(
      path.join(outDir, 'state.json'),
      JSON.stringify({ components: [], skipped: 0, totalMatched: 0, meta }, null, 2)
    );
    console.log('No affected stories; nothing to review.');
    return;
  }

  const { port, close } = await serve(staticDir);
  const browser = await launch();
  const components = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const story of stories) {
      const url = `http://127.0.0.1:${port}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
      await page.goto(url, { waitUntil: 'networkidle' });
      const state = await extractState(page, { url, name: `${story.title} / ${story.name}` });
      const axe = await runAxe(page);
      components.push({
        name: state.name,
        storyId: story.id,
        importPath: story.importPath,
        root: state.root,
        html: state.html,
        signals: state.signals,
        axe,
        // The exact text Jev will evaluate, persisted so every finding is auditable.
        description: describe(state),
      });
      console.log(`  extracted ${story.id}`);
    }
  } finally {
    await browser.close();
    await close();
  }

  fs.writeFileSync(
    path.join(outDir, 'state.json'),
    JSON.stringify({ components, skipped, totalMatched, meta }, null, 2)
  );
  console.log(`Wrote ${outDir}/state.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
