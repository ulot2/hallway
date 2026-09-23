// Calibration: measure whether Jev's probabilities mean what they say, and correct
// them if they do not. This is the part that makes confidence-based tiering honest.
//
// A "sample" is { p, y }: p is the model's predicted failure probability, y is 1 if a
// human said the component really did fail that question, 0 otherwise.

/** Pool-adjacent-violators. Returns the non-decreasing least-squares fit of y. */
export function pava(y, w = y.map(() => 1)) {
  const vals = [...y];
  const wts = [...w];
  const idx = y.map((_, i) => i);
  // Each block is [startIndex, length, weightedMean, weight].
  const blocks = vals.map((v, i) => ({ start: i, len: 1, mean: v, weight: wts[i] }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].mean <= blocks[i + 1].mean + 1e-12) {
      i += 1;
      continue;
    }
    const a = blocks[i];
    const b = blocks[i + 1];
    const weight = a.weight + b.weight;
    blocks.splice(i, 2, {
      start: a.start,
      len: a.len + b.len,
      mean: (a.mean * a.weight + b.mean * b.weight) / weight,
      weight,
    });
    if (i > 0) i -= 1;
  }
  const out = new Array(idx.length);
  for (const blk of blocks) {
    for (let k = 0; k < blk.len; k += 1) out[blk.start + k] = blk.mean;
  }
  return out;
}

/** Fit an isotonic correction from hand-labeled samples. */
export function fitIsotonic(samples) {
  if (samples.length < 2) return { knots: [] };
  const sorted = [...samples].sort((a, b) => a.p - b.p);
  const fitted = pava(sorted.map((s) => s.y));
  const knots = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const last = knots[knots.length - 1];
    if (!last || last.x !== sorted[i].p) knots.push({ x: sorted[i].p, y: fitted[i] });
    else last.y = fitted[i];
  }
  return { knots, n: samples.length };
}

/** Apply a fitted correction, interpolating between knots. */
export function applyIsotonic(model, p) {
  const k = model?.knots;
  if (!k?.length) return p;
  if (p <= k[0].x) return k[0].y;
  if (p >= k[k.length - 1].x) return k[k.length - 1].y;
  for (let i = 1; i < k.length; i += 1) {
    if (p <= k[i].x) {
      const span = k[i].x - k[i - 1].x;
      if (span <= 0) return k[i].y;
      const t = (p - k[i - 1].x) / span;
      return k[i - 1].y + t * (k[i].y - k[i - 1].y);
    }
  }
  return p;
}

/** Equal-width reliability bins. */
export function reliability(samples, nBins = 10) {
  const bins = Array.from({ length: nBins }, (_, i) => ({
    lo: i / nBins,
    hi: (i + 1) / nBins,
    n: 0,
    sumP: 0,
    sumY: 0,
  }));
  for (const s of samples) {
    const i = Math.min(nBins - 1, Math.floor(s.p * nBins));
    bins[i].n += 1;
    bins[i].sumP += s.p;
    bins[i].sumY += s.y;
  }
  return bins.map((b) => ({
    ...b,
    meanPred: b.n ? b.sumP / b.n : null,
    meanObs: b.n ? b.sumY / b.n : null,
  }));
}

/** Expected calibration error: average gap between claimed and observed, weighted. */
export function ece(samples, nBins = 10) {
  if (!samples.length) return null;
  return reliability(samples, nBins)
    .filter((b) => b.n)
    .reduce((acc, b) => acc + (b.n / samples.length) * Math.abs(b.meanObs - b.meanPred), 0);
}

/** Brier score: mean squared error of the probabilities. Lower is better. */
export function brier(samples) {
  if (!samples.length) return null;
  return samples.reduce((a, s) => a + (s.p - s.y) ** 2, 0) / samples.length;
}

/** Terminal reliability diagram. Perfect calibration puts both marks in one column. */
export function asciiDiagram(samples, nBins = 10, width = 40) {
  const bins = reliability(samples, nBins);
  const rows = ['  bucket      n   claimed  observed', '  ' + '-'.repeat(width + 32)];
  for (const b of bins) {
    const label = `${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`.padEnd(10);
    if (!b.n) {
      rows.push(`  ${label} ${String(0).padStart(4)}        -         -`);
      continue;
    }
    const bar = Array.from({ length: width }, () => ' ');
    bar[Math.min(width - 1, Math.round(b.meanPred * (width - 1)))] = '|';
    const obs = Math.min(width - 1, Math.round(b.meanObs * (width - 1)));
    bar[obs] = bar[obs] === '|' ? '#' : 'o';
    rows.push(
      `  ${label} ${String(b.n).padStart(4)}   ${b.meanPred.toFixed(3)}     ${b.meanObs.toFixed(3)}  ${bar.join('')}`
    );
  }
  rows.push('', '  | claimed    o observed    # both (well calibrated)');
  return rows.join('\n');
}
