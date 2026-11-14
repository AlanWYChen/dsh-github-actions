/**
 * v1.5 acceptance tests — cache lifetime (survives panel unmount/remount) and
 * same-workspace response ordering.
 *
 * Contract: REQUIREMENTS.md "v1.5 increment — cache lifetime and response
 * ordering" (§25 cache survives unmount/remount, §26 same-workspace ordering,
 * §27 acceptance criteria).
 *
 * NEW suite; the frozen v1.4 client harness is imported read-only and driven
 * with deferred RPC promises. A real unmount/remount discards the page
 * component's hook state while keeping the module instance; the harness keeps
 * hook slots in an instance table, so after `harness.unmount()` the test clears
 * the page instance's hook state to reproduce exactly that (the module-level
 * cache must be the only thing that survives).
 *
 * No network, no real DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHarness,
  visit,
  text,
  plain,
  run,
  snapshot,
} from './fixtures/client-harness.mjs';

/* ------------------------------------------------------------------ */
/* Fixtures and controllable RPC                                       */
/* ------------------------------------------------------------------ */

const AUTH = {
  signedIn: true,
  login: 'octocat',
  scopes: ['repo'],
  clientIdConfigured: true,
};

const REPO = {
  host: 'github.com',
  owner: 'octo',
  name: 'hello',
  slug: 'octo/hello',
  webUrl: 'https://github.com/octo/hello',
  defaultBranch: null,
  source: 'remote',
};

const LOADING_TEXT = 'Loading runs…';

function workspace(id, title) {
  return { workspaceId: id, title, path: `/${id}`, sessionIds: [] };
}

function snapshotFor(id, title, runName, overrides = {}) {
  return {
    ...snapshot(),
    workspace: { id, title, path: `/${id}` },
    repo: REPO,
    repoStatus: 'ok',
    auth: AUTH,
    runs: [run({ id: 3000 + id.length, name: runName })],
    history: [],
    fetchedAt: '2026-01-02T03:04:05.000Z',
    stale: false,
    ...overrides,
  };
}

function errorEnvelope(code = 'github-unreachable', message = 'read failed') {
  return { ok: false, error: { code, message, details: {} } };
}

function deferred() {
  const entry = { settled: false };

  entry.promise = new Promise((resolve, reject) => {
    entry.resolve = (value) => {
      if (entry.settled) return;
      entry.settled = true;
      resolve(value);
    };
    entry.reject = (error) => {
      if (entry.settled) return;
      entry.settled = true;
      reject(error);
    };
  });

  return entry;
}

/** RPC fake with a per-workspace queue of controllable snapshot promises. */
function deferredRpc() {
  const queues = new Map();
  const calls = [];

  async function rpc(channel, method, payload) {
    assert.equal(channel, '/api');
    calls.push({ method, payload: plain(payload ?? {}) });

    if (method === 'githubActions.status') return { ok: true, value: AUTH };

    if (method === 'githubActions.snapshot') {
      const id = String(payload?.workspaceId);
      const entry = deferred();
      const queue = queues.get(id) ?? [];

      queue.push(entry);
      queues.set(id, queue);

      return entry.promise;
    }

    throw new Error(`unexpected RPC method ${method}`);
  }

  function queueFor(id) {
    const queue = queues.get(String(id));

    assert.ok(queue && queue.length > 0, `no pending snapshot reads for workspace ${id}`);

    return queue;
  }

  function resolveResult(id, queueIndex, result) {
    const entry = queueFor(id)[queueIndex];

    assert.ok(entry, `no snapshot read #${queueIndex} for workspace ${id}`);
    assert.equal(entry.settled, false, `snapshot read #${queueIndex} for ${id} is already settled`);
    entry.resolve(result);
  }

  function resolve(id, value, queueIndex) {
    resolveResult(id, queueIndex ?? queueFor(id).length - 1, { ok: true, value });
  }

  function fail(id, queueIndex) {
    resolveResult(id, queueIndex ?? queueFor(id).length - 1, errorEnvelope());
  }

  return { rpc, calls, queues, queueFor, resolve, fail };
}

async function mount(options = {}) {
  const harness = await createHarness(options);
  await harness.mountPage();
  await harness.settle();

  return harness;
}

