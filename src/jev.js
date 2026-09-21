// The ONLY module that knows Jev's wire format.
//
// Jev is in beta and the request/response shape may still move. Everything
// downstream consumes the normalized shape returned by `evaluate()`:
//
//   { [questionId]: { type, value, confidence, probabilities } }
//
// If the API changes, fix `toWire()` and `normalizeAnswer()` and nothing else.

import { createHash } from 'node:crypto';

const ENDPOINT = process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-latest';

/** questions.json specs -> the questions map Jev expects. */
export function toWire(specs) {
  const questions = {};
  for (const spec of specs) {
    if (spec.type === 'noul') {
      questions[spec.id] = { type: 'noul', question: spec.question };
    } else if (spec.type === 'choice') {
      questions[spec.id] = { type: 'choice', question: spec.question, options: spec.options };
    } else if (spec.type === 'score') {
      questions[spec.id] = { type: 'score', question: spec.question, levels: spec.levels };
    } else {
      throw new Error(`Unknown question type "${spec.type}" for question "${spec.id}"`);
    }
  }
  return questions;
}

/** Tolerant parse: beta APIs rename fields, and we would rather degrade than crash. */
export function normalizeAnswer(raw, spec) {
  if (raw == null) return null;
  const value = raw.value ?? raw.answer ?? raw.score ?? raw.choice ?? raw.probability ?? null;
  const confidence = raw.confidence ?? raw.certainty ?? null;
  const probabilities = raw.probabilities ?? raw.probs ?? raw.distribution ?? null;
  return { type: spec.type, value, confidence, probabilities, raw };
}

/**
 * Evaluate one component state against every applicable question in a single call,
 * so the questions run in parallel server-side.
 */
export async function evaluate({ state, specs, apiKey, timeoutMs = 30_000 }) {
  if (!specs.length) return {};
  if (!apiKey || apiKey === 'mock' || process.env.JEV_MOCK === '1') {
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
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
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
  const answers = json.answers ?? json.questions ?? json.results ?? json;
  const out = {};
  for (const spec of specs) {
    out[spec.id] = normalizeAnswer(answers[spec.id], spec);
  }
  return out;
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
