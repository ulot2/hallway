// Turns a rendered component into a compact plain-text "state" for Jev.
//
// Deliberately structural: the accessibility tree plus visible copy. There is no
// geometry here (no position, size, contrast or overlap), so this pipeline reviews
// structure and language only. See the "What this cannot see" section of the README.

const DESTRUCTIVE = /\b(delete|remove|destroy|erase|wipe|revoke|cancel subscription|deactivate|close account|reset)\b/i;
const ERROR_HINT = /\b(error|invalid|required|failed|must be|cannot|not allowed|try again|wrong)\b/i;
const EMPTY_HINT = /\b(no results|nothing here|no items|empty|none found|no data|you have no|get started)\b/i;

// Storybook renders the story into its own root and keeps scaffolding (a controls
// table template, documentation links) elsewhere in the same document. Scanning the
// whole body scoops that up and feeds it to the model as if it were the component.
const ROOT_CANDIDATES = ['#storybook-root', '#root', 'body'];

export async function resolveRoot(page, rootSelector) {
  if (rootSelector) return rootSelector;
  for (const sel of ROOT_CANDIDATES) {
    if (await page.locator(sel).count()) return sel;
  }
  return 'body';
}

/** Collect the accessibility tree, visible copy and control inventory for a page. */
export async function extractState(page, { url, name, rootSelector } = {}) {
  const root = await resolveRoot(page, rootSelector);
  const aria = await page.locator(root).ariaSnapshot();

  const { text, controls, html } = await page.evaluate((sel) => {
    const scope = document.querySelector(sel) ?? document.body;

    // `checkVisibility` walks the ancestor chain, so it catches a hidden wrapper that
    // a computed-style check on the immediate parent would miss.
    const visible = (el) => {
      if (!el) return false;
      if (typeof el.checkVisibility === 'function') {
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const out = [];
    const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!visible(n.parentElement)) continue;
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }

    const controlSel = 'button, a[href], input, select, textarea, [role="button"], [role="link"]';
    const ctrls = [...scope.querySelectorAll(controlSel)]
      .filter(visible)
      .map((el) => ({
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

    // The rendered markup, so a human labeler sees the component rather than its
    // accessibility tree. Scripts and inline handlers are stripped here and again at
    // render time; nothing downstream executes it.
    const clone = scope.cloneNode(true);
    clone.querySelectorAll('script, style, iframe, object, embed').forEach((n) => n.remove());
    clone.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
      }
    });

    return { text: out, controls: ctrls, html: clone.innerHTML };
  }, root);

  const joined = text.join(' ');
  const signals = {
    // Certain, not guessed: the extractor has the control list in hand. Asking Jev to
    // judge button labels on a component with no buttons produced confident nonsense.
    has_controls: controls.length > 0,
    has_error_text: ERROR_HINT.test(joined),
    has_empty_state: EMPTY_HINT.test(joined),
    has_destructive_action:
      DESTRUCTIVE.test(joined) || controls.some((c) => DESTRUCTIVE.test(c.label)),
  };

  return { name: name ?? url, url, root, aria, text, controls, html, signals };
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
