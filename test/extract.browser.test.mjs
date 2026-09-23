// Browser-backed tests. Slower than the unit suite, so they run separately:
//   npm run test:browser
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../src/browser.js';
import { extractState, resolveRoot, describe } from '../src/extract.js';

const fixture = (f) => pathToFileURL(path.resolve('fixtures', f)).href;

let browser;
let page;
test.before(async () => {
  browser = await launch();
  page = await (await browser.newContext()).newPage();
});
test.after(async () => { await browser?.close(); });

test('extraction is scoped to the story root, not the whole document', async () => {
  await page.goto(fixture('scoped-root.html'));
  const state = await extractState(page, { name: 'scoped' });

  assert.equal(state.root, '#storybook-root');
  // Storybook's own chrome lives outside the root and must never reach the model.
  assert.ok(!state.text.includes('Scaffolding text'), 'scaffolding text leaked');
  assert.ok(
    !state.controls.some((c) => c.label.includes('Scaffolding')),
    'scaffolding controls leaked'
  );
  assert.ok(state.text.includes('Real text'));
});

test('hidden elements are excluded, however they are hidden', async () => {
  await page.goto(fixture('scoped-root.html'));
  const { text, controls } = await extractState(page, { name: 'scoped' });
  const labels = controls.map((c) => c.label);

  assert.deepEqual(labels, ['Real button']);
  for (const hidden of ['Display-none text']) {
    assert.ok(!text.includes(hidden), `${hidden} leaked`);
  }
});

test('resolveRoot falls back to body when there is no story root', async () => {
  await page.goto(fixture('bad-component.html'));
  assert.equal(await resolveRoot(page), 'body');
});

test('keyword signals catch the obvious cases', async () => {
  await page.goto(fixture('good-component.html'));
  const { signals } = await extractState(page, { name: 'good' });
  assert.equal(signals.has_destructive_action, true);
});

test('keyword signals miss naturally-phrased empty states', async () => {
  // "No one else has access yet" is an empty state that no keyword list catches.
  // This is why preconditions are gate questions now rather than regexes; the
  // signals remain only as cheap debugging context in the state log.
  await page.goto(fixture('good-component.html'));
  const { signals } = await extractState(page, { name: 'good' });
  assert.equal(signals.has_empty_state, false);
});

test('the primary action is marked for Jev', async () => {
  await page.setContent(`
    <div id="storybook-root">
      <button data-variant="primary">Pay $42.00</button>
      <button>Back to cart</button>
      <a class="btn btn-primary" href="#">Checkout</a>
    </div>`);
  const state = await extractState(page, { name: 'primary' });
  const byLabel = Object.fromEntries(state.controls.map((c) => [c.label, c.primary]));
  assert.equal(byLabel['Pay $42.00'], true);
  assert.equal(byLabel['Back to cart'], false);
  assert.equal(byLabel.Checkout, true);
  const text = describe(state);
  assert.match(text, /"Pay \$42\.00" \[primary\]/);
  assert.doesNotMatch(text, /"Back to cart" \[primary\]/);
});
