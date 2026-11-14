/**
 * v1.1 acceptance tests — historical runs.
 *
 * Contract: REQUIREMENTS.md "v1.1 increment — historical runs" (§11 Host history
 * read, §12 Client Recent section, §13 acceptance criteria). This is a NEW suite;
 * the frozen v1 test files stay byte-identical except the one user-approved
 * Config default assertion in test/host.test.js (historyLimit/historyRefreshMs).
 *
 * Harness code is copied into test/fixtures/ from the frozen v1 suites (see
 * docs/TEST-HANDOFF-V1.1.md); nothing here reaches the network or spawns a
 * process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as runsModule from '../src/runs.js';
import { createHandlers } from '../src/index.js';

import {
  NOW,
  SECRET,
  baseConfig,
  credentialFixture,
  grantRecord,
  workspaceEntity,
  workspaceRegistry,
  checkoutFixture,
  githubResponse,
  githubFixture,
  requestHeaders,
  requestMethod,
  invoke,
  expectError,
  handlerDeps,
  runsPayload,
  rawRun,
  mappedRun,
} from './fixtures/host-harness.mjs';

import {
  createHarness,
  text,
  eventStub,
  findRow,
  clickableIn,
  keyboardIn,
  anchorIn,
  run as v1Run,
  snapshot as v1Snapshot,
} from './fixtures/client-harness.mjs';

/* ------------------------------------------------------------------ */
/* v1.1 fixtures                                                       */
/* ------------------------------------------------------------------ */

const CONCLUSION_LABELS = new Map([
  ['success', 'Success'],
  ['failure', 'Failed'],
  ['cancelled', 'Cancelled'],
  ['skipped', 'Skipped'],
  ['neutral', 'Neutral'],
  ['timed_out', 'Timed out'],
  ['action_required', 'Action required'],
]);

const UNKNOWN_LABEL = 'Unknown';

function historyConfig(overrides = {}) {
  return {
    ...baseConfig(),
    historyLimit: 20,
    historyRefreshMs: 15000,
    ...overrides,
  };
}

function completedRaw(overrides = {}) {
  return rawRun({
    id: 2001,
    name: 'Deploy release',
    workflow_name: 'Deploy',
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    head_branch: 'release',
    actor: { login: 'octocat' },
    run_number: 12,
    created_at: '2026-01-02T03:50:00Z',
    run_started_at: '2026-01-02T03:50:10Z',
    updated_at: '2026-01-02T04:00:00Z',
    html_url: 'https://github.com/octo/hello/actions/runs/2001',
    workflow_id: 77,
    path: '.github/workflows/deploy.yml',
    ...overrides,
  });
}

function expectedCompleted(overrides = {}) {
  return {
    id: 2001,
    name: 'Deploy release',
    workflowName: 'Deploy',
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    branch: 'release',
    actor: 'octocat',
    number: 12,
    createdAt: '2026-01-02T03:50:00Z',
    startedAt: '2026-01-02T03:50:10Z',
    completedAt: '2026-01-02T04:00:00Z',
    htmlUrl: 'https://github.com/octo/hello/actions/runs/2001',
    workflowUrl: 'https://github.com/octo/hello/blob/release/.github/workflows/deploy.yml',
    ...overrides,
  };
}

function expectedActive(overrides = {}) {
  return { ...mappedRun(overrides), conclusion: null, completedAt: null };
}

const ACTIVE_URL = 'https://api.github.com/repos/octo/hello/actions/runs?per_page=50';
const HISTORY_URL =
  'https://api.github.com/repos/octo/hello/actions/runs?status=completed&per_page=20';

function isHistoryUrl(url) {
  return url.includes('status=completed');
}

function twoReadGithub({ active, history } = {}) {
  return githubFixture((url) => {
    if (isHistoryUrl(url)) {
      return typeof history === 'function' ? history(url) : githubResponse({ body: runsPayload([]) });
    }

    return typeof active === 'function' ? active(url) : githubResponse({ body: runsPayload([]) });
  });
}

