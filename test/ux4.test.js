/**
 * v1.6 acceptance tests — manual refresh reload (cold reload + animated refresh
 * control).
 *
 * Contract: REQUIREMENTS.md "v1.6 increment — manual refresh reload (user
 * feedback 2026-11-17)" (§28 manual refresh is a cold reload, §29 animated
 * refresh control, §30 acceptance criteria).
 *
 * NEW suite; the frozen v1.5 client harness is imported read-only and driven
 * with deferred per-workspace `githubActions.snapshot` promises, so the forced
 * refresh can be held open, failed with an `{ ok: false, error }` envelope, and
 * advanced through the fake poll timers (`harness.advance`). The rendered
 * refresh control is activated through its `props.onClick`, exactly as a user
 * click would. The animated-control CSS is read from the emitted stylesheet
 * text with the same approach as the frozen v1.4 layout/ux suites.
 *
 * No network, no real DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createHarness,
  visit,
  text,
  plain,
  run,
  snapshot,
  eventStub,
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
const REFRESH_LABEL = 'Refresh';
const RETRY_LABEL = 'Retry';
const POLL_MS = 5000;

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

  function snapshotCalls(id) {
    return calls.filter(
      (call) =>
        call.method === 'githubActions.snapshot' &&
        (id === undefined || call.payload.workspaceId === String(id)),
    );
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

  function fail(id, queueIndex, code, message) {
    resolveResult(
      id,
      queueIndex ?? queueFor(id).length - 1,
      errorEnvelope(code, message),
    );
  }

  return { rpc, calls, queueFor, snapshotCalls, resolve, fail };
}

async function mount(options = {}) {
  const harness = await createHarness(options);

  await harness.mountPage();
  await harness.settle();

  return harness;
}

/**
 * Simulate a real React unmount/remount: the page component's hook state is
 * discarded while the loaded client module (and its module-scope cache) stays.
 */
