// Turns a Jev answer into a calibrated probability that the component actually fails
// the question, then sorts it into one of three tiers. Nothing else in the pipeline
// looks at raw model output.

import { applyIsotonic } from './calibrate.js';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Skip questions whose precondition is not present in the component. */
export function applies(spec, signals = {}) {
  return !spec.applies_when || signals[spec.applies_when] === true;
}

/**
 * P(this component fails this question), in [0, 1].
 *
 * The whole point of using Jev over a text model is that this number exists and means
 * something. Where the API returns a distribution we use it; where it returns only a
 * point value plus confidence we fall back to a logistic around the failure threshold,
 * which is an approximation and is flagged as such in the output.
 */
export function failureProbability(answer, spec) {
  if (!answer) return { p: null, basis: 'missing' };

  if (spec.type === 'noul') {
    const pTrue = Number(answer.value);
    if (!Number.isFinite(pTrue)) return { p: null, basis: 'unparseable' };
    return { p: spec.fail_when === 'false' ? 1 - pTrue : pTrue, basis: 'distribution' };
  }

  if (spec.type === 'choice') {
    const fail = new Set(spec.fail_options ?? []);
    if (answer.probabilities) {
      const p = Object.entries(answer.probabilities)
        .filter(([opt]) => fail.has(opt))
        .reduce((a, [, v]) => a + Number(v), 0);
      return { p, basis: 'distribution' };
    }
    const conf = Number(answer.confidence);
    if (!Number.isFinite(conf)) return { p: null, basis: 'unparseable' };
    return { p: fail.has(answer.value) ? conf : 1 - conf, basis: 'point-estimate' };
  }

  if (spec.type === 'score') {
    if (answer.probabilities && spec.levels) {
      const p = Object.entries(answer.probabilities)
        .filter(([lvl]) => spec.levels.indexOf(lvl) < spec.fail_at)
        .reduce((a, [, v]) => a + Number(v), 0);
      return { p, basis: 'distribution' };
    }
    const value = Number(answer.value);
    const conf = Number(answer.confidence ?? 0.5);
    if (!Number.isFinite(value)) return { p: null, basis: 'unparseable' };
    // Sharper logistic when the model is confident, flatter when it is not.
    const k = 2 + 6 * Math.max(0, Math.min(1, conf));
    const below = spec.fail_when === 'below';
    const margin = below ? spec.fail_at - value : value - spec.fail_at;
    return { p: sigmoid(margin * k), basis: 'point-estimate' };
  }

  return { p: null, basis: 'unknown-type' };
}

/**
 * Three tiers, not two. `blocking` can fail the check; `look` is collapsed context;
 * `silent` is suppressed entirely. Every finding has a documented bar to clear.
 */
export function tierFor(p, { blockingAt = 0.85, lookAt = 0.55 } = {}) {
  if (p == null) return 'silent';
  if (p >= blockingAt) return 'blocking';
  if (p >= lookAt) return 'look';
  return 'silent';
}

/**
 * Hysteresis: once something is reported, it takes a margin of movement to stop being
 * reported, so a finding does not flicker on and off across pushes of identical code.
 */
export function tierWithHysteresis(p, previousTier, thresholds = {}, margin = 0.05) {
  const base = tierFor(p, thresholds);
  if (!previousTier || previousTier === base) return base;
  const { blockingAt = 0.85, lookAt = 0.55 } = thresholds;
  if (previousTier === 'blocking' && p >= blockingAt - margin) return 'blocking';
  if (previousTier !== 'silent' && p >= lookAt - margin) return 'look';
  return base;
}

/** Score one component against every applicable question. */
export function assess({ answers, specs, signals, calibration = {}, thresholds = {}, previous = {} }) {
  const findings = [];
  for (const spec of specs) {
    if (!applies(spec, signals)) {
      findings.push({ id: spec.id, skipped: `precondition "${spec.applies_when}" not present` });
      continue;
    }
    const answer = answers[spec.id];
    const { p: raw, basis } = failureProbability(answer, spec);
    const model = calibration[spec.id];
    const p = raw == null ? null : applyIsotonic(model, raw);
    findings.push({
      id: spec.id,
      question: spec.question,
      type: spec.type,
      value: answer?.value ?? null,
      confidence: answer?.confidence ?? null,
      rawP: raw,
      p,
      calibrated: Boolean(model?.knots?.length),
      basis,
      tier: tierWithHysteresis(p, previous[spec.id], thresholds),
    });
  }
  return findings;
}