function assertSameHeaders(init, label) {
  const headers = requestHeaders(init);

  assert.equal(requestMethod(init), 'GET', label);
  assert.equal(headers.authorization, `Bearer ${SECRET}`, label);
  assert.equal(headers.accept, 'application/vnd.github+json', label);
  assert.equal(headers['x-github-api-version'], '2022-11-28', label);
}

/* ------------------------------------------------------------------ */
/* §13.1–13.2 — pure mapping and history selection                     */
/* ------------------------------------------------------------------ */

test('mapWorkflowRun maps conclusion and completedAt for finished runs (§13.1)', () => {
  const mapWorkflowRun = runsModule.mapWorkflowRun;

  assert.equal(typeof mapWorkflowRun, 'function');

  const mapped = mapWorkflowRun(
    completedRaw({ conclusion: 'failure', updated_at: '2026-01-02T04:00:00Z' }),
    'github.com',
  );

  assert.deepEqual(mapped, expectedCompleted({ conclusion: 'failure' }));
});

test('mapWorkflowRun falls back to created_at and tolerates missing conclusion/dates (§13.1)', () => {
  const mapWorkflowRun = runsModule.mapWorkflowRun;

  const fallback = mapWorkflowRun(
    completedRaw({ updated_at: undefined }),
    'github.com',
  );

  assert.equal(fallback.completedAt, '2026-01-02T03:50:00Z', 'completedAt falls back to created_at');

  const undated = mapWorkflowRun(
    completedRaw({ updated_at: undefined, created_at: undefined, conclusion: undefined }),
    'github.com',
  );

  assert.equal(undated.completedAt, null);
  assert.equal(undated.conclusion, null);
  assert.equal(undated.status, 'completed');
});

test('active mapping keeps conclusion and completedAt null (§13.1)', () => {
  const mapWorkflowRun = runsModule.mapWorkflowRun;

  for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) {
    const mapped = mapWorkflowRun(
      rawRun({
        status,
        conclusion: 'failure',
        updated_at: '2026-01-02T04:00:00Z',
      }),
      'github.com',
    );

    assert.equal(mapped.conclusion, null, status);
    assert.equal(mapped.completedAt, null, status);
    assert.equal(mapped.status, status);
  }
});

test('historyRuns keeps completed runs, sorts by completedAt desc, and caps the limit (§13.2)', () => {
  const historyRuns = runsModule.historyRuns;

  assert.equal(
    typeof historyRuns,
    'function',
    'src/runs.js must export historyRuns(rawRuns, host, limit) — REQUIREMENTS §13.2',
  );

  const raw = [
    completedRaw({ id: 2001, name: 'older', updated_at: '2026-01-02T03:00:00Z' }),
    completedRaw({ id: 2002, name: 'newer', updated_at: '2026-01-02T05:00:00Z' }),
    completedRaw({ id: 2003, name: 'middle', updated_at: '2026-01-02T04:00:00Z' }),
    rawRun({ id: 2010, name: 'active', status: 'in_progress', updated_at: '2026-01-02T06:00:00Z' }),
    rawRun({ id: 2011, name: 'unknown', status: 'mystery', updated_at: '2026-01-02T07:00:00Z' }),
    completedRaw({
      id: 2004,
      name: 'created-fallback',
      updated_at: undefined,
      created_at: '2026-01-02T02:00:00Z',
    }),
    completedRaw({
      id: 2005,
      name: 'undated',
      updated_at: undefined,
      created_at: undefined,
      conclusion: undefined,
    }),
  ];

  const history = historyRuns(raw, 'github.com', 20);

  assert.deepEqual(
    history.map((entry) => entry.id),
    [2002, 2003, 2001, 2004, 2005],
    'completed runs only, newest completedAt first, missing dates last',
  );
  assert.ok(history.every((entry) => entry.status === 'completed'));
  assert.equal(history[0].completedAt, '2026-01-02T05:00:00Z');
  assert.equal(history[3].completedAt, '2026-01-02T02:00:00Z', 'created_at fallback');
  assert.equal(history[4].completedAt, null, 'missing dates tolerated');
  assert.equal(history[4].conclusion, null, 'missing conclusion tolerated');
  assert.equal(
    history.some((entry) => entry.id === 2010 || entry.id === 2011),
    false,
    'active/unknown statuses are not history',
  );

  const capped = historyRuns(raw, 'github.com', 2);

  assert.deepEqual(capped.map((entry) => entry.id), [2002, 2003]);
  assert.deepEqual(historyRuns([], 'github.com', 20), []);
});

