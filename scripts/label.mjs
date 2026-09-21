#!/usr/bin/env node
// Hand-label findings to build the calibration set. Budget an hour for ~100 rows;
// that hour is what turns the confidence thresholds from guesses into measurements.
//
//   npm run label -- .jev-review/findings.json

import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const file = process.argv[2] ?? '.jev-review/findings.json';
const out = 'calibration-set.jsonl';

if (!fs.existsSync(file)) {
  console.error(`No ${file}. Run npm run review:demo first, or point at a findings.json.`);
  process.exit(1);
}

const components = JSON.parse(fs.readFileSync(file, 'utf8'));
const seen = new Set(
  fs.existsSync(out)
    ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean)
        .map((l) => { const r = JSON.parse(l); return `${r.component}::${r.question_id}`; })
    : []
);

const rl = readline.createInterface({ input, output });
let added = 0;

for (const c of components) {
  for (const f of c.findings) {
    if (f.skipped || f.p == null) continue;
    const key = `${c.name}::${f.id}`;
    if (seen.has(key)) continue;

    console.log(`\n${'-'.repeat(72)}`);
    console.log(`${c.name}\n${f.question}`);
    console.log(`Jev: ${f.value} (failure probability ${(f.p * 100).toFixed(0)}%)`);
    console.log(`\n${c.description}\n`);
    const ans = (await rl.question('Does it really fail this? [y]es / [n]o / [s]kip / [q]uit: ')).trim().toLowerCase();
    if (ans === 'q') { await rl.close(); finish(); }
    if (ans !== 'y' && ans !== 'n') continue;

    fs.appendFileSync(out, JSON.stringify({
      component: c.name, question_id: f.id, p: f.p, y: ans === 'y' ? 1 : 0,
    }) + '\n');
    added += 1;
  }
}
await rl.close();
finish();

function finish() {
  console.log(`\nAdded ${added} label(s) to ${out}. Now run: npm run calibrate`);
  process.exit(0);
}