function resetPageHookState(harness) {
  const instance = harness.renderer.instanceFor('page');

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

async function remount(harness) {
  harness.unmount();
  resetPageHookState(harness);
  await harness.mountPage();
  await harness.settle();

  return harness.tree();
}

/* ------------------------------------------------------------------ */
/* Tree helpers                                                        */
/* ------------------------------------------------------------------ */

function classNames(node) {
  const value = node !== null && typeof node === 'object' ? node.props?.className : undefined;

  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

function hasClass(node, token) {
  return classNames(node).includes(token);
}

function findClass(tree, className) {
  return visit(tree, (node) => hasClass(node, className));
}

function loadingStatuses(tree) {
  return visit(
    tree,
    (node) => node.props?.role === 'status' && text(node).trim() === LOADING_TEXT,
  );
}

function runRows(tree) {
  return visit(tree, (node) => node.props?.['data-gha-run-id'] !== undefined);
}

function documentOrder(node, result = []) {
  if (node === null || node === undefined) return result;
  if (Array.isArray(node)) {
    for (const child of node) documentOrder(child, result);

    return result;
  }

  result.push(node);

  if (typeof node === 'object' && node.children !== undefined) {
    documentOrder(node.children, result);
  }

  return result;
}

function attributeMatches(props, name, expected) {
  const value = props?.[name];

  return value === expected || String(value) === String(expected);
}

function glyphOf(control) {
  return visit(control, (node) => node.type === 'svg' && hasClass(node, 'gha-refresh-icon'))[0];
}

function attributeSize(value) {
  return Number(String(value).replace(/px$/i, '').trim());
}

function assertRefreshGlyph(control, label) {
  const icon = glyphOf(control);

  assert.ok(icon, `${label}: renders an inline svg.gha-refresh-icon`);
  assert.equal(icon.type, 'svg');
  assert.ok(
    attributeMatches(icon.props, 'aria-hidden', 'true'),
    `${label}: the glyph is aria-hidden`,
  );
  assert.ok(
    attributeMatches(icon.props, 'focusable', 'false'),
    `${label}: the glyph is focusable=false`,
  );
  assert.equal(icon.props.stroke, 'currentColor', `${label}: the glyph strokes with currentColor`);
  assert.equal(attributeSize(icon.props.width), 16, `${label}: the glyph is 16px wide`);
  assert.equal(attributeSize(icon.props.height), 16, `${label}: the glyph is 16px high`);

  const order = documentOrder(control);
  const glyphIndex = order.findIndex(
    (node) => node !== null && typeof node === 'object' && node.type === 'svg' && hasClass(node, 'gha-refresh-icon'),
  );
  const labelIndex = order.findIndex(
    (node) => typeof node === 'string' && node.includes(REFRESH_LABEL),
  );

  assert.ok(glyphIndex >= 0, `${label}: the glyph is inside the control`);
  assert.ok(labelIndex >= 0, `${label}: the localized label is inside the control`);
  assert.ok(glyphIndex < labelIndex, `${label}: the glyph comes before the label`);

  return icon;
}

function refreshButtonIn(container, label) {
  const control = visit(
    container,
    (node) => node.type === 'button' && text(node).trim() === REFRESH_LABEL,
  )[0];

  assert.ok(control, `${label}: has a localized ${REFRESH_LABEL} control`);

  return control;
}

function retryButtonIn(container, label) {
  const control = visit(
    container,
    (node) => node.type === 'button' && text(node).trim() === RETRY_LABEL,
  )[0];

  assert.ok(control, `${label}: has a localized ${RETRY_LABEL} control`);

  return control;
}

function toolbarRefresh(tree) {
  const toolbars = findClass(tree, 'gha-toolbar');

  assert.equal(toolbars.length, 1, 'the page toolbar renders');

  return refreshButtonIn(toolbars[0], 'toolbar');
}

function repoIssueRefresh(tree) {
  const cards = findClass(tree, 'gha-state');

  assert.ok(cards.length > 0, 'the repo-issue state card renders');

  return refreshButtonIn(cards[0], 'repo-issue surface');
}

function isBusy(control) {
  return attributeMatches(control.props, 'aria-busy', 'true');
}

function assertIdle(control, label) {
  assert.equal(isBusy(control), false, `${label}: idle control has no aria-busy`);
  assert.equal(Boolean(control.props?.disabled), false, `${label}: idle control is enabled`);
  assert.equal(hasClass(control, 'gha-refreshing'), false, `${label}: idle control is not gha-refreshing`);
  assert.equal(text(control).trim(), REFRESH_LABEL, `${label}: the control stays named ${REFRESH_LABEL}`);
  assertRefreshGlyph(control, label);
}

function assertBusy(control, label) {
  assert.equal(isBusy(control), true, `${label}: busy control has aria-busy=true`);
  assert.equal(Boolean(control.props?.disabled), true, `${label}: busy control is disabled`);
  assert.ok(hasClass(control, 'gha-refreshing'), `${label}: busy control carries gha-refreshing`);
  assert.equal(text(control).trim(), REFRESH_LABEL, `${label}: the control stays named ${REFRESH_LABEL}`);
  assertRefreshGlyph(control, label);
}

/**
 * §28/§21 cold-reload body: exactly one centered localized loading status and no
 * run rows, section headers, empty lines, section wrappers, or state cards.
 */
function assertColdLoading(tree, label) {
  const statuses = loadingStatuses(tree);

  assert.equal(statuses.length, 1, `${label}: exactly one localized loading status`);
  assert.equal(statuses[0].props['aria-live'], 'polite', `${label}: the status is aria-live=polite`);
  assert.equal(text(statuses[0]).trim(), LOADING_TEXT, `${label}: the localized loading text`);
  assert.equal(runRows(tree).length, 0, `${label}: no run rows`);
  assert.equal(findClass(tree, 'gha-list').length, 0, `${label}: no run lists`);
  assert.equal(findClass(tree, 'gha-header').length, 0, `${label}: no section headers`);
  assert.equal(findClass(tree, 'gha-empty-line').length, 0, `${label}: no empty lines`);
  assert.equal(findClass(tree, 'gha-section').length, 0, `${label}: no section wrappers`);
  assert.equal(findClass(tree, 'gha-state').length, 0, `${label}: no state cards`);
}

async function switchWorkspace(harness, workspaceId) {
  const selects = visit(harness.tree(), (node) => node.type === 'select');

  assert.ok(selects[0], 'the workspace select exists');

  await selects[0].props.onChange({
    target: { value: workspaceId },
    currentTarget: { value: workspaceId },
  });
  await harness.settle();
}

async function clickRefresh(control) {
  await control.props.onClick(eventStub());
}

/* ------------------------------------------------------------------ */
/* CSS helpers (same stylesheet-reading approach as the frozen suites) */
/* ------------------------------------------------------------------ */

function readStylesheet() {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const blocks = [...source.matchAll(/`([\s\S]*?)`/g)]
    .map((match) => match[1])
    .filter((block) => block.includes('.gha-page'));

  assert.ok(blocks.length > 0, 'src/client.js must emit a stylesheet with the panel rules');

  return blocks.join('\n');
}

function parseDeclarations(body) {
  return body
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(':');

      return colon === -1
        ? [declaration.toLowerCase(), '']
        : [
            declaration.slice(0, colon).trim().toLowerCase(),
            declaration.slice(colon + 1).trim(),
          ];
    });
}