/* ------------------------------------------------------------------ */
/* §13.3 — snapshot: history value, two requests, caches, bypass       */
/* ------------------------------------------------------------------ */

test('snapshot returns active runs plus newest-first history from exactly two documented requests (§13.3)', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const github = twoReadGithub({
    active: () => githubResponse({ body: runsPayload([rawRun({ id: 101 })]) }),
    history: () =>
      githubResponse({
        body: runsPayload([
          completedRaw({ id: 2002, updated_at: '2026-01-02T05:00:00Z' }),
          completedRaw({ id: 2001, updated_at: '2026-01-02T04:00:00Z' }),
          // GitHub may return an entry that is no longer completed; history
          // only keeps status === 'completed'.
          rawRun({ id: 2003, status: 'in_progress', updated_at: '2026-01-02T06:00:00Z' }),
        ]),
      }),
  });
  const handlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github,
      now: () => NOW,
    }),
  );

  const snapshot = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(github.calls.length, 2, 'exactly the active read and the history read');

  const urls = github.calls.map((call) => call.url).sort();

  assert.deepEqual(urls, [ACTIVE_URL, HISTORY_URL].sort());
  assertSameHeaders(github.calls.find((call) => call.url === ACTIVE_URL).init, 'active read');
  assertSameHeaders(github.calls.find((call) => call.url === HISTORY_URL).init, 'history read');

  assert.deepEqual(snapshot.runs, [expectedActive()]);
  assert.deepEqual(snapshot.history, [
    expectedCompleted({ id: 2002, completedAt: '2026-01-02T05:00:00Z' }),
    expectedCompleted({ id: 2001 }),
  ]);
  assert.equal(snapshot.historyWarning, undefined);
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);
});

test('history is cached for historyRefreshMs independently of the active refreshMs (§13.3)', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  let clock = NOW;
  let activeReads = 0;
  let historyReads = 0;
  let activePayload = runsPayload([rawRun({ id: 101 })]);
  let historyPayload = runsPayload([completedRaw({ id: 2001 })]);

  const github = twoReadGithub({
    active: () => {
      activeReads += 1;

      return githubResponse({ body: activePayload });
    },
    history: () => {
      historyReads += 1;

      return githubResponse({ body: historyPayload });
    },
  });
  const handlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github,
      now: () => clock,
    }),
  );

  const first = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(activeReads, 1);
  assert.equal(historyReads, 1);
  assert.deepEqual(first.history, [expectedCompleted({ id: 2001 })]);

  // Both caches warm: no new reads.
  const warm = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(activeReads, 1);
  assert.equal(historyReads, 1);
  assert.deepEqual(warm.history, first.history);

  // Past refreshMs but inside historyRefreshMs: only the active list is read.
  clock += 3001;
  activePayload = runsPayload([rawRun({ id: 102, html_url: 'https://github.com/octo/hello/actions/runs/102' })]);

  const activeOnly = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(activeReads, 2, 'active cache expired');
  assert.equal(historyReads, 1, 'history cache still warm');
  assert.equal(activeOnly.runs[0].id, 102);
  assert.deepEqual(activeOnly.history, first.history);

  // Past historyRefreshMs too: both reads happen again.
  clock = NOW + 15001;
  historyPayload = runsPayload([
    completedRaw({ id: 2002, updated_at: '2026-01-02T05:00:00Z' }),
  ]);

  const both = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(activeReads, 3);
  assert.equal(historyReads, 2, 'history cache expired');
  assert.equal(both.runs[0].id, 102);
  assert.deepEqual(both.history, [
    expectedCompleted({ id: 2002, completedAt: '2026-01-02T05:00:00Z' }),
  ]);
});

