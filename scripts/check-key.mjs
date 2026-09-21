#!/usr/bin/env node
// One small live call to answer three questions before you run the whole pipeline:
//   1. Does the key work?
//   2. What does a real response actually look like?
//   3. Does this repo's parser understand it?
//
//   npm run check-key
//
// Never prints the key itself.

import { toWire, normalizeAnswer } from '../src/jev.js';

const ENDPOINT = process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-latest';
const key = process.env.JEV_API_KEY;

if (!key) {
  console.error(
    'No JEV_API_KEY found.\n\n' +
      '  cp .env.example .env     then put the key in .env\n' +
      '  # or, for one command only:\n' +
      '  JEV_API_KEY=... npm run check-key\n'
  );
  process.exit(1);
}
const masked = `${key.slice(0, 6)}…${key.slice(-4)} (${key.length} chars)`;
console.log(`Using key ${masked}`);
console.log(`POST ${ENDPOINT}  model=${MODEL}\n`);

// One of each question type, against a state whose right answers are obvious.
const specs = [
  { id: 'is_urgent', type: 'noul', question: 'Is this message urgent?' },
  {
    id: 'topic', type: 'choice',
    question: 'What is this message about?',
    options: ['billing', 'technical', 'sales'],
  },
  {
    id: 'frustration', type: 'score',
    question: 'How frustrated does this person sound?',
    levels: ['calm', 'annoyed', 'angry'],
  },
];
const state = 'Help! My payouts have been failing for three days and nobody has replied.';

const body = { model: MODEL, state, questions: toWire(specs) };
console.log('Request:\n' + JSON.stringify(body, null, 2) + '\n');

let res;
try {
  res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
} catch (err) {
  console.error(`Could not reach ${ENDPOINT}: ${err.message}`);
  console.error('A network or proxy block looks like this. A bad key does not.');
  process.exit(1);
}

const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}\n${text.slice(0, 1000)}`);
  console.error(`\n${diagnose(res.status, text)}`);
  process.exit(1);
}

/**
 * A corporate proxy, a sandbox egress policy and a VPN all answer with the same status
 * codes an API uses for auth failures. Telling them apart matters: one is fixed by a
 * new key, the other never is.
 */
function diagnose(status, body) {
  const blocked = /not in allowlist|egress|proxy|blocked|forbidden host|tunnel/i.test(body);
  if (blocked) {
    return (
      'This is a NETWORK block, not an authentication failure — the response came from a\n' +
      'proxy, not from the API. Your key may be perfectly fine. Allow the API host in\n' +
      'your network egress settings, or run this from an unrestricted network.'
    );
  }
  if (status === 401) return 'Usually a wrong, revoked or malformed key.';
  if (status === 403) {
    return (
      'Either the key lacks access to this model, or something between you and the API\n' +
      'refused the request. Check whether the body above came from the API or a proxy.'
    );
  }
  if (status === 404) return 'Endpoint path looks wrong. Check it against the current docs.';
  if (status === 429) return 'Rate limited. Wait and retry.';
  if (status >= 500) return 'Server-side error. Retry before changing anything.';
  return 'Check the endpoint, model name and request shape against the current docs.';
}

let json;
try {
  json = JSON.parse(text);
} catch {
  console.error(`Response was not JSON:\n${text.slice(0, 1000)}`);
  process.exit(1);
}

console.log(`HTTP ${res.status}\n`);
console.log('Raw response:\n' + JSON.stringify(json, null, 2) + '\n');

const answers = json.answers ?? json.questions ?? json.results ?? json;
console.log('Parsed by this repo:');
let parsed = 0;
for (const spec of specs) {
  const norm = normalizeAnswer(answers?.[spec.id], spec);
  const ok = norm && norm.value != null;
  if (ok) parsed += 1;
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${spec.id.padEnd(12)} ` +
      (ok
        ? `value=${norm.value} confidence=${norm.confidence ?? '-'}` +
          (norm.probabilities ? ` probabilities=${JSON.stringify(norm.probabilities)}` : '')
        : 'could not read an answer')
  );
}

console.log('');
if (parsed === specs.length) {
  console.log('The key works and the parser handles this response. Run: npm run example');
} else {
  console.log(
    `${specs.length - parsed} of ${specs.length} answers did not parse.\n` +
      'Compare the raw response above against normalizeAnswer() and toWire() in\n' +
      'src/jev.js — those two functions are the only place the wire format lives.'
  );
  process.exit(1);
}
