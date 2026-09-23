// The ONLY module that knows Jev's wire format.
//
// Verified against the live API (jev-1.13.0). Request:
//
//   { model, state, questions: { <id>: { type, question, criteria | instructions } } }
//
//   noul    criteria or instructions is REQUIRED; a 400 explains if it is missing
//   choice  criteria is an OBJECT mapping each option to a description of it
//   score   criteria is an ORDERED ARRAY of level names, lowest first
//
// Response:
//
//   { model, answers: { <id>: {...} }, usage }
//
//   noul    { type, noul: <probability the statement is true> }   — no confidence
//   choice  { type, choice, confidence, probabilities: {option: p} }
//   score   { type, score, confidence, legend: {index: name}, probabilities: {index: p} }
//
// Note that a score's probabilities are keyed by STRING INDEX, not level name, and the
// legend maps them back. Everything downstream consumes the normalized shape from
// `evaluate()`: { [questionId]: { type, value, confidence, probabilities } }, where
// score probabilities have been re-keyed to level names.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENDPOINT = process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-latest';

/** questions.json specs -> the questions map Jev expects. */
export function toWire(specs) {
  const questions = {};
  for (const spec of specs) {
    if (spec.type === 'noul') {
      // The API rejects a noul question with neither, so fall back to the rationale
      // we already keep for humans rather than failing the whole request.
      const instructions = spec.instructions ?? spec.rationale;
      if (!instructions && !spec.criteria) {
        throw new Error(
          `Question "${spec.id}" is a noul and needs "instructions" (or "criteria"). ` +
            'The API rejects noul questions that have neither.'
        );
      }
      questions[spec.id] = {
        type: 'noul',
        question: spec.question,
        ...(spec.criteria ? { criteria: spec.criteria } : { instructions }),
      };
    } else if (spec.type === 'choice') {
      // criteria is an object: each option mapped to a description of when it applies.
      const criteria = spec.criteria ?? Object.fromEntries((spec.options ?? []).map((o) => [o, o]));
      questions[spec.id] = { type: 'choice', question: spec.question, criteria };
    } else if (spec.type === 'score') {
      // criteria is an ordered array of level names, lowest first.
      questions[spec.id] = {
        type: 'score',
        question: spec.question,
        criteria: spec.criteria ?? spec.levels,
      };
    } else {
      throw new Error(`Unknown question type "${spec.type}" for question "${spec.id}"`);
    }
  }
  return questions;
}

/** Tolerant parse: beta APIs rename fields, and we would rather degrade than crash. */
export function normalizeAnswer(raw, spec) {
  if (raw == null) return null;

  // The live API returns the answer under a key named after the question type
  // (noul/choice/score). The other spellings are kept as a cushion against the beta
  // renaming things again.
  const value =
    raw.noul ?? raw.choice ?? raw.score ??
    raw.value ?? raw.answer ?? raw.probability ?? null;

  // A noul answer carries no confidence field: the probability IS the answer, and how
  // far it sits from 0.5 is the only confidence there is.
  const confidence =
    raw.confidence ?? raw.certainty ??
    (spec.type === 'noul' && Number.isFinite(Number(value))
      ? Math.abs(Number(value) - 0.5) * 2
      : null);

  let probabilities = raw.probabilities ?? raw.probs ?? raw.distribution ?? null;

  // Score probabilities come keyed by string index with a separate legend. Re-key them
  // to level names so downstream code never has to know about the legend.
  if (probabilities && raw.legend) {
    probabilities = Object.fromEntries(
      Object.entries(probabilities).map(([k, v]) => [raw.legend[k] ?? k, v])
    );
  }

  return { type: spec.type, value, confidence, probabilities, raw };
}

/**
 * Evaluate one component state against every applicable question in a single call,
 * so the questions run in parallel server-side.
 */
export async function evaluate({ state, specs, apiKey, timeoutMs = 30_000 }) {
  if (!specs.length) return {};

  // JEV_LIVE=1 forces a real request even with no key in the environment. A gateway or
  // proxy may inject the Authorization header after the request leaves this machine —
  // Claude Code's cloud "API credentials" work exactly that way — in which case the key
  // is deliberately absent here and falling back to the mock would be wrong.
  const live = process.env.JEV_LIVE === '1';
  if (!live && (!apiKey || apiKey === 'mock' || process.env.JEV_MOCK === '1')) {
    return mockEvaluate({ state, specs });
  }

  const body = { model: MODEL, state, questions: toWire(specs) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Omitted entirely when absent, so an injecting proxy can add its own rather
        // than receiving a literal "Bearer undefined".
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Jev returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }

  const json = await res.json();
  debugDump({ request: body, response: json });

  const answers = json.answers ?? json.questions ?? json.results ?? json;
  const out = {};
  const unparsed = [];
  for (const spec of specs) {
    const norm = normalizeAnswer(answers[spec.id], spec);
    if (!norm || norm.value == null) unparsed.push(spec.id);
    out[spec.id] = norm;
  }

  // The wire format is unverified against a live response. If nothing parsed, say so
  // loudly with the actual payload rather than reporting a component with no findings.
  if (unparsed.length === specs.length) {
    throw new Error(
      `Jev responded, but no answer could be parsed for any of ${specs.length} question(s).\n` +
        `This usually means the response shape differs from what normalizeAnswer() expects.\n` +
        `Response was:\n${JSON.stringify(json, null, 2).slice(0, 2000)}\n` +
        `Fix toWire()/normalizeAnswer() in src/jev.js to match.`
    );
  }
  if (unparsed.length) {
    console.warn(`Jev: could not parse an answer for: ${unparsed.join(', ')}`);
  }
  return out;
}

/** With JEV_DEBUG=1, persist the exact request and response for inspection. */
function debugDump(payload) {
  if (process.env.JEV_DEBUG !== '1') return;
  const dir = process.env.HALLWAY_OUT || '.hallway';
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `jev-exchange-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    console.log(`Jev exchange written to ${file}`);
  } catch (err) {
    console.warn(`Could not write Jev debug dump: ${err.message}`);
  }
}

/**
 * Deterministic stand-in so the full pipeline runs with no API key. Same state and
 * question always produce the same numbers, which is what makes the demo and the
 * stability harness reproducible.
 */
export function mockEvaluate({ state, specs }) {
  const out = {};
  for (const spec of specs) {
    const h = createHash('sha256').update(`${state}::${spec.id}`).digest();
    const u = h.readUInt32BE(0) / 0xffffffff;
    if (spec.type === 'noul') {
      out[spec.id] = { type: 'noul', value: u, confidence: Math.abs(u - 0.5) * 2, probabilities: null, raw: { mock: true } };
    } else if (spec.type === 'choice') {
      const probs = spec.options.map((_, i) => (h.readUInt32BE((i % 6) * 4 + 4) / 0xffffffff) ** 2);
      const sum = probs.reduce((a, b) => a + b, 0);
      const norm = probs.map((p) => p / sum);
      const top = norm.indexOf(Math.max(...norm));
      out[spec.id] = {
        type: 'choice',
        value: spec.options[top],
        confidence: norm[top],
        probabilities: Object.fromEntries(spec.options.map((o, i) => [o, norm[i]])),
        raw: { mock: true },
      };
    } else {
      const max = spec.levels.length - 1;
      out[spec.id] = {
        type: 'score',
        value: u * max,
        confidence: 0.5 + u / 2,
        probabilities: null,
        raw: { mock: true },
      };
    }
  }
  return out;
}