test('refresh: true bypasses the active and history caches (§13.3)', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  let activeReads = 0;
  let historyReads = 0;
  let activePayload = runsPayload([rawRun({ id: 101 })]);
  let historyPayload = runsPayload([completedRaw({ id: 2001 })]);
  const github = twoReadGithub({
    active: () => {
      activeReads += 1;

      return githubResponse({ body: activePayload });
    },
    history: () => {
      historyReads += 1;

      return githubResponse({ body: historyPayload });
    },
  });
  const handlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github,
      now: () => NOW,
    }),
  );

  await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });
  assert.equal(activeReads, 1);
  assert.equal(historyReads, 1);

  activePayload = runsPayload([rawRun({ id: 102, html_url: 'https://github.com/octo/hello/actions/runs/102' })]);
  historyPayload = runsPayload([
    completedRaw({ id: 2002, updated_at: '2026-01-02T05:00:00Z' }),
  ]);

  const refreshed = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1', refresh: true });

  assert.equal(activeReads, 2);
  assert.equal(historyReads, 2);
  assert.equal(refreshed.runs[0].id, 102);
  assert.deepEqual(refreshed.history, [
    expectedCompleted({ id: 2002, completedAt: '2026-01-02T05:00:00Z' }),
  ]);
});

/* ------------------------------------------------------------------ */
/* §13.4–13.5 — history failure downgrade, rate limits, 401, signed out */
/* ------------------------------------------------------------------ */

test('a failed history read keeps the previous history and adds historyWarning (§13.4)', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  let clock = NOW;
  let historyFails = false;
  let activePayload = runsPayload([rawRun({ id: 101 })]);
  const github = twoReadGithub({
    active: () => githubResponse({ body: activePayload }),
    history: () => {
      if (historyFails) throw new Error('history read failed: socket hang up');

      return githubResponse({ body: runsPayload([completedRaw({ id: 2001 })]) });
    },
  });
  const handlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github,
      now: () => clock,
    }),
  );

  const first = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.deepEqual(first.history, [expectedCompleted({ id: 2001 })]);

  // The active read succeeds; the history read fails after both caches expire.
  clock += 15001;
  historyFails = true;
  activePayload = runsPayload([rawRun({ id: 102, html_url: 'https://github.com/octo/hello/actions/runs/102' })]);

  const degraded = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(degraded.runs[0].id, 102, 'the active list still succeeds');
  assert.deepEqual(
    degraded.history,
    first.history,
    'the previous history is preserved on a history-read failure',
  );
  assert.equal(typeof degraded.historyWarning, 'string');
  assert.ok(degraded.historyWarning.length > 0);
  assert.equal(degraded.stale, false);
  assert.equal(JSON.stringify(degraded).includes(SECRET), false);

  // A first-ever history failure with no cache still succeeds with history: [].
  const coldGithub = twoReadGithub({
    active: () => githubResponse({ body: runsPayload([rawRun({ id: 101 })]) }),
    history: () => {
      throw new Error('history read failed');
    },
  });
  const coldHandlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github: coldGithub,
      now: () => NOW,
    }),
  );
  const cold = await invoke(coldHandlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.deepEqual(cold.runs, [expectedActive()]);
  assert.deepEqual(cold.history, []);
  assert.equal(typeof cold.historyWarning, 'string');
  assert.ok(cold.historyWarning.length > 0);
});

test('a rate-limited history read degrades, while a rate-limited active read still fails (§13.4)', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const rateLimited = () =>
    githubResponse({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
      body: { message: 'API rate limit exceeded' },
    });

  // History rate limit alone: downgraded to historyWarning, active list returned.
  const historyLimited = twoReadGithub({
    active: () => githubResponse({ body: runsPayload([rawRun({ id: 101 })]) }),
    history: () => rateLimited(),
  });
  const historyLimitedHandlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github: historyLimited,
      now: () => NOW,
    }),
  );
  const degraded = await invoke(historyLimitedHandlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.deepEqual(degraded.runs, [expectedActive()]);
  assert.deepEqual(degraded.history, []);
  assert.equal(typeof degraded.historyWarning, 'string');
  assert.ok(degraded.historyWarning.length > 0);

  // Active rate limit remains the v1 rate-limited error.
  const activeLimited = twoReadGithub({
    active: () => rateLimited(),
    history: () => githubResponse({ body: runsPayload([]) }),
  });
  const activeLimitedHandlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github: activeLimited,
      now: () => NOW,
    }),
  );

  await expectError(activeLimitedHandlers, 'snapshot', { workspaceId: 'ws-1' }, 'rate-limited');
});

