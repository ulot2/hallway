// Turns a rendered component into a compact plain-text "state" for Jev.
//
// Deliberately structural: the accessibility tree plus visible copy. There is no
// geometry here (no position, size, contrast or overlap), so this pipeline reviews
// structure and language only. See the "What this cannot see" section of the README.

const DESTRUCTIVE = /\b(delete|remove|destroy|erase|wipe|revoke|cancel subscription|deactivate|close account|reset)\b/i;
const ERROR_HINT = /\b(error|invalid|required|failed|must be|cannot|not allowed|try again|wrong)\b/i;
const EMPTY_HINT = /\b(no results|nothing here|no items|empty|none found|no data|you have no|get started)\b/i;

/** Collect the accessibility tree, visible copy and control inventory for a page. */
export async function extractState(page, { url, name } = {}) {
  const aria = await page.locator('body').ariaSnapshot();

  const text = await page.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const parent = n.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out;
  });

  const controls = await page.evaluate(() => {
    const sel = 'button, a[href], input, select, textarea, [role="button"], [role="link"]';
    return [...document.querySelectorAll(sel)].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      label: (
        el.getAttribute('aria-label') ||
        el.labels?.[0]?.textContent ||
        el.textContent ||
        el.getAttribute('placeholder') ||
        ''
      ).replace(/\s+/g, ' ').trim(),
      disabled: el.disabled === true,
    }));
  });

  const joined = text.join(' ');
  const signals = {
    has_error_text: ERROR_HINT.test(joined),
    has_empty_state: EMPTY_HINT.test(joined),
    has_destructive_action:
      DESTRUCTIVE.test(joined) || controls.some((c) => DESTRUCTIVE.test(c.label)),
  };

  return { name: name ?? url, url, aria, text, controls, signals };
}

/** Run the deterministic pass. Jev never sees questions axe can already answer. */
export async function runAxe(page) {
  try {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
      .analyze();
    return results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
    }));
  } catch (err) {
    return { error: `axe unavailable: ${err.message}` };
  }
}

/** Render the state as the plain text Jev evaluates. Keep it short and stable. */
export function describe(state, { maxChars = 4000 } = {}) {
  const lines = [
    `Component: ${state.name}`,
    '',
    'Accessibility tree:',
    state.aria.trim(),
    '',
    'Visible text, in order:',
    ...state.text.map((t) => `- ${t}`),
    '',
    'Interactive controls:',
    ...state.controls.map(
      (c) =>
        `- <${c.tag}${c.type ? ` type=${c.type}` : ''}> "${c.label || '(no accessible name)'}"` +
        (c.disabled ? ' [disabled]' : '')
    ),
  ];
  const out = lines.join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…(truncated)` : out;
}