function parseRules(css) {
  const rules = [];
  const walk = (cssText, media) => {
    let index = 0;

    while (index < cssText.length) {
      while (index < cssText.length && /[\s;}]/.test(cssText[index])) index += 1;
      if (index >= cssText.length) break;

      const open = cssText.indexOf('{', index);

      if (open === -1) break;

      const selector = cssText.slice(index, open).trim();
      let depth = 1;
      let cursor = open + 1;

      while (cursor < cssText.length && depth > 0) {
        if (cssText[cursor] === '{') depth += 1;
        else if (cssText[cursor] === '}') depth -= 1;
        cursor += 1;
      }

      const body = cssText.slice(open + 1, cursor - 1);

      if (selector.startsWith('@media')) {
        walk(body, selector.slice('@media'.length).trim());
      } else if (!selector.startsWith('@')) {
        rules.push({ selector, media: media ?? null, declarations: parseDeclarations(body) });
      }

      index = cursor;
    }
  };

  walk(css, null);

  return rules;
}

function selectorClasses(selector) {
  return [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
}

function declarationsFor(rules, className) {
  const merged = {};

  for (const rule of rules) {
    if (rule.media) continue;
    if (!selectorClasses(rule.selector).includes(className)) continue;

    for (const [property, value] of rule.declarations) merged[property] = value;
  }

  return merged;
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function animationValue(declarations) {
  if (declarations.animation !== undefined) return normalize(declarations.animation);

  return [
    declarations['animation-name'],
    declarations['animation-duration'],
    declarations['animation-timing-function'],
    declarations['animation-iteration-count'],
  ]
    .filter((value) => value !== undefined)
    .join(' ');
}

function keyframesBlock(css, name) {
  const match = new RegExp(`@keyframes\\s+${name}\\s*\\{`, 'i').exec(css);

  if (match === null) return undefined;

  const open = css.indexOf('{', match.index);
  let depth = 0;
  let index = open;

  for (; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  return css.slice(match.index, index + 1);
}

/* ------------------------------------------------------------------ */
/* §30.1 — pressing Refresh is a cold reload                           */
/* ------------------------------------------------------------------ */

test('pressing the toolbar Refresh is a cold reload: the rows become the loading state and exactly one refresh:true read is issued (§30.1)', async () => {
  const rpc = deferredRpc();
  const harness = await mount({
    workspaces: [workspace('ws-a', 'Alpha')],
    rpc: rpc.rpc,
  });

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A first run'));
  await harness.settle();

  let tree = harness.tree();

  assert.ok(text(tree).includes('A first run'), 'the initial rows render');

  const idleControl = toolbarRefresh(tree);

  await clickRefresh(idleControl);
  await harness.settle();

  tree = harness.tree();
  assertColdLoading(tree, 'after pressing Refresh');
  assert.equal(
    text(tree).includes('A first run'),
    false,
    'the previous rows are gone while the forced read is in flight',
  );
  assert.equal(findClass(tree, 'gha-toolbar').length, 1, 'the toolbar stays mounted');
  assertIdle(idleControl, 'toolbar before the reload');

  const pendingCalls = rpc.snapshotCalls('ws-a');

  assert.equal(pendingCalls.length, 2, 'the mount read plus exactly one forced read');
  assert.deepEqual(
    pendingCalls[1].payload,
    { workspaceId: 'ws-a', refresh: true },
    'the forced read payload is exactly { workspaceId, refresh: true }',
  );
  assert.equal(
    rpc.calls.filter(
      (call) => call.method === 'githubActions.snapshot' && call.payload.refresh === true,
    ).length,
    1,
    'exactly one refresh:true read is issued',
  );

  assertBusy(toolbarRefresh(tree), 'toolbar while the forced read is pending');

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A forced run'), 1);
  await harness.settle();

  tree = harness.tree();
  assert.equal(loadingStatuses(tree).length, 0, 'the loading state is transient');
  assert.ok(text(tree).includes('A forced run'), 'the forced snapshot rows render');
  assert.equal(text(tree).includes('A first run'), false, 'the superseded rows stay gone');
  assert.equal(runRows(tree).length, 1, 'exactly the refreshed rows render');
  assertIdle(toolbarRefresh(tree), 'toolbar after the forced read settles');
  assert.equal(
    rpc.calls.filter(
      (call) => call.method === 'githubActions.snapshot' && call.payload.refresh === true,
    ).length,
    1,
    'settling the reload does not issue a second forced read',
  );

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §30.2 — the refreshed value replaces the module cache               */
/* ------------------------------------------------------------------ */

test('the forced value replaces the module cache and the superseded rows never reappear, including after remount (§30.2)', async () => {
  const rpc = deferredRpc();
  const harness = await mount({
    workspaces: [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')],
    rpc: rpc.rpc,
  });

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A superseded run'));
  await harness.settle();

  await clickRefresh(toolbarRefresh(harness.tree()));
  await harness.settle();

  assertColdLoading(harness.tree(), 'during the forced reload');
  assert.equal(
    text(harness.tree()).includes('A superseded run'),
    false,
    'superseded rows never reappear during the reload',
  );

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A refreshed run'), 1);
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A refreshed run'));
  assert.equal(text(harness.tree()).includes('A superseded run'), false);

  // Leave and return: the cache must hold the refreshed value, not the old one.
  await switchWorkspace(harness, 'ws-b');
  rpc.resolve('ws-b', snapshotFor('ws-b', 'Beta', 'B run'));
  await harness.settle();
  assert.ok(text(harness.tree()).includes('B run'));

  await switchWorkspace(harness, 'ws-a');

  const cachedTree = harness.tree();

  assert.ok(
    text(cachedTree).includes('A refreshed run'),
    'leaving and returning renders the refreshed value from the cache',
  );
  assert.equal(text(cachedTree).includes('A superseded run'), false);
  assert.equal(loadingStatuses(cachedTree).length, 0, 'a cache hit does not show loading');

  const aCalls = rpc.snapshotCalls('ws-a');

  assert.equal(aCalls.length, 3, 'mount read + forced read + background read on return');
  assert.deepEqual(
    aCalls[2].payload,
    { workspaceId: 'ws-a' },
    'the cache-hit background read is not forced',
  );

  // A failed background refresh keeps the refreshed cached value (§20 unchanged).
  rpc.fail('ws-a', 2);
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A refreshed run'));
  assert.equal(text(harness.tree()).includes('A superseded run'), false);

  // Remounting the page uses the same module cache: refreshed value, no loading.
  const remountedTree = await remount(harness);

  assert.ok(
    text(remountedTree).includes('A refreshed run'),
    'a remount renders the refreshed value, not the superseded one',
  );
  assert.equal(text(remountedTree).includes('A superseded run'), false);
  assert.equal(loadingStatuses(remountedTree).length, 0);

  const afterRemount = rpc.snapshotCalls('ws-a');

  assert.equal(afterRemount.length, 4, 'the remounted panel still runs a background read');
  assert.deepEqual(
    afterRemount[3].payload,
    { workspaceId: 'ws-a' },
    'the remount background read is not forced',
  );

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A later run'), 3);
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A later run'));
  assert.equal(text(harness.tree()).includes('A superseded run'), false);

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §30.3 — a failed forced reload shows the error surface, no stale rows */
/* ------------------------------------------------------------------ */

test('a failed forced reload ends in the error surface + banner and neither restores nor caches the old rows (§30.3)', async () => {
  const rpc = deferredRpc();
  const harness = await mount({
    workspaces: [workspace('ws-a', 'Alpha')],
    rpc: rpc.rpc,
  });
  const en = harness.dictionaries.en;

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A stale run'));
  await harness.settle();

  await clickRefresh(toolbarRefresh(harness.tree()));
  await harness.settle();

  assertColdLoading(harness.tree(), 'during the forced reload');
  assert.equal(text(harness.tree()).includes('A stale run'), false);

  rpc.fail('ws-a', 1, 'github-unreachable', 'GitHub read failed');
  await harness.settle();

  let tree = harness.tree();

  assert.equal(loadingStatuses(tree).length, 0, 'the loading state ends on failure');
  assert.equal(runRows(tree).length, 0, 'no old rows are restored');
  assert.equal(text(tree).includes('A stale run'), false, 'the superseded rows stay gone');
  assert.equal(findClass(tree, 'gha-list').length, 0);
  assert.equal(findClass(tree, 'gha-header').length, 0);
  assert.equal(findClass(tree, 'gha-empty-line').length, 0);
  assertIdle(toolbarRefresh(tree), 'toolbar after the failed reload');

  const banners = findClass(tree, 'gha-banner');

  assert.equal(banners.length, 1, 'the existing error banner renders');
  assert.equal(text(banners[0]).includes(en['error.banner']), true, 'the banner carries the error text');

  const errorCards = findClass(tree, 'gha-state');

  assert.equal(errorCards.length, 1, 'the error surface renders');
  assert.equal(text(errorCards[0]).includes(en['state.error']), true, 'the error surface title renders');
  retryButtonIn(errorCards[0], 'error surface');

  // The banner Retry stays a warm retry: no refresh:true.
  await clickRefresh(retryButtonIn(banners[0], 'error banner'));
  await harness.settle();

  let calls = rpc.snapshotCalls('ws-a');

  assert.equal(calls.length, 3, 'banner Retry issues one read');
  assert.deepEqual(
    calls[2].payload,
    { workspaceId: 'ws-a' },
    'banner Retry is a warm retry (no refresh:true)',
  );

  rpc.fail('ws-a', 2);
  await harness.settle();

  assert.equal(loadingStatuses(harness.tree()).length, 0);
  assert.equal(text(harness.tree()).includes('A stale run'), false);

  // The error-surface Retry keeps the cold reload semantics.
  await clickRefresh(retryButtonIn(findClass(harness.tree(), 'gha-state')[0], 'error surface'));
  await harness.settle();

  tree = harness.tree();
  assertColdLoading(tree, 'after the error-surface Retry');

  calls = rpc.snapshotCalls('ws-a');
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls[3].payload,
    { workspaceId: 'ws-a', refresh: true },
    'the error-surface Retry is a forced cold reload',
  );

  rpc.fail('ws-a', 3);
  await harness.settle();

  tree = harness.tree();
  assert.equal(loadingStatuses(tree).length, 0);
  assert.equal(text(tree).includes('A stale run'), false);
  assert.equal(runRows(tree).length, 0);

  // Failed reads are never cached: a remount shows loading, not the old rows.
  const remountedTree = await remount(harness);

  assert.equal(loadingStatuses(remountedTree).length, 1, 'no superseded snapshot was cached');
  assert.equal(text(remountedTree).includes('A stale run'), false);
  assert.equal(runRows(remountedTree).length, 0);

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A recovered run'), 4);
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A recovered run'));
  assert.equal(loadingStatuses(harness.tree()).length, 0);

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §30.4 — the forced reload owns the body; polling pauses and resumes */
/* ------------------------------------------------------------------ */

test('the forced reload suppresses scheduled polling, keeps the loading state, and polling resumes at pollMs when it settles (§30.4)', async () => {
  const rpc = deferredRpc();
  const harness = await mount({
    workspaces: [workspace('ws-a', 'Alpha')],
    rpc: rpc.rpc,
    config: { pollMs: POLL_MS, refreshMs: 3000 },
  });

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A run one'));
  await harness.settle();

  assert.equal(rpc.snapshotCalls('ws-a').length, 1, 'the mount read is the only read');

  await harness.advance(1000);

  assert.equal(
    rpc.snapshotCalls('ws-a').length,
    1,
    'no poll read is issued before the poll interval elapses',
  );

  await clickRefresh(toolbarRefresh(harness.tree()));
  await harness.settle();

  assertColdLoading(harness.tree(), 'during the forced reload');
  assert.equal(rpc.snapshotCalls('ws-a').length, 2, 'the forced read is issued');

  await harness.advance(POLL_MS * 3);

  assert.equal(
    rpc.snapshotCalls('ws-a').length,
    2,
    'poll intervals elapse without issuing another snapshot read',
  );
  assert.equal(
    rpc.calls.filter((call) => call.method === 'githubActions.snapshot').length,
    2,
    'no other snapshot read is issued while the forced reload owns the panel',
  );
  assertColdLoading(harness.tree(), 'polling does not replace the loading state');

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A refreshed run'), 1);
  await harness.settle();

  assert.equal(loadingStatuses(harness.tree()).length, 0);
  assert.ok(text(harness.tree()).includes('A refreshed run'));
  assert.equal(
    rpc.snapshotCalls('ws-a').length,
    2,
    'no immediate read on settle; polling resumes at its normal cadence',
  );

  await harness.advance(POLL_MS);

  const resumed = rpc.snapshotCalls('ws-a');

  assert.equal(resumed.length, 3, 'normal polling resumes after the forced read settles');
  assert.deepEqual(
    resumed[2].payload,
    { workspaceId: 'ws-a' },
    'the resumed poll read is not forced',
  );
  assert.equal(loadingStatuses(harness.tree()).length, 0);
  assert.ok(text(harness.tree()).includes('A refreshed run'));

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A polled run'), 2);
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A polled run'));

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §29 / §30.5 — animated refresh control (markup + stylesheet)        */
/* ------------------------------------------------------------------ */

test('every refresh control renders the inline glyph and busy animation state, and the stylesheet defines gha-spin with a reduced-motion override (§29, §30.5)', async () => {
  const rpc = deferredRpc();
  const harness = await mount({
    workspaces: [workspace('ws-a', 'Alpha')],
    rpc: rpc.rpc,
  });

  rpc.resolve(
    'ws-a',
    snapshotFor('ws-a', 'Alpha', 'A issue run', {
      repoStatus: 'no-remote',
      runs: [],
      history: [],
    }),
  );
  await harness.settle();

  let tree = harness.tree();

  // Every refresh control renders the glyph before its localized label, idle.
  assertIdle(toolbarRefresh(tree), 'toolbar');
  assertIdle(repoIssueRefresh(tree), 'repo-issue surface');

  // --- animated-control CSS, read from the emitted stylesheet text ------
  const css = readStylesheet();
  const rules = parseRules(css);

  const spin = keyframesBlock(css, 'gha-spin');

  assert.ok(spin, 'the stylesheet defines @keyframes gha-spin');
  assert.match(
    spin,
    /transform:\s*rotate\(\s*360deg\s*\)/,
    'gha-spin rotates the glyph a full turn',
  );

  const iconStyle = declarationsFor(rules, 'gha-refresh-icon');

  assert.equal(normalize(iconStyle.display), 'block', '.gha-refresh-icon is display:block');

  const rotating = rules.find(
    (rule) =>
      !rule.media &&
      selectorClasses(rule.selector).includes('gha-refreshing') &&
      selectorClasses(rule.selector).includes('gha-refresh-icon'),
  );

  assert.ok(rotating, '.gha-refreshing .gha-refresh-icon is wired to the animation');

  const animation = animationValue(Object.fromEntries(rotating.declarations));

  assert.match(animation, /gha-spin/, 'the wiring uses the gha-spin animation');
  assert.match(animation, /(^|\s)1s(\s|$)/, 'the animation lasts 1s');
  assert.match(animation, /linear/, 'the animation is linear');
  assert.match(animation, /infinite/, 'the animation repeats infinitely');

  const reducedMotion = rules.filter(
    (rule) => rule.media && /prefers-reduced-motion/.test(rule.media),
  );

  assert.ok(reducedMotion.length > 0, 'the stylesheet has a prefers-reduced-motion block');

  const reducedRefresh = reducedMotion.filter((rule) =>
    selectorClasses(rule.selector).some(
      (className) => className === 'gha-refresh-icon' || className === 'gha-refreshing',
    ),
  );

  assert.ok(reducedRefresh.length > 0, 'the reduced-motion block targets the refresh icon');

  const disablesRotation = reducedRefresh.some((rule) =>
    rule.declarations.some(([property, value]) => {
      const normalized = normalize(value);

      if (property === 'animation' || property === 'animation-name') {
        return normalized === 'none';
      }
      if (property === 'animation-duration') {
        return /^0(?:\.0+)?(?:ms|s)$/.test(normalized);
      }
      if (property === 'animation-play-state') return normalized === 'paused';

      return false;
    }),
  );

  assert.ok(disablesRotation, 'the reduced-motion block disables the rotation');

  const hidesGlyph = reducedRefresh.some((rule) =>
    rule.declarations.some(
      ([property, value]) => property === 'display' && normalize(value) === 'none',
    ),
  );

  assert.equal(hidesGlyph, false, 'the glyph stays visible under reduced motion');

  // No literal colors in the refresh-control CSS (host tokens + currentColor only).
  const colorLiteral = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

  for (const rule of rules) {
    const classes = selectorClasses(rule.selector);

    if (!classes.some((className) => className === 'gha-refresh-icon' || className === 'gha-refreshing')) {
      continue;
    }

    for (const [property, value] of rule.declarations) {
      assert.equal(
        colorLiteral.test(value),
        false,
        `${rule.selector}: ${property} must not use a literal color`,
      );
    }
  }

  assert.equal(colorLiteral.test(spin), false, 'the gha-spin keyframes use no literal color');

  // --- §28: the repo-issue Refresh is also a cold reload ----------------
  await clickRefresh(repoIssueRefresh(tree));
  await harness.settle();

  tree = harness.tree();
  assertColdLoading(tree, 'after the repo-issue Refresh');
  assert.equal(findClass(tree, 'gha-state').length, 0, 'the repo-issue card is replaced');
  assertBusy(toolbarRefresh(tree), 'toolbar while the repo-issue reload is pending');

  const calls = rpc.snapshotCalls('ws-a');

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls[1].payload,
    { workspaceId: 'ws-a', refresh: true },
    'the repo-issue Refresh issues a forced read',
  );

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A ready run', { repoStatus: 'ok' }), 1);
  await harness.settle();

  tree = harness.tree();
  assert.equal(loadingStatuses(tree).length, 0);
  assert.ok(text(tree).includes('A ready run'));
  assertIdle(toolbarRefresh(tree), 'toolbar after the repo-issue reload settles');

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §28 — workspace change resets the control; no active workspace no-op */
/* ------------------------------------------------------------------ */

test('changing the workspace resets the refresh control to idle, an abandoned reload cannot overwrite it, and no active workspace is a no-op (§28)', async () => {
  const rpc = deferredRpc();
  const harness = await mount({
    workspaces: [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')],
    rpc: rpc.rpc,
  });

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A run'));
  await harness.settle();

  await clickRefresh(toolbarRefresh(harness.tree()));
  await harness.settle();

  assertColdLoading(harness.tree(), "during A's forced reload");
  assertBusy(toolbarRefresh(harness.tree()), "toolbar during A's reload");

  await switchWorkspace(harness, 'ws-b');

  let tree = harness.tree();

  assertColdLoading(tree, 'B starts with no cache and its own read');
  assertIdle(toolbarRefresh(tree), 'toolbar after the workspace change');

  const bCalls = rpc.snapshotCalls('ws-b');

  assert.equal(bCalls.length, 1, 'selecting B starts its normal read');

  // The abandoned A response must not clear or overwrite B's loading state.
  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A abandoned run'), 1);
  await harness.settle();

  tree = harness.tree();
  assertColdLoading(tree, 'B keeps ownership of the panel');
  assert.equal(text(tree).includes('A abandoned run'), false, 'the abandoned response is not rendered');
  assert.equal(text(tree).includes('A run'), false);
  assertIdle(toolbarRefresh(tree), 'toolbar stays idle');

  rpc.resolve('ws-b', snapshotFor('ws-b', 'Beta', 'B run'));
  await harness.settle();

  assert.equal(loadingStatuses(harness.tree()).length, 0);
  assert.ok(text(harness.tree()).includes('B run'));

  harness.unmount();

  // With no active workspace the refresh control is a no-op.
  const emptyRpc = deferredRpc();
  const empty = await mount({ workspaces: [], rpc: emptyRpc.rpc });
  const loadingBefore = loadingStatuses(empty.tree()).length;
  const emptyControl = toolbarRefresh(empty.tree());

  assertIdle(emptyControl, 'toolbar without an active workspace');

  await clickRefresh(emptyControl);
  await empty.settle();

  assert.equal(emptyRpc.snapshotCalls().length, 0, 'no snapshot read without an active workspace');
  assert.equal(
    loadingStatuses(empty.tree()).length,
    loadingBefore,
    'the no-op does not start a loading transition',
  );
  assert.equal(runRows(empty.tree()).length, 0);
  assert.equal(findClass(empty.tree(), 'gha-state').length, 0);
  assertIdle(toolbarRefresh(empty.tree()), 'toolbar without an active workspace');

  empty.unmount();
});