test('a 401 on the history read deletes the credential and returns auth-required (§13.5)', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const credentials = credentialFixture(grantRecord());
  const github = twoReadGithub({
    active: () => githubResponse({ body: runsPayload([rawRun({ id: 101 })]) }),
    history: () => githubResponse({ status: 401, body: { message: 'Bad credentials' } }),
  });
  const handlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials,
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github,
      now: () => NOW,
    }),
  );

  await expectError(handlers, 'snapshot', { workspaceId: 'ws-1' }, 'auth-required');

  assert.equal(credentials.current, undefined, 'the stored credential was deleted');
  assert.equal((await invoke(handlers, 'status', {})).signedIn, false);
});

test('signed-out snapshots return empty history without a GitHub read (§13.3)', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const github = twoReadGithub();
  const handlers = createHandlers(
    handlerDeps({
      config: historyConfig(),
      credentials: credentialFixture(),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github,
      now: () => NOW,
    }),
  );
  const snapshot = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(snapshot.repoStatus, 'ok');
  assert.deepEqual(snapshot.runs, []);
  assert.deepEqual(snapshot.history, []);
  assert.equal(snapshot.fetchedAt, null);
  assert.equal(snapshot.stale, false);
  assert.equal(github.calls.length, 0);
});

test('historyLimit drives the history request size and the returned cap (§13.3)', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const github = twoReadGithub({
    active: () => githubResponse({ body: runsPayload([rawRun({ id: 101 })]) }),
    history: () =>
      githubResponse({
        body: runsPayload([
          completedRaw({ id: 2001, updated_at: '2026-01-02T03:00:00Z' }),
          completedRaw({ id: 2002, updated_at: '2026-01-02T04:00:00Z' }),
          completedRaw({ id: 2003, updated_at: '2026-01-02T05:00:00Z' }),
        ]),
      }),
  });
  const handlers = createHandlers(
    handlerDeps({
      config: historyConfig({ historyLimit: 2 }),
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      git,
      github,
      now: () => NOW,
    }),
  );

  const snapshot = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });
  const historyCall = github.calls.find((call) => isHistoryUrl(call.url));

  assert.ok(historyCall);
  assert.equal(
    historyCall.url,
    'https://api.github.com/repos/octo/hello/actions/runs?status=completed&per_page=2',
  );
  assert.deepEqual(
    snapshot.history.map((entry) => entry.id),
    [2003, 2002],
    'newest first, capped at historyLimit',
  );
});

/* ------------------------------------------------------------------ */
/* §13.6 — Client: Running + Recent sections, pills, warning, locale   */
/* ------------------------------------------------------------------ */

function historyEntry(overrides = {}) {
  return {
    ...v1Run(),
    id: 2001,
    name: 'Deploy release',
    workflowName: 'Deploy',
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    branch: 'release',
    actor: 'octocat',
    number: 12,
    createdAt: '2026-01-02T03:50:00Z',
    startedAt: '2026-01-02T03:50:10Z',
    completedAt: '2026-01-02T04:00:00Z',
    htmlUrl: 'https://github.com/octo/hello/actions/runs/2001',
    workflowUrl: 'https://github.com/octo/hello/blob/release/.github/workflows/deploy.yml',
    ...overrides,
  };
}

function historySnapshot(overrides = {}) {
  return {
    ...v1Snapshot(),
    runs: [v1Run()],
    history: [
      historyEntry(),
      historyEntry({
        id: 2002,
        name: 'Nightly build',
        workflowName: 'Nightly',
        conclusion: 'failure',
        branch: 'main',
        event: 'schedule',
        completedAt: '2026-01-02T05:00:00Z',
        htmlUrl: 'https://github.com/octo/hello/actions/runs/2002',
      }),
    ],
    ...overrides,
  };
}

