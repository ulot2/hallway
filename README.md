# jev-ui-review

A GitHub Action that reviews the **copy and structure** of changed UI components on a
pull request, using [Jev](https://docs.typesafe.ai/api) — TypeSafe AI's System One
model — for the judgment calls, and `axe-core` for everything that can be decided
deterministically.

> **Status: scaffold.** The pipeline runs end to end today against local fixtures with
> a deterministic mock. It has not yet been pointed at a real Storybook or a live Jev
> key. See [What is not done yet](#what-is-not-done-yet).

## The argument

Most "AI reviews your PR" tools ask a language model questions that a linter already
answers with certainty, then present the answer as prose with no error bars. This does
the opposite:

1. **`axe-core` runs first and owns every checkable rule.** Missing labels, heading
   order, ARIA misuse, contrast. These are facts, reported as facts.
2. **Jev is asked only what no linter can answer.** Is the primary action obvious? Does
   this error message tell the user how to *fix* the problem? Is this empty state a dead
   end? Do the button labels mean anything?
3. **Every Jev finding carries a failure probability, and the probability decides the
   tier.** Confident findings block. Uncertain ones are collapsed context. The rest are
   silent. There is a documented bar for suppressing something, not just a vibe.

That split is not a detail, it is the product. Running the demo shows it directly: on
the deliberately-bad fixture, axe returns `heading-order`, `html-has-lang`,
`landmark-one-main` and `page-has-heading-one` for free, in milliseconds, with no API
call — so none of those are wasted on Jev.

## Quickstart

No API key needed. The Jev client falls back to a deterministic mock, so the whole
pipeline is runnable and reproducible offline.

```bash
npm install
npm run extract:demo   # what the components look like as state
npm run review:demo    # the full pipeline, prints the PR comment it would post
npm test               # 35 unit tests
```

To use a real key:

```bash
JEV_API_KEY=sk-... npm run review:demo
```

## How it works

```
changed files
   │  reverse import graph, transitive closure      src/stories.js
   ▼
affected stories  ──►  Playwright renders each one   src/extract.js
   │                        │
   │                        ├─ axe-core          ──►  certain findings
   │                        └─ aria tree + copy  ──►  the "state" string
   ▼
Jev: one call per component, all questions at once   src/jev.js
   │  failure probability per question               src/tier.js
   │  isotonic calibration correction                src/calibrate.js
   ▼
three tiers ──► one sticky PR comment                src/report.js
```

Two details worth calling out:

**Changed-file resolution follows the import graph.** A one-line change to a shared
`Button` modifies no story file at all, yet affects every story that renders it.
`src/stories.js` builds a reverse import graph (including bare side-effect imports) and
takes the transitive closure, so those stories are reviewed. Matching on `*.stories.*`
alone would miss exactly the regressions that matter most.

**The wire format lives in exactly one file.** Jev is in beta. `src/jev.js` is the only
module that knows the endpoint, the request body or the response field names; everything
downstream consumes a normalized shape. If the API moves, fix `toWire()` and
`normalizeAnswer()` and nothing else changes.

## Fork pull requests and the API key

Pull requests from forks cannot read repository secrets. The usual workaround,
`pull_request_target`, is a well-known footgun: it runs with your secrets in scope, and
checking out the PR head there hands those secrets to anyone who can open a pull
request.

This repo uses the two-workflow pattern instead:

| Phase | Trigger | Runs PR code | Has secrets |
|---|---|---|---|
| `ui-review.yml` | `pull_request` | yes | **no** |
| `ui-review-report.yml` | `workflow_run` | **no** | yes |

Phase 1 builds Storybook, renders the components and writes a JSON artifact. Phase 2
runs from the default branch, downloads only that JSON, calls Jev and posts. There is no
path from fork code to the key.

## Calibration

Confidence thresholds are worthless if the probabilities are not calibrated, and
calibration is a property of *your* data, not of the model in general. So measure it:

```bash
npm run review:demo            # produces .jev-review/findings.json
npm run label                  # hand-label findings: y / n / skip
npm run calibrate              # reliability diagram, ECE, Brier, writes calibration.json
```

Budget about an hour for ~100 labels. `npm run calibrate -- --demo` runs the harness on
synthetic overconfident data so you can see it work before labeling anything:

```
  bucket      n   claimed  observed
  0.5-0.6      14   0.552     0.214          o             |
  0.6-0.7      24   0.648     0.500                      o    |
  0.8-0.9      29   0.841     0.828                                  o|

  held out, 5-fold:
  ECE    0.1287  ->  0.0531
  Brier  0.1828  ->  0.1626
```

Those numbers are **cross-validated, not in-sample**. Isotonic regression fits its own
training data perfectly, so an in-sample ECE of 0.0000 would mean nothing; the harness
reports 5-fold held-out numbers and refuses to save a correction that does not help out
of sample.

Once `calibration.json` exists it is applied to every probability automatically, and the
PR comment says findings are calibrated. Without it, the comment carries a visible
warning that the thresholds are unmeasured defaults.

### Stability

If a finding flips on and off across pushes of identical code, developers stop trusting
the bot within a week.

```bash
JEV_API_KEY=sk-... npm run stability -- 10
```

Runs the same unchanged component N times and reports mean, standard deviation and
whether any question crossed the blocking threshold in both directions. Run this before
shipping and put the numbers here.

`src/tier.js` also applies hysteresis: a reported finding takes an extra 0.05 of movement
to stop being reported, and steps down a tier at a time rather than vanishing.

## What this cannot see

The state sent to Jev is the accessibility tree plus visible copy. **There is no
geometry in it** — no position, size, contrast, overlap or z-order. A button that is
white-on-white, pushed off-screen or covered by a modal looks perfect to this pipeline.

That is a deliberate MVP scope choice: it keeps the per-PR cost bounded and it means no
screenshots leave CI. But it means this reviews *structure and language*, not visual
design, and it should not be described as doing more.

## Configuration

Questions live in `questions.json` so they can be edited without touching code. Each
entry declares its type (`noul` / `choice` / `score`), what counts as failure, and an
optional `applies_when` precondition so questions about error messages are not asked of
components that have none.

Action inputs: `mode`, `storybook-dir`, `questions`, `calibration`, `max-stories`,
`blocking-at`, `look-at`, `base-ref`, `set-check`, `jev-api-key`, `github-token`.

Cost control is explicit: `max-stories` caps reviewed stories per run, and when the cap
truncates a run the PR comment says so rather than silently reviewing less.

## What is not done yet

- Never run against a real Storybook build — only the local HTML fixtures.
- Never run against the live Jev API. The wire format was derived from published docs
  and examples, not verified against a live response; `normalizeAnswer()` is
  deliberately tolerant for this reason.
- No calibration data from a real repo, so the default thresholds (0.85 / 0.55) are
  guesses. They are marked as such in every uncalibrated comment.
- No published Marketplace release. That waits until it has run green on a repo that
  isn't this one.
- `applies_when` preconditions are keyword heuristics, not semantic checks.

## Layout

```
action.yml              composite action definition
questions.json          the editable question set
src/stories.js          changed files -> affected stories, via the import graph
src/extract.js          Playwright -> aria tree, copy, controls, signals
src/browser.js          Chromium resolution, preferring a preinstalled build
src/serve.js            static server for the built Storybook
src/jev.js              the only module that knows Jev's wire format
src/tier.js             answer -> failure probability -> tier
src/calibrate.js        PAVA isotonic regression, ECE, Brier, reliability diagram
src/report.js           sticky comment rendering and state round-trip
src/extract-main.js     phase 1 entrypoint (no secrets)
src/review-main.js      phase 2 entrypoint (secrets, no PR code)
scripts/                demo, labeling, calibration and stability harnesses
fixtures/               a deliberately bad component and its fixed version
```
