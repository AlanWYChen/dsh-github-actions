/**
 * Unit contract for src/runs.js — REQUIREMENTS.md §4 Run interface and §9.3.
 *
 * Table-driven, pure: no network, no process, no filesystem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mapWorkflowRun, isActiveStatus, activeRuns } from '../src/runs.js';

function rawRun(overrides = {}) {
  return {
    id: 101,
    name: 'Build and test',
    workflow_name: 'CI',
    status: 'in_progress',
    conclusion: null,
    event: 'push',
    head_branch: 'main',
    actor: { login: 'octocat' },
    run_number: 7,
    created_at: '2026-01-02T03:00:00Z',
    run_started_at: '2026-01-02T03:00:10Z',
    html_url: 'https://github.com/octo/hello/actions/runs/101',
    workflow_id: 55,
    path: '.github/workflows/ci.yml',
    ...overrides,
  };
}

function mappedRun(overrides = {}) {
  return {
    id: 101,
    name: 'Build and test',
    workflowName: 'CI',
    status: 'in_progress',
    conclusion: null,
    event: 'push',
    branch: 'main',
    actor: 'octocat',
    number: 7,
    createdAt: '2026-01-02T03:00:00Z',
    startedAt: '2026-01-02T03:00:10Z',
    completedAt: null,
    htmlUrl: 'https://github.com/octo/hello/actions/runs/101',
    // The workflow file page for the branch the run was started from.
    workflowUrl: 'https://github.com/octo/hello/blob/main/.github/workflows/ci.yml',
    ...overrides,
  };
}

test('isActiveStatus covers exactly the five active statuses', () => {
  for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) {
    assert.equal(isActiveStatus(status), true, status);
  }

  for (const status of ['completed', 'success', 'failure', 'cancelled', 'skipped', 'mystery', '', null, undefined]) {
    assert.equal(isActiveStatus(status), false, String(status));
  }
});

test('mapWorkflowRun maps every Run field from the GitHub REST shape', () => {
  assert.deepEqual(mapWorkflowRun(rawRun(), 'github.com'), mappedRun());
});

test('mapWorkflowRun keeps conclusion null for every active run', () => {
  for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) {
    // Hostile input: an active run that nevertheless carries a conclusion.
    const mapped = mapWorkflowRun(rawRun({ status, conclusion: 'failure' }), 'github.com');

    assert.equal(mapped.conclusion, null, status);
    assert.equal(mapped.status, status);
  }
});

test('mapWorkflowRun tolerates missing optional fields', () => {
  const mapped = mapWorkflowRun(
    rawRun({
      actor: undefined,
      run_number: undefined,
      run_started_at: undefined,
      head_branch: undefined,
      path: undefined,
    }),
    'github.com',
  );

  assert.deepEqual(mapped, {
    ...mappedRun({
      branch: null,
      actor: null,
      number: null,
      startedAt: null,
      workflowUrl: null,
    }),
  });
});

test('mapWorkflowRun falls back to the run name for the workflow name', () => {
  const mapped = mapWorkflowRun(rawRun({ workflow_name: undefined, name: 'Only a name' }), 'github.com');

  assert.equal(mapped.name, 'Only a name');
  assert.equal(mapped.workflowName, 'Only a name');
});

test('activeRuns keeps only active statuses, sorts newest createdAt first, and caps at 20', () => {
  const minutes = (index) =>
    new Date(Date.UTC(2026, 0, 2, 3, index, 0)).toISOString();

  const active = Array.from({ length: 25 }, (_, index) =>
    rawRun({
      id: index + 1,
      name: `Run ${index + 1}`,
      status: index % 2 === 0 ? 'in_progress' : 'queued',
      conclusion: null,
      created_at: minutes(index),
      html_url: `https://github.com/octo/hello/actions/runs/${index + 1}`,
    }),
  );

  const completed = rawRun({
    id: 900,
    name: 'Finished',
    status: 'completed',
    conclusion: 'success',
    created_at: minutes(59),
    html_url: 'https://github.com/octo/hello/actions/runs/900',
  });

  const unknownStatus = rawRun({
    id: 901,
    name: 'Unknown',
    status: 'mystery',
    conclusion: null,
    created_at: minutes(58),
    html_url: 'https://github.com/octo/hello/actions/runs/901',
  });

  const mixed = [completed, ...active.slice(0, 12), unknownStatus, ...active.slice(12)];

  const result = activeRuns(mixed, 'github.com');

  assert.equal(result.length, 20);
  assert.equal(result[0].id, 25, 'newest active run first');
  assert.equal(
    result.some((run) => run.id === 900),
    false,
    'completed runs never appear',
  );
  assert.equal(
    result.some((run) => run.id === 901),
    false,
    'unknown statuses are dropped',
  );
  assert.ok(result.every((run) => isActiveStatus(run.status)));
  assert.ok(result.every((run) => run.conclusion === null));

  for (let index = 1; index < result.length; index += 1) {
    assert.ok(
      Date.parse(result[index - 1].createdAt) >= Date.parse(result[index].createdAt),
      'runs are newest-first',
    );
  }

  const limited = activeRuns(mixed, 'github.com', 5);

  assert.equal(limited.length, 5);
  assert.equal(limited[0].id, 25);

  assert.deepEqual(activeRuns([], 'github.com'), []);
  assert.deepEqual(activeRuns([completed], 'github.com'), []);
});
