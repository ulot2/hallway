// Builds the single sticky PR comment.
//
// Two rules drive the layout: deterministic findings are presented as facts and
// separated from probabilistic ones, and uncertain findings are collapsed context
// rather than errors.

export const MARKER = '<!-- jev-ui-review -->';
const STATE_RE = /<!-- jev-state (.*?) -->/s;

const pct = (p) => `${Math.round(p * 100)}%`;

/** Previous tiers are round-tripped through the comment so hysteresis survives reruns. */
export function encodeState(components) {
  const tiers = {};
  for (const c of components) {
    tiers[c.name] = Object.fromEntries(
      c.findings.filter((f) => f.tier).map((f) => [f.id, f.tier])
    );
  }
  return `<!-- jev-state ${JSON.stringify(tiers)} -->`;
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

  const out = [MARKER, '## UI review', ''];

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
  return bits.join('');
}

const format = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));

function footer(meta, components) {
  const lines = [];
  const calibrated = components.some((c) => c.findings.some((f) => f.calibrated));
  lines.push(
    `Question set v${meta.questionSetVersion ?? '?'} · ` +
      `thresholds: blocking ≥ ${meta.thresholds?.blockingAt ?? 0.85}, ` +
      `worth a look ≥ ${meta.thresholds?.lookAt ?? 0.55}`
  );
  lines.push(
    calibrated
      ? '\nProbabilities are corrected by a fitted isotonic calibration.'
      : '\n⚠️ Uncalibrated: thresholds are defaults, not measured on this repo. Run `npm run calibrate`.'
  );
  if (meta.skipped) {
    lines.push(`\n${meta.skipped} further affected story(ies) skipped by the per-run cap.`);
  }
  if (meta.stateArtifact) {
    lines.push(`\nExact state and questions sent to Jev: \`${meta.stateArtifact}\` artifact.`);
  }
  return lines.join('');
}