function classNames(node) {
  const value = node !== null && typeof node === 'object' ? node.props?.className : undefined;

  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

function hasClass(node, token) {
  return classNames(node).includes(token);
}

function loadingStatuses(tree) {
  return visit(
    tree,
    (node) => node.props?.role === 'status' && text(node).trim() === LOADING_TEXT,
  );
}

async function switchWorkspace(harness, workspaceId) {
  const select = visit(harness.tree(), (node) => node.type === 'select')[0];

  assert.ok(select, 'the workspace select exists');

  await select.props.onChange({
    target: { value: workspaceId },
    currentTarget: { value: workspaceId },
  });
  await harness.settle();
}

/**
 * Simulate a real React unmount/remount: the page component's hooks (state,
 * refs, memos, effects) are discarded, while the loaded client module (and any
 * module-scope cache) stays. The harness keeps hook slots in an instance table,
 * hence clearing that table entry after `unmount()`.
 */
function resetPageHookState(harness) {
  for (const key of ['page']) {
    const instance = harness.renderer.instanceFor(key);

    instance.states.length = 0;
    instance.refs.length = 0;
    instance.memos.length = 0;
    instance.reductions.length = 0;
    instance.effects = [];
    instance.pending = [];
    instance.stateIndex = 0;
    instance.refIndex = 0;
    instance.effectIndex = 0;
    instance.memoIndex = 0;
    instance.reductionIndex = 0;
  }
}

async function remount(harness) {
  harness.unmount();
  resetPageHookState(harness);
  await harness.mountPage();
  await harness.settle();

  return harness.tree();
}

function snapshotCallsFor(rpc, workspaceId) {
  return rpc.calls.filter(
    (call) =>
      call.method === 'githubActions.snapshot' && call.payload.workspaceId === workspaceId,
  );
}

/* ------------------------------------------------------------------ */
/* §25 / §27.1 — cache survives panel unmount/remount                  */
/* ------------------------------------------------------------------ */

test('the module-scope cache survives unmount/remount, stays bounded across mounts, and is dropped by a fresh module (reload) (§25)', async () => {
  const rpc = deferredRpc();
  const workspaces = [
    workspace('ws-a', 'Alpha'),
    ...Array.from({ length: 20 }, (_, index) => workspace(`ws-${index + 1}`, `Project ${index + 1}`)),
  ];
  const harness = await mount({ workspaces, rpc: rpc.rpc });

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A cached'));
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A cached'));

  // Leave the panel and come back in the same module instance: cached rows must
  // render immediately, no loading state, and a background read must still run.
  const remountedTree = await remount(harness);

  assert.ok(text(remountedTree).includes('A cached'), 'cached rows survive remount');
  assert.equal(loadingStatuses(remountedTree).length, 0, 'no loading state after remount');

  const afterRemount = snapshotCallsFor(rpc, 'ws-a');

  assert.equal(afterRemount.length, 2, 'a background snapshot read runs after remount');
  assert.equal(afterRemount[1].payload.refresh, undefined, 'the background read is not forced');

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A refreshed'));
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A refreshed'));

  // Fill the cache past its 20-entry bound while mounted; the oldest entry (A)
  // must be evicted, and that bound must still hold after another remount.
  for (let index = 1; index <= 20; index += 1) {
    const id = `ws-${index}`;

    await switchWorkspace(harness, id);
    rpc.resolve(id, snapshotFor(id, `Project ${index}`, `run ${index}`));
    await harness.settle();
  }

  const boundedTree = await remount(harness);

  assert.equal(
    loadingStatuses(boundedTree).length,
    1,
    'the oldest cache entry is still evicted after remount (bound holds across mounts)',
  );
  assert.equal(text(boundedTree).includes('A refreshed'), false);

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A after reload of the page'));
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A after reload of the page'));

  harness.unmount();

  // A fresh module instance (simulated page reload) starts with no cache.
  const freshRpc = deferredRpc();
  const fresh = await mount({
    workspaces: [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')],
    rpc: freshRpc.rpc,
  });

  assert.equal(loadingStatuses(fresh.tree()).length, 1, 'a reload drops the session cache');
  assert.equal(text(fresh.tree()).includes('A refreshed'), false);
  assert.equal(text(fresh.tree()).includes('A after reload of the page'), false);

  fresh.unmount();
});

/* ------------------------------------------------------------------ */
/* §26 / §27.2 — same-workspace response ordering                      */
/* ------------------------------------------------------------------ */

test('out-of-order same-workspace reads: the newer token wins in state and cache, and an older failure cannot banner over it (§26)', async () => {
  const rpc = deferredRpc();
  const workspaces = [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')];
  const harness = await mount({ workspaces, rpc: rpc.rpc });

  // Read 1 for A is pending (mount). Leave and return to A so a second A read
  // (read 2) is issued while read 1 is still in flight.
  await switchWorkspace(harness, 'ws-b');
  await switchWorkspace(harness, 'ws-a');

  const aQueue = rpc.queueFor('ws-a');

  assert.equal(aQueue.length, 2, 'two same-workspace reads are in flight');

  // Newer read settles first.
  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A newer'), 1);
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A newer'));

  // Older read settles afterwards and must be ignored.
  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A older'), 0);
  await harness.settle();

  const orderedTree = harness.tree();

  assert.ok(text(orderedTree).includes('A newer'), 'the newer response stays rendered');
  assert.equal(text(orderedTree).includes('A older'), false, 'the older response never wins');

  // The cache must hold the newer value: returning to A renders it immediately.
  await switchWorkspace(harness, 'ws-b');
  await switchWorkspace(harness, 'ws-a');

  assert.ok(text(harness.tree()).includes('A newer'), 'the cache holds the newer response');
  assert.equal(loadingStatuses(harness.tree()).length, 0);

  // Two more concurrent A reads; the newest succeeds, an older one fails later.
  await switchWorkspace(harness, 'ws-b');
  await switchWorkspace(harness, 'ws-a');
  await switchWorkspace(harness, 'ws-b');
  await switchWorkspace(harness, 'ws-a');

  const latestQueue = rpc.queueFor('ws-a');
  const latestIndex = latestQueue.length - 1;
  const olderIndex = latestIndex - 1;

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A newest'), latestIndex);
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A newest'));

  rpc.fail('ws-a', olderIndex);
  await harness.settle();

  const failureTree = harness.tree();

  assert.ok(text(failureTree).includes('A newest'), 'the newer success stays rendered');
  assert.equal(loadingStatuses(failureTree).length, 0);
  assert.equal(
    visit(failureTree, (node) => hasClass(node, 'gha-banner')).length,
    0,
    'an older failure must not surface the error banner over the newer success',
  );
  assert.equal(
    text(failureTree).includes(harness.dictionaries.en['error.banner']),
    false,
  );

  // Cache still holds the newest success.
  await switchWorkspace(harness, 'ws-b');
  await switchWorkspace(harness, 'ws-a');

  assert.ok(text(harness.tree()).includes('A newest'));

  harness.unmount();
});
