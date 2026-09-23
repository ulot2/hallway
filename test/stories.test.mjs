import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildImportGraph, transitiveDependents, affectedStories } from '../src/stories.js';

function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-stories-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/Button.jsx'), 'export const Button = () => null;');
  fs.writeFileSync(path.join(dir, 'src/Form.jsx'), "import { Button } from './Button';\nexport const Form = () => null;");
  fs.writeFileSync(path.join(dir, 'src/Form.stories.jsx'), "import { Form } from './Form';\nexport default { component: Form };\nexport const Default = {};");
  fs.writeFileSync(path.join(dir, 'src/Unrelated.stories.jsx'), "export default {};\nexport const Default = {};");
  return dir;
}

test('a change to a shared component reaches the stories that render it', () => {
  const dir = fixtureRepo();
  const importers = buildImportGraph(dir);
  const touched = transitiveDependents(['src/Button.jsx'], importers);
  // Button -> Form -> Form.stories: the story file itself never changed.
  assert.ok(touched.has('src/Form.stories.jsx'));
  assert.ok(!touched.has('src/Unrelated.stories.jsx'));
});

test('unrelated changes do not drag in every story', () => {
  const dir = fixtureRepo();
  const importers = buildImportGraph(dir);
  const touched = transitiveDependents(['README.md'], importers);
  assert.equal(touched.has('src/Form.stories.jsx'), false);
});

test('the per-run cap is reported rather than applied silently', () => {
  const index = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, importPath: 'src/Form.stories.jsx' }));
  const importers = new Map();
  const res = affectedStories({ changedFiles: ['src/Form.stories.jsx'], index, importers, maxStories: 2 });
  assert.equal(res.stories.length, 2);
  assert.equal(res.skipped, 3);
  assert.equal(res.totalMatched, 5);
});

test('import cycles terminate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-cycle-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "import './b.js';");
  fs.writeFileSync(path.join(dir, 'b.js'), "import './a.js';");
  const importers = buildImportGraph(dir);
  assert.deepEqual([...transitiveDependents(['a.js'], importers)].sort(), ['a.js', 'b.js']);
});
