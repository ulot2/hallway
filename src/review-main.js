#!/usr/bin/env node
// Phase 2, runs on `workflow_run` WITH secrets, and never executes PR code.
//
// It only reads the JSON artifact produced by phase 1, calls Jev, and posts.

import fs from 'node:fs';
import path from 'node:path';
import { evaluate } from './jev.js';
import { assess } from './tier.js';
import { renderReport, decodeState, checkConclusion, MARKER } from './report.js';

const env = (k, d) => process.env[k] ?? d;

export async function review({ state, questionSet, calibration, thresholds, apiKey, previous = {} }) {
  const components = [];
  for (const c of state.components) {
    const specs = questionSet.questions;
    const answers = await evaluate({ state: c.description, specs, apiKey });
    const findings = assess({
      answers,
      specs,
      signals: c.signals,
      calibration,
      thresholds,
      previous: previous[c.name] ?? {},
    });
    components.push({ ...c, findings });
  }
  return components;
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const outDir = env('JEV_OUT', '.jev-review');
  const state = readJson(path.join(outDir, 'state.json'));
  if (!state) throw new Error(`No ${outDir}/state.json — did phase 1 upload its artifact?`);

  const questionSet = readJson(env('JEV_QUESTIONS', 'questions.json'));
  const calibration = readJson(env('JEV_CALIBRATION', 'calibration.json'), {});
  const thresholds = {
    blockingAt: Number(env('JEV_BLOCKING_AT', '0.85')),
    lookAt: Number(env('JEV_LOOK_AT', '0.55')),
  };

  const token = process.env.GITHUB_TOKEN;
  const prNumber = Number(env('JEV_PR_NUMBER', '0')) || state.meta?.prNumber || 0;
  let previous = {};
  let octokit = null;
  let repo = null;

  if (token && prNumber) {
    const { getOctokit, context } = await import('@actions/github');
    octokit = getOctokit(token);
    repo = context.repo;
    const { data: comments } = await octokit.rest.issues.listComments({
      ...repo, issue_number: prNumber, per_page: 100,
    });
    const existing = comments.find((c) => c.body?.includes(MARKER));
    previous = decodeState(existing?.body);
    var existingId = existing?.id;
  }

  const components = await review({
    state, questionSet, calibration, thresholds,
    apiKey: process.env.JEV_API_KEY, previous,
  });

  const body = renderReport(components, {
    questionSetVersion: questionSet.version,
    thresholds,
    skipped: state.skipped,
    stateArtifact: env('JEV_STATE_ARTIFACT', 'jev-ui-review-state'),
  });

  fs.writeFileSync(path.join(outDir, 'report.md'), body);
  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(components, null, 2));

  if (!octokit) {
    console.log(body);
    return;
  }

  // One sticky comment, updated in place.
  if (existingId) {
    await octokit.rest.issues.updateComment({ ...repo, comment_id: existingId, body });
  } else {
    await octokit.rest.issues.createComment({ ...repo, issue_number: prNumber, body });
  }

  const sha = env('JEV_HEAD_SHA') || state.meta?.headSha;
  if (sha && env('JEV_SET_CHECK', 'false') === 'true') {
    await octokit.rest.checks.create({
      ...repo,
      name: 'UI review',
      head_sha: sha,
      status: 'completed',
      conclusion: checkConclusion(components),
      output: { title: 'Jev UI review', summary: body.slice(0, 65_000) },
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
