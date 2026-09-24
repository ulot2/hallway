// Builds the single sticky PR comment.
//
// Two rules drive the layout: deterministic findings are presented as facts and
// separated from probabilistic ones, and uncertain findings are collapsed context
// rather than errors.

export const MARKER = '<!-- hallway -->';
const STATE_RE = /<!-- hallway-state (.*?) -->/s;

const pct = (p) => `${Math.round(p * 100)}%`;

/** Previous tiers are round-tripped through the comment so hysteresis survives reruns. */
export function encodeState(components) {
  const tiers = {};
  for (const c of components) {
    tiers[c.name] = Object.fromEntries(
      c.findings.filter((f) => f.tier).map((f) => [f.id, f.tier])
    );
  }
  return `<!-- hallway-state ${JSON.stringify(tiers)} -->`;
}

export function decodeState(body) {
  const m = body?.match(STATE_RE);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}

const HEADING = '## Hallway · UI review';

// The check run already shows its name, so the report's own heading would repeat it.
// Promote the counts line to the check title and drop both from the summary.
export function checkOutput(body) {
  const lines = body.split('\n').filter((l) => !l.startsWith('<!-- hallway'));
  while (lines.length && (lines[0] === HEADING || lines[0] === '')) lines.shift();
  const title = (lines.shift() ?? 'Hallway').replace(/\*\*/g, '');
  while (lines.length && lines[0] === '') lines.shift();
  return { title, summary: lines.join('\n').slice(0, 65_000) || title };
}

export function checkConclusion(components) {
  const blocking = components.some((c) => c.findings.some((f) => f.tier === 'blocking'));
  return blocking ? 'failure' : 'success';
}

export function renderReport(components, meta = {}) {
  const blocking = [];
  const look = [];
  for (const c of components) {
    for (const f of c.findings) {
      if (f.tier === 'blocking') blocking.push({ c, f });
      else if (f.tier === 'look') look.push({ c, f });
    }
  }
  const axeCount = components.reduce(
    (a, c) => a + (Array.isArray(c.axe) ? c.axe.length : 0),
    0
  );

  const out = [MARKER, HEADING, ''];

  if (!blocking.length && !look.length && !axeCount) {
    out.push(`No findings across ${components.length} component(s).`, '');
  } else {
    out.push(
      `**${blocking.length}** blocking · **${look.length}** worth a look · ` +
        `**${axeCount}** deterministic · ${components.length} component(s) reviewed`,
      ''
    );
  }

  if (axeCount) {
    out.push('### Accessibility violations (axe-core)', '');
    out.push('These are certain, not probabilistic.', '');
    for (const c of components) {
      if (!Array.isArray(c.axe) || !c.axe.length) continue;
      out.push(`**${c.name}**`, '');
      for (const v of c.axe) {
        out.push(`- \`${v.id}\` (${v.impact}) — ${v.help} · ${v.nodes} node(s)`);
      }
      out.push('');
    }
  }

  if (blocking.length) {
    out.push('### Blocking', '');
    for (const c of components) {
      const items = c.findings.filter((f) => f.tier === 'blocking');
      if (!items.length) continue;
      out.push(`**${c.name}**`, '');
      for (const f of items) out.push(`- ${line(f)}`);
      out.push('');
    }
  }

  if (look.length) {
    out.push('<details>', `<summary>Worth a look (${look.length})</summary>`, '');
    out.push('Below the blocking threshold. Informational only; these never fail the check.', '');
    for (const c of components) {
      const items = c.findings.filter((f) => f.tier === 'look');
      if (!items.length) continue;
      out.push(`**${c.name}**`, '');
      for (const f of items) out.push(`- ${line(f)}`);
      out.push('');
    }
    out.push('</details>', '');
  }

  out.push('---', '');
  out.push(footer(meta, components));
  out.push('', encodeState(components));
  return out.join('\n');
}

function line(f) {
  const bits = [`\`${f.id}\` — ${f.question}`];
  bits.push(`  \n  answer: \`${format(f.value)}\` · failure probability **${pct(f.p)}**`);
  if (f.confidence != null) bits.push(` · model confidence ${pct(Number(f.confidence))}`);
  if (f.basis === 'point-estimate') bits.push(' · _approximated from a point estimate_');
  if (f.calibrated) bits.push(' · _calibrated_');
  if (f.capped) {
    const t = f.trust;
    bits.push(
      t
        ? ` · _advisory: agrees with human review at AUC ${t.auc ?? 'n/a'} over ${t.n} labels, below the bar to block_`
        : ' · _advisory: not yet measured against human review_'
    );
  }
  return bits.join('');
}

const format = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));

function footer(meta, components) {
  const lines = [];
  const calibrated = components.some((c) => c.findings.some((f) => f.calibrated));
  const measured = components.some((c) => c.findings.some((f) => f.trust));
  lines.push(
    `Question set v${meta.questionSetVersion ?? '?'} · ` +
      `thresholds: blocking ≥ ${meta.thresholds?.blockingAt ?? 0.85}, ` +
      `worth a look ≥ ${meta.thresholds?.lookAt ?? 0.55}`
  );
  if (calibrated) {
    lines.push('\nProbabilities are corrected by a fitted isotonic calibration.');
  } else if (measured) {
    lines.push('\nQuestions are measured against human labels; only those that agree well may block. No probability correction beat the raw scores on held-out data, so none is applied.');
  } else {
    lines.push('\n⚠️ Uncalibrated: thresholds are defaults, not measured on this repo. Run `npm run calibrate`.');
  }
  if (meta.skipped) {
    lines.push(`\n${meta.skipped} further affected story(ies) skipped by the per-run cap.`);
  }
  if (meta.stateArtifact) {
    lines.push(`\nExact state and questions sent to Jev: \`${meta.stateArtifact}\` artifact.`);
  }
  return lines.join('');
}
