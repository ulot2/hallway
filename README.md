# Hallway

**Hallway testing for every pull request.** Usability people call it hallway testing:
grab someone walking past and ask whether a screen makes sense to them. Hallway asks
that question of every UI component a pull request changes — and only fails the build
on the questions it has *proven* it can judge.

It is a GitHub Action that reviews the **copy and structure** of changed UI components,
using [Jev](https://docs.typesafe.ai/api) — TypeSafe AI's System One
model — for the judgment calls, and `axe-core` for everything that can be decided
deterministically.

> **Status: verified end to end against a real Storybook and the live Jev API**
> (`jev-1.13.0`), and measured against four rounds of blind human labels. Five of six
> questions agree with human review well enough to fail a build; the sixth appears
> as advice only. See [Calibration results](#calibration-results).

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
npm test               # 44 unit tests
npm run test:browser   # 5 browser-backed tests
```

Against a real Storybook:

```bash
cd example && npm install && npm run build-storybook && cd ..
npm run example        # simulates a PR that changes a shared component
```

To use a real key:

```bash
JEV_API_KEY=sk-... npm run review:demo
```

## The example app

`example/` is a small React + Storybook 10 project with three components: a shared
`Button`, a deliberately confusing `SettingsPanel`, and a clear `InviteForm`. It exists
so the pipeline can be exercised against a genuine Storybook build rather than fixtures,
and `npm run example` runs that as an integration check in CI.

It simulates a pull request that changes `example/src/Button.jsx` — a file neither story
file mentions and neither story imports directly. Both stories are still reviewed,
which is the import-graph claim below, demonstrated rather than asserted.

### What the live API run established

Running against `jev-1.13.0` on the example app produced a clean split: every finding
landed on the confusing component, and the well-written one produced none.

| Question | Settings/Panel (bad) | Invite form (good) |
| :--- | :--- | :--- |
| `error_message_actionable` | 0.05 → blocking | gate closed, not asked |
| `button_label_quality` | `generic` → blocking | silent |
| `destructive_action_guarded` | 0.03 → blocking | gate closed, not asked |
| `empty_state_actionable` | 0.24 → worth a look | 0.98 → silent |

The last row is the gate-question design paying off. `shows_empty_state` scored **0.87**
on the good component — Jev recognised "No one has been invited yet" as an empty state,
which the keyword heuristic scored `false`. It then asked the follow-up and answered
0.98: the empty state points somewhere, so no finding. The heuristic would have skipped
that question entirely.

### What the real integration caught

Both of these passed every fixture test and would have silently degraded every review:

**Storybook's own chrome was being fed to the model.** The extractor scanned the whole
`<body>`, and Storybook 10 keeps a controls-table template and documentation links in
the same document as the story. The model was reading "propertyName", "Set string" and
"Decorators documentation" as if they were part of the component. Extraction is now
scoped to the story root, and hidden elements are filtered with `checkVisibility()`
rather than a computed-style check on the immediate parent.

**Keyword preconditions missed the cases that mattered.** The empty state
"No one else has access yet. Invite a teammate to collaborate" matches no plausible
keyword list, so the empty-state question was being skipped exactly when it had
something to say. That is what motivated gate questions.

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
| `hallway.yml` | `pull_request` | yes | **no** |
| `hallway-report.yml` | `workflow_run` | **no** | yes |

Phase 1 builds Storybook, renders the components and writes a JSON artifact. Phase 2
runs from the default branch, downloads only that JSON, calls Jev and posts. There is no
path from fork code to the key.

## Adding your API key

### The key is injected by a proxy

If the `Authorization` header is added after the request leaves your machine — a
gateway, or a Claude Code cloud environment **API credential** — then no key exists in
the session, and the client would otherwise fall back silently to the mock. Set
`JEV_LIVE=1` instead of a key. The request then goes out with no `Authorization`
header for the proxy to fill in.

```bash
JEV_LIVE=1 npm run check-key
JEV_LIVE=1 npm run example
```

### No local checkout?

If you are working from a cloud session and have no machine to clone onto, use GitHub
Actions as the runner — it has open internet access and you need nothing but a browser:

1. Add the key at **Settings → Secrets and variables → Actions → New repository
   secret**, named `JEV_API_KEY`.
2. Go to **Actions → Check Jev key → Run workflow**. Tick *run_example* to run the
   whole pipeline against the example Storybook as well.
3. Read the output in the run log. The raw request and response are printed, and the
   full exchange is uploaded as an artifact.

The workflow is `workflow_dispatch` only, so a fork pull request can never trigger it.
On a **public** repository the run log is world-readable: GitHub masks the secret and
this script never prints key material, but the Jev response is printed in full, so do
not point it at anything confidential.

The other option is to allow `api.typesafe.ai` in your cloud environment's network
egress settings, after which the scripts work directly in the session. See the
[Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web).

### Locally

Put it in a `.env` file. It is gitignored, and every script loads it automatically:

```bash
cp .env.example .env
# then edit .env and set JEV_API_KEY=...
npm run check-key
```

`npm run check-key` makes one small call and reports three things: whether the key
works, what a real response actually looks like, and whether this repo's parser
understands it. Run it before anything else — it isolates key problems from pipeline
problems, and distinguishes a network or proxy block from a genuine auth failure, which
otherwise look identical.

For a single command without a file: `JEV_API_KEY=... npm run check-key`. Prefer the
`.env` file for repeat use, so the key stays out of your shell history.

**In GitHub Actions**, add it as a repository secret named `JEV_API_KEY`:
Settings → Secrets and variables → Actions → New repository secret. The workflows
already reference `secrets.JEV_API_KEY`, and only the phase-2 workflow — the one that
never runs pull request code — can read it.

Never commit the key or paste it into an issue, a pull request or a chat window. If one
leaks, revoke it rather than deleting the message; it is already in the logs.

## Your first live run

Nothing in the code needs changing — set the key and the mock steps aside:

```bash
cd example && npm install && npm run build-storybook && cd ..
JEV_DEBUG=1 npm run example
```

`JEV_DEBUG=1` writes the exact request and response to
`example/.hallway/jev-exchange-*.json`. Keep it on for the first run.

The likeliest first failure is the response shape, since it was never verified against
a live API. If nothing parses, the run stops with the actual payload printed and points
at `toWire()` / `normalizeAnswer()` in `src/jev.js` — the only two functions that need
to change. A partial failure warns and names the questions it could not read.

Then, in order:

1. **Does it discriminate?** The findings should land on `Settings/Panel`, not on
   `Members/Invite form`. With the mock they land there by coincidence; with a real key
   it means something.
2. **Is it stable?** `npm run stability -- 10` — a standard deviation near zero, and no
   question crossing the threshold in both directions.
3. **Is it calibrated?** `npm run label`, then `npm run calibrate`. This replaces the
   guessed 0.85 / 0.55 thresholds with measured ones.

## Calibration

Confidence thresholds are worthless if the probabilities are not calibrated, and
calibration is a property of *your* data, not of the model in general. So measure it:

```bash
npm run review:demo            # produces .hallway/findings.json
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
of sample — on **both** ECE and Brier score. ECE alone is not enough: it is binned and
noisy, and a small-sample isotonic fit can lower it by flattening probabilities while
making them worse as forecasts. Brier is a proper scoring rule and cannot be gamed that
way. This was learned the hard way: a pooled fit over 96 labels cut held-out ECE from
0.126 to 0.074 while Brier rose from 0.184 to 0.188, and it was briefly saved, promoting
an empty-state finding to blocking on the strength of a model that failed the stricter
test.

Once `calibration.json` exists it is applied to every probability automatically, and the
PR comment says findings are calibrated. Without it, the comment carries a visible
warning that the thresholds are unmeasured defaults.

### Labeling, blind

`npm run label` is a terminal prompt, which is no use from a phone. The labeling set is
instead served by a small page, **Hallway Bench** (`calibration/bench.html`),
published as a claude.ai artifact that saves each answer as you go.

It is built to keep the labels honest:

- **Jev's answers are never shown.** `scripts/build-label-set.mjs` writes what the
  labeler sees (`calibration/items.json`) and what Jev predicted
  (`calibration/predictions.json`) to separate files, and only the first is published.
  A labeler shown "95% likely a problem" tends to agree, which makes calibration look
  better than it is.
- **Yes and No look identical.** Red for "problem" and green for "fine" would nudge.
- **Components are shown unstyled**, because Jev only reads text and structure.
- **The 28 calibration cases have neutral names** ("Case 07"). The story name is part of
  the state Jev reads, and a name like "VagueError" would hand it the answer.

Then `scripts/import-labels.mjs` joins the saved answers to the hidden predictions and
writes `calibration-set.jsonl`. "Not sure" answers are dropped.

Per-question calibration needs ~30 labels per question, and questions that apply only
sometimes (error messages, empty states) rarely get that many. So `calibrate` also fits
one **pooled** correction across all questions, and `tier.js` uses it for any question
without a model of its own.

### Calibration results

One person labeled 101 findings blind on the Hallway Bench (5 skipped as unsure),
compared against Jev (`jev-1.13.0`). Two measures matter, and they answer different
questions:

- **Discrimination (AUC)**: does Jev rank problem components above fine ones? 0.5 is
  a coin flip, 1.0 is perfect. Calibration cannot improve this.
- **Calibration (ECE)**: when Jev says 80%, is it right 80% of the time? This is what
  the isotonic correction fixes, and only if there is a signal to rescale.

| Question | n | AUC | Verdict |
| :--- | --: | --: | :--- |
| `error_message_actionable` | 11 | **0.94** | Excellent. Trust it. |
| `purpose_clear_from_text` | 28 | 0.78 | Ranks well, but too lenient (said yes 1×, human 7×). More labels will fix the bias. |
| `primary_action_obvious` | 28 | 0.61 | Near chance, and never once said yes (human: 10×). **Retired.** |
| `button_label_quality` | 20 | 0.61 | Near chance. Jev calls "Submit" and "Yes/No" generic at 0.98+; the human judged them fine. **Retired.** |
| `empty_state_actionable` | 4 | — | Too few to judge. |
| `destructive_action_guarded` | 5 | — | Too few to judge. |

Pooled across all six questions, calibration error fell from 0.238 to 0.093 on 5-fold
held-out data. **That figure was mostly the correction absorbing the two broken
questions' bias**, and they have since been retired. Refitted on the four questions
still in use (48 labels), the pooled correction moves held-out error only from 0.189
to 0.171. That is the honest current state, and it is what `calibration.json` holds
until the second round of labels arrives. Per-question
fits were attempted wherever there were 20+ labels; the held-out guard kept the one for
`button_label_quality` and refused the other two, because fitting them made held-out
error *worse*. That guard is doing its job: with 28 points clustered at low
probability, isotonic regression memorises noise.

### Replacing the two weak questions

Both were replaced rather than calibrated, because calibration rescales a signal and
these had almost none. Their reasoning is kept in `questions.json` under `retired`.

- **`primary_action_obvious` → `competing_actions`.** Which action is *visually* primary
  is something the pipeline cannot see: Jev gets text and structure, never layout. The
  part of the idea that text can answer is whether actions overlap with nothing in their
  wording to separate them. Gated on a deterministic `has_multiple_actions` signal. Live,
  it scores the one case built to fail it ("Save / Save and close / Apply") at 0.87 and
  every other case at 0.33 or below.
- **`button_label_quality` → `button_labels_predictable`.** The old question judged
  labels against a fixed list; the labeler judged them in context, and was right to.
  The new question asks what the labeler was actually judging: could you predict what
  each button does, given the rest of the component? Live, it puts exactly the four
  designed-confusing cases on top, but compresses every score into 0.17–0.46, so
  nothing would be reported without calibration. A good ranking on a timid scale is
  the case calibration exists for.

Neither has fresh human labels yet. Against the first round's button-label answers,
which were given to a differently worded question, the rewrite scores AUC 0.65 against
the old 0.61. With only 5 positive labels, a single case moves that by 0.05, so it
proves nothing either way. `import-labels` now leaves out labels for retired
questions, and `build-label-set --only=` publishes a follow-up round for just the
changed questions while keeping earlier predictions joinable.

### Round two, and who gets to block

The second round labeled the two replacement questions (34 items). With the retired
questions set aside, 82 labels cover the six questions in use:

| Question | n | AUC | May block? |
| :--- | --: | --: | :--- |
| `error_message_actionable` | 11 | **0.94** | yes |
| `purpose_clear_from_text` | 28 | **0.78** | yes |
| `competing_actions` | 9 | 0.72 | no, too few labels |
| `button_labels_predictable` | 25 | 0.65 | no |
| `empty_state_actionable` | 4 | 0.75 | no, too few labels |
| `destructive_action_guarded` | 5 | 0.50 | no |

Two things changed the approach.

**The labeler agreed with themselves only 75% of the time on button labels.** The
round-one and round-two button questions are near neighbours, and 5 of 20 answers
flipped between them. Two unexplained "Remove" buttons read as generic when you ask
about generic labels, and as predictable when you ask whether you can tell what they do,
since each sits beside the file it removes. Both answers are defensible. When the human
reference is that uncertain, no model can agree with it much better, and rewording the
question again would be chasing noise.

**No probability correction survived held-out testing.** With the weak questions
retired, every per-question and pooled fit made held-out error worse, so none is
applied, and the stale `calibration.json` from the previous round was removed rather
than left contradicting the data.

So the lever moved from *rescaling* scores to *deciding which questions may fail a
build*. `calibrate` now writes a `_trust` table: a question may block only with at
least 10 labels and AUC ≥ 0.75. Every other question's findings still appear, collapsed
under "Worth a look", marked advisory with the measured reason, and can never fail the
check. The bar is a policy choice in `scripts/calibrate.mjs`; the verdicts come from the
labels. On the example app this leaves exactly one blocking finding, the non-actionable
error message, on the question the labeler agreed with at 0.94.

### Round three: empty states, destructive and competing actions

28 more cases (29–56) targeted the three questions with too few labels. 112 labels now
cover the six questions in use:

| Question | n | AUC | May block? |
| :--- | --: | --: | :--- |
| `error_message_actionable` | 11 | **0.94** | yes |
| `empty_state_actionable` | 17 | **0.86** | yes, newly promoted |
| `purpose_clear_from_text` | 28 | **0.78** | yes |
| `competing_actions` | 15 | 0.66 | no |
| `button_labels_predictable` | 25 | 0.65 | no |
| `destructive_action_guarded` | 16 | 0.51 | no |

**Empty states** earned blocking: Jev separates dead ends ("No data.", "No members.")
from helpful empty states ("Clear filters", "Create API key") well.

**Destructive actions ranked no better than chance, and the disagreement has a clear
shape.** Jev was told a destructive action is guarded only if it is *confirmed first*,
so it flagged every warned-but-unconfirmed action at 0.89 or above. The labeler judged
warned, undoable or recoverable actions (a stated consequence, a 30-day trash, a
cancellation window) as fine without confirmation. Separately, the two most thoroughly
guarded cases — a typed-email confirmation and a "Reset all settings?" dialog — were
labeled as problems, which fits neither definition. The likely cause is the label
prompt, *"Is there a destructive action that isn't clearly warned about AND confirmed
first?"*, whose negation and conjunction are easy to answer backwards. That is a flaw
in the question, not the labeler.

**Competing actions produced no false alarms, only misses.** Every miss is a primary
action paired with a way out ("Pay / Back to cart", "Sign in / Forgot your password?"),
which Jev's instructions say do not compete and the labeler judged as competing. With
styling stripped for labeling, those buttons look identical, which is the same artefact
that sank the retired main-action question.

**No probability correction has survived held-out testing in any round.** Across three
rounds, every weak question failed for the same reason: the definition Jev was given
differed from the standard the human applies. Calibration cannot fix that, because it
is not a scale problem. The binding constraint on this kind of reviewer is whose
definition of good UI it enforces — which is a decision for the team using it, and the
next thing to settle for the two questions that remain advisory.

### Settling the two definitions

Round three showed the two remaining weak questions failing on definitions rather than
scale, so the team (here, the labeler) chose the definitions:

- **Destructive actions are safe if they are protected, not only if they are confirmed.**
  A clear warning, an undo, or recoverability (a trash kept for a time, a cancellation
  window) each count. `destructive_action_guarded` is retired in favour of
  `destructive_action_protected`, whose label prompt drops the double negative: *"Could
  you destroy something here by accident, without being warned first or able to undo
  it?"* Live, it now flags only the bare actions ("Revoke" 0.94, "Wipe device" 0.93,
  "Clear history" 0.79) and scores every warned, undoable or recoverable one at 0.34 or
  below. Against the round-three answers it scores AUC 0.69, up from 0.51 — provisional,
  since those answers were given to the old wording.
- **A main action with a way out does not compete.** The question stays; the labeling
  view was the problem. The specimen now fills in the main action, as a real app would,
  and the extractor passes the same fact to Jev as a `[primary]` marker, read from
  `data-variant="primary"` or a `primary`/`cta` class. Live, only the three cases built
  with no clear main action score high (0.90, 0.83, 0.58).

Labels given under the flawed conditions are **superseded, not mixed**: round four tags
its items `case::question@r4`, and `src/labels.js` keeps only the latest round per item.

### Round four: the two definitions, re-measured

31 items, relabeled under the new definitions; the round-four labels supersede the 15
earlier competing-action labels given under the misleading view.

| Question | n | AUC | Before | May block? |
| :--- | --: | --: | --: | :--- |
| `destructive_action_protected` | 16 | **0.80** | 0.51 | yes |
| `competing_actions` | 15 | **0.89** | 0.66 | yes |

Neither produced a single false alarm. Destructive actions missed one case, a 10-second
undo that Jev counts as protection and the labeler did not. Competing actions missed
two: "Continue / Cancel" and two unexplained "Remove" buttons.

Round four also confirmed the double-negative explanation. The two most thoroughly
guarded destructive cases, labeled as problems under the old prompt, were labeled fine
under the plain one.

The overall pattern across four rounds: no probability correction ever survived
held-out testing, and none was needed. Every question that reached blocking did so by
fixing **what was asked or what was shown**, never by rescaling scores:

| Question | Fix | AUC |
| :--- | :--- | --: |
| `error_message_actionable` | none needed | 0.94 |
| `competing_actions` | show the labeler the primary action; tell Jev too | 0.66 → 0.89 |
| `empty_state_actionable` | more labels | 0.86 |
| `destructive_action_protected` | adopt the team's definition; plain-language prompt | 0.51 → 0.80 |
| `purpose_clear_from_text` | none needed | 0.78 |
| `button_labels_predictable` | rewritten once; limited by labeler self-agreement | 0.61 → 0.65 |

Two lessons came out of the labeling that no amount of unit testing would have found:

- **Asking about button labels on a component with no buttons.** Jev answered
  "ambiguous or unlabeled" at 0.97 for components with no controls at all, and the human
  said, correctly, that there was no problem. Whether a component has controls is
  something the extractor knows for certain, so `button_label_quality` is now gated on
  a deterministic `has_controls` signal rather than asked of everything.
- **The main-action question may be unanswerable from this setup.** The labeler sees
  unstyled components in which every button looks identical, so "which action is the
  main one?" is often genuinely unclear to a human in a way it would not be in the real,
  styled app. Jev, reading only the wording, doesn't share that problem. The
  disagreement is partly an artefact of showing styling-free specimens, which is worth
  fixing before relabeling.

### Stability

If a finding flips on and off across pushes of identical code, developers stop trusting
the bot within a week.

```bash
JEV_API_KEY=sk-... npm run stability -- 10
```

Measured against `jev-1.13.0`, ten runs on the same unchanged component:

```
  question                        mean     sd      min     max   margin  verdict
  shows_empty_state              0.946  0.007  0.930  0.950   0.096   stable
  shows_error_message            0.887  0.005  0.880  0.890   0.037   stable
  offers_destructive_action      0.876  0.008  0.860  0.890   0.026   stable
  primary_action_obvious         0.422  0.028  0.370  0.460   0.128   stable
  error_message_actionable       0.958  0.004  0.950  0.960   0.108   stable
  empty_state_actionable         0.875  0.022  0.840  0.900   0.025   FLIPPED (1.2σ)
  button_label_quality           0.923  0.016  0.900  0.950   0.073   stable
  purpose_clear_from_text        0.381  0.018  0.350  0.410   0.169   stable
  destructive_action_guarded     0.970  0.000  0.970  0.970   0.120   stable
```

The model is steady — standard deviations run 0.000 to 0.028. But raw variance is the
wrong thing to look at on its own. `empty_state_actionable` has a perfectly ordinary sd
of 0.022 and still flips, because its mean sits 0.025 from the blocking threshold: a
1.2σ margin. So the report measures **distance to the nearest tier boundary in standard
deviations** and flags anything inside 2σ, whether or not it happened to flip in this
particular sample. An earlier ten-run sample of the same question did not flip; the
margin was the signal, the flip was luck.

Hysteresis is what saves it. Replaying those ten observed values through `src/tier.js`:

```
raw p      : 0.86 0.84 0.90 0.88 0.85 0.84 0.89 0.87 0.90 0.86
no hysteresis :  b    l    b    b    b    l    b    b    b    b   -> 4 visible changes
with hysteresis: b    b    b    b    b    b    b    b    b    b   -> 0 visible changes
```

A reported finding takes an extra 0.05 of movement to stop being reported and steps
down one tier at a time, which absorbs this entirely. That sequence is a regression
test in `test/tier.test.mjs`.

One caveat the report prints for itself: a component with obvious problems produces
confident answers far from any threshold, so low variance here says little about
borderline components. That is what calibration is for.

## What this cannot see

The state sent to Jev is the accessibility tree plus visible copy. **There is no
geometry in it** — no position, size, contrast, overlap or z-order. A button that is
white-on-white, pushed off-screen or covered by a modal looks perfect to this pipeline.

That is a deliberate MVP scope choice: it keeps the per-PR cost bounded and it means no
screenshots leave CI. But it means this reviews *structure and language*, not visual
design, and it should not be described as doing more.

## Configuration

Questions live in `questions.json` so they can be edited without touching code. Each
entry declares its type (`noul` / `choice` / `score`) and what counts as failure.

Some questions only make sense sometimes — there is no point asking whether an empty
state is a dead end if there is no empty state. Those declare an `applies_when`
precondition pointing at a **gate question**: a cheap yes/no question, marked
`"gate": true`, that Jev answers in the same call and that never produces a finding of
its own. Gates cost no extra latency, since every question for a component goes in one
request.

Action inputs: `mode`, `storybook-dir`, `questions`, `calibration`, `max-stories`,
`blocking-at`, `look-at`, `base-ref`, `set-check`, `jev-api-key`, `github-token`.

Cost control is explicit: `max-stories` caps reviewed stories per run, and when the cap
truncates a run the PR comment says so rather than silently reviewing less.

## What is not done yet

- **`button_labels_predictable` is advisory only** (AUC 0.65). The labeler agreed with
  themselves only 75% of the time on near-identical button questions, so this may be
  as good as it gets without a second labeler to settle what the team means.
- **One labeler.** Every number here is one person's judgment. A second labeler would
  show whether the definitions hold across people, which is the weakest point left.
- **One labeler, 96 labels.** The numbers below are indicative, not definitive, and
  the 28 cases were written by the same project that tests them.
- **Stability is unmeasured.** The answers look decisive, but nobody has yet run the
  same component ten times to see whether they hold still.
- **One live sample proves nothing about the distribution.** The example app has two
  components chosen to be obviously good and obviously bad. Real components live in
  the middle, which is exactly where calibration matters.
- Story rendering waits on `networkidle`, which is not the same as "the component has
  finished its own async work". Components that fetch on mount may be captured mid-load.
- The example app is three components on one Storybook version. Nothing has been tried
  against Vue, Svelte, Storybook 7/8, or a repo with hundreds of stories.
- No published Marketplace release. That waits until it has run green on a repo that
  isn't this one.

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
fixtures/               a deliberately bad component, its fixed version, a scoping case
example/                a real React + Storybook app used as an integration check
```