function flattenNodes(node, result = []) {
  if (node === null || node === undefined) return result;
  if (Array.isArray(node)) {
    for (const child of node) flattenNodes(child, result);

    return result;
  }
  if (typeof node !== 'object') return result;

  result.push(node);
  if (node.children !== undefined) flattenNodes(node.children, result);

  return result;
}

const HEADING_TYPES = ['h2', 'h3', 'h4', 'h5'];

function headingBefore(nodes, target) {
  const index = nodes.indexOf(target);

  for (let position = index - 1; position >= 0; position -= 1) {
    if (HEADING_TYPES.includes(nodes[position].type)) return nodes[position];
  }

  return undefined;
}

function keyForValue(dictionary, value) {
  return Object.keys(dictionary).find((key) => dictionary[key] === value);
}

function timePattern(dictionary) {
  const parts = ['time.justNow', 'time.minutesAgo', 'time.hoursAgo', 'time.daysAgo']
    .map((key) => dictionary[key])
    .filter((value) => typeof value === 'string')
    .map((value) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{count\\}', '\\d+'),
    );

  return new RegExp(`(?:${parts.join('|')})`, 'i');
}

test('the panel renders a localized Running section above a localized Recent section (§12, §13.6)', async () => {
  const active = v1Run();
  const finished = historyEntry();
  const snapshot = { ...v1Snapshot(), runs: [active], history: [finished], fetchedAt: '2026-01-02T04:10:00Z' };

  const en = await createHarness({ snapshot });

  assert.equal(en.module.describeState(snapshot).kind, 'ready', 'describeState is unchanged');

  const tree = await en.mountPage();
  const nodes = flattenNodes(tree);
  const activeRow = findRow(tree, active);
  const finishedRow = findRow(tree, finished);

  assert.ok(activeRow, 'the active row is rendered');
  assert.ok(finishedRow, 'the finished row is rendered');

  const runningHeading = headingBefore(nodes, activeRow);
  const recentHeading = headingBefore(nodes, finishedRow);

  assert.ok(runningHeading, 'the Running section has a heading');
  assert.ok(recentHeading, 'the Recent section has a heading');
  assert.equal(
    runningHeading === recentHeading,
    false,
    'Running and Recent are two distinct sections',
  );
  assert.ok(
    nodes.indexOf(runningHeading) < nodes.indexOf(activeRow) &&
      nodes.indexOf(activeRow) < nodes.indexOf(recentHeading) &&
      nodes.indexOf(recentHeading) < nodes.indexOf(finishedRow),
    'Running heading, active rows, Recent heading, finished rows — in that order',
  );

  const enValues = new Set(Object.values(en.dictionaries.en));

  assert.ok(enValues.has(text(runningHeading).trim()), 'the Running heading is localized');
  assert.ok(enValues.has(text(recentHeading).trim()), 'the Recent heading is localized');

  // The same structure in zh renders headings taken from the zh dictionary.
  const zh = await createHarness({ snapshot, locale: 'zh' });
  const zhTree = await zh.mountPage();
  const zhNodes = flattenNodes(zhTree);
  const zhRunning = headingBefore(zhNodes, findRow(zhTree, active));
  const zhRecent = headingBefore(zhNodes, findRow(zhTree, finished));
  const zhValues = new Set(Object.values(zh.dictionaries.zh));

  assert.ok(zhRunning && zhRecent);
  assert.equal(zhRunning === zhRecent, false);
  assert.ok(zhValues.has(text(zhRunning).trim()), 'the zh Running heading is localized');
  assert.ok(zhValues.has(text(zhRecent).trim()), 'the zh Recent heading is localized');

  en.unmount();
  zh.unmount();
});

