// Maps changed files to the stories that actually render them.
//
// "The story file changed" is the wrong test: a one-line tweak to a shared Button
// changes no story file at all and affects every story that renders it. We build a
// reverse import graph and take the transitive closure, so those stories are reviewed.

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_EXT = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue', '.svelte'];
// Matches `import x from 'y'`, bare side-effect `import 'y'`, `require('y')` and
// dynamic `import('y')`. Side-effect imports matter: a component pulling in a shared
// stylesheet or a barrel file is a real edge in the graph. `[^;]*?` stops a statement
// from swallowing the next one.
const IMPORT_RE = /(?:import|export)[^;]*?from\s*['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Storybook writes this during `build-storybook`. */
export function loadStoriesIndex(staticDir) {
  const file = path.join(staticDir, 'index.json');
  if (!fs.existsSync(file)) {
    throw new Error(`No story index at ${file}. Run build-storybook first.`);
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Object.values(json.entries ?? json.stories ?? {});
  return entries
    .filter((e) => (e.type ?? 'story') === 'story')
    .map((e) => ({
      id: e.id,
      title: e.title,
      name: e.name,
      importPath: normalize(e.importPath),
    }));
}

const normalize = (p) => p.replace(/^\.\//, '').replace(/\\/g, '/');

function* walk(dir, ignore) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, ignore);
    else if (SOURCE_EXT.includes(path.extname(entry.name))) yield full;
  }
}

function resolveImport(fromFile, spec, rootDir) {
  if (!spec.startsWith('.')) return null; // bare specifier: a package, not our source
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    ...SOURCE_EXT.map((e) => base + e),
    ...SOURCE_EXT.map((e) => path.join(base, `index${e}`)),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return normalize(path.relative(rootDir, c));
    }
  }
  return null;
}

/** importers[file] = every file that imports it, directly. */
export function buildImportGraph(rootDir, { ignore = ['node_modules', '.git', 'dist', 'storybook-static'] } = {}) {
  const importers = new Map();
  const ignoreSet = new Set(ignore);
  for (const file of walk(rootDir, ignoreSet)) {
    const rel = normalize(path.relative(rootDir, file));
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!spec) continue;
      const target = resolveImport(file, spec, rootDir);
      if (!target) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(rel);
    }
  }
  return importers;
}

/** Everything downstream of the changed files, including the changed files. */
export function transitiveDependents(changedFiles, importers) {
  const seen = new Set();
  const queue = changedFiles.map(normalize);
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const importer of importers.get(file) ?? []) {
      if (!seen.has(importer)) queue.push(importer);
    }
  }
  return seen;
}

/**
 * Stories to review, capped. The cap is a cost control, so it is reported rather than
 * silently applied: a run that skipped stories says so in the PR comment.
 */
export function affectedStories({ changedFiles, index, importers, maxStories = 25 }) {
  const touched = transitiveDependents(changedFiles, importers);
  const matched = index.filter((s) => touched.has(s.importPath));
  return {
    stories: matched.slice(0, maxStories),
    skipped: Math.max(0, matched.length - maxStories),
    totalMatched: matched.length,
  };
}