test('Recent rows show fields, conclusion pills, and open htmlUrl on click/Enter/Space (§12, §13.6)', async () => {
  const cases = [
    ['success', 'Success'],
    ['failure', 'Failed'],
    ['cancelled', 'Cancelled'],
    ['skipped', 'Skipped'],
    ['neutral', 'Neutral'],
    ['timed_out', 'Timed out'],
    ['action_required', 'Action required'],
    [null, 'Unknown'],
    ['stale', 'Unknown'],
  ];
  const history = cases.map(([conclusion], index) =>
    historyEntry({
      id: 2100 + index,
      name: `History ${conclusion === null ? 'missing' : conclusion}`,
      conclusion,
      completedAt: '2026-01-02T04:00:00Z',
      htmlUrl: `https://github.com/octo/hello/actions/runs/${2100 + index}`,
    }),
  );
  const harness = await createHarness({
    snapshot: { ...v1Snapshot(), runs: [], history },
  });
  const tree = await harness.mountPage();

  const labels = new Set(Object.values(harness.dictionaries.en));
  const relativeTime = timePattern(harness.dictionaries.en);

  for (const [conclusion, label] of cases) {
    const entry = history.find(
      (candidate) => candidate.name === `History ${conclusion === null ? 'missing' : conclusion}`,
    );
    const row = findRow(tree, entry);

    assert.ok(row, `a Recent row exists for ${conclusion === null ? 'null' : conclusion}`);

    const rowText = text(row);

    assert.ok(rowText.includes(entry.name));
    assert.ok(rowText.includes(entry.workflowName));
    assert.ok(rowText.includes(entry.branch));
    assert.ok(rowText.includes(entry.event));
    assert.ok(rowText.includes(label), `conclusion ${conclusion} renders the ${label} pill`);
    assert.ok(labels.has(label), `the en dictionary localizes the ${label} pill`);
    assert.match(rowText, relativeTime, 'the row shows the time since completedAt');
  }

  // Click and keyboard activation open the run page in a new tab.
  const clicked = history.find((entry) => entry.conclusion === 'success');
  const row = findRow(tree, clicked);

  harness.opens.length = 0;

  const clickable = clickableIn(row);

  if (clickable) {
    await clickable.props.onClick(eventStub());

    assert.ok(harness.opens.length >= 1);
    assert.equal(harness.opens[0][0], clicked.htmlUrl);
  } else {
    const anchor = anchorIn(row);

    assert.ok(anchor, 'the Recent row is clickable or a link');
    assert.equal(anchor.props.href, clicked.htmlUrl);
    assert.equal(anchor.props.target, '_blank');
  }

  harness.opens.length = 0;

  const keyboard = keyboardIn(row);

  if (keyboard) {
    await keyboard.props.onKeyDown(eventStub({ key: 'Enter' }));
    await keyboard.props.onKeyDown(eventStub({ key: ' ' }));

    assert.ok(harness.opens.length >= 2, 'Enter and Space activate the Recent row');
    for (const opened of harness.opens.slice(0, 2)) assert.equal(opened[0], clicked.htmlUrl);
  } else {
    const anchor = anchorIn(row);

    assert.ok(anchor, 'the Recent row is keyboard-operable');
    assert.equal(anchor.props.href, clicked.htmlUrl);
    assert.equal(anchor.props.target, '_blank');
  }

  harness.unmount();
});

test('both sections are always present with their specified empty lines (§12)', async () => {
  const harness = await createHarness({
    snapshot: { ...v1Snapshot(), runs: [], history: [], fetchedAt: null },
  });
  const tree = await harness.mountPage();
  const pageText = text(tree);
  const nodes = flattenNodes(tree);
  const runningEmpty = nodes.find(
    (node) => text(node).trim() === 'No runs are currently running.',
  );
  const recentEmpty = nodes.find((node) => text(node).trim() === 'No finished runs yet.');

  assert.ok(runningEmpty, 'the Running empty line is specified text');
  assert.ok(recentEmpty, 'the Recent empty line is specified text');

  const runningHeading = headingBefore(nodes, runningEmpty);
  const recentHeading = headingBefore(nodes, recentEmpty);

  assert.ok(runningHeading, 'the empty Running section still has a heading');
  assert.ok(recentHeading, 'the empty Recent section still has a heading');
  assert.equal(runningHeading === recentHeading, false, 'both sections stay present when empty');
  assert.ok(nodes.indexOf(runningHeading) < nodes.indexOf(recentHeading), 'Running is above Recent');

  const runningKey = keyForValue(harness.dictionaries.en, 'No runs are currently running.');
  const recentKey = keyForValue(harness.dictionaries.en, 'No finished runs yet.');

  assert.ok(runningKey, 'the Running empty line is a dictionary value');
  assert.ok(recentKey, 'the Recent empty line is a dictionary value');

  const zh = await createHarness({
    snapshot: { ...v1Snapshot(), runs: [], history: [], fetchedAt: null },
    locale: 'zh',
  });
  const zhTree = await zh.mountPage();

  assert.ok(text(zhTree).includes(zh.dictionaries.zh[runningKey]));
  assert.ok(text(zhTree).includes(zh.dictionaries.zh[recentKey]));

  harness.unmount();
  zh.unmount();
});

test('historyWarning renders above the Recent rows without hiding them (§12)', async () => {
  const warning = 'History could not be refreshed; showing the last finished runs.';
  const finished = historyEntry();
  const harness = await createHarness({
    snapshot: {
      ...v1Snapshot(),
      runs: [v1Run()],
      history: [finished],
      historyWarning: warning,
    },
  });
  const tree = await harness.mountPage();
  const nodes = flattenNodes(tree);
  const warningNode = nodes.find((node) => text(node).trim() === warning);
  const finishedRow = findRow(tree, finished);

  assert.ok(warningNode, 'the historyWarning line is rendered verbatim');
  assert.ok(finishedRow, 'the warning does not hide the Recent rows');
  assert.ok(
    nodes.indexOf(warningNode) < nodes.indexOf(finishedRow),
    'the warning is above the Recent rows',
  );

  harness.unmount();
});

test('locale dictionaries and files share identical key sets and contain the v1.1 strings (§12)', async () => {
  const harness = await createHarness();
  const flatten = (value, prefix = '') => {
    const result = {};

    for (const [key, entry] of Object.entries(value)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;

      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        Object.assign(result, flatten(entry, path));
      } else {
        result[path] = entry;
      }
    }

    return result;
  };
  const enFile = flatten(
    JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8')),
  );
  const zhFile = flatten(
    JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8')),
  );
  const runtimeEn = harness.dictionaries.en;
  const runtimeZh = harness.dictionaries.zh;

  assert.deepEqual(Object.keys(runtimeEn).sort(), Object.keys(runtimeZh).sort(), 'dictionary parity');
  assert.deepEqual(Object.keys(runtimeEn).sort(), Object.keys(enFile).sort(), 'en dictionary ↔ en.json');
  assert.deepEqual(Object.keys(runtimeZh).sort(), Object.keys(zhFile).sort(), 'zh dictionary ↔ zh.json');
  assert.deepEqual(Object.keys(enFile).sort(), Object.keys(zhFile).sort(), 'en.json ↔ zh.json');

  for (const [key, value] of Object.entries(runtimeEn)) {
    assert.equal(typeof value, 'string', `en.${key}`);
    assert.ok(value.length > 0, `en.${key} is not empty`);
  }
  for (const [key, value] of Object.entries(runtimeZh)) {
    assert.equal(typeof value, 'string', `zh.${key}`);
    assert.ok(value.length > 0, `zh.${key} is not empty`);
  }

  const enValues = new Set(Object.values(runtimeEn));
  const fileValues = new Set(Object.values(enFile));
  const expectedEnglish = [
    'No finished runs yet.',
    'No runs are currently running.',
    ...[...CONCLUSION_LABELS.values()],
    UNKNOWN_LABEL,
  ];

  for (const value of expectedEnglish) {
    assert.ok(enValues.has(value), `en dictionary contains ${JSON.stringify(value)}`);
    assert.ok(fileValues.has(value), `locale/en.json contains ${JSON.stringify(value)}`);
  }

  harness.unmount();
});
