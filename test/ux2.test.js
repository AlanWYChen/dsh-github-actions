/**
 * v1.4 acceptance tests — perceived latency (in-memory cache + loading state)
 * and toolbar/spacing polish.
 *
 * Contract: REQUIREMENTS.md "v1.4 increment — perceived latency and toolbar
 * polish" (§20 in-memory snapshot cache, §21 loading state, §22 toolbar, §23
 * spacing/empty state, §24 acceptance criteria).
 *
 * NEW suite; the frozen client harness is imported read-only
 * (test/fixtures/client-harness.mjs) and driven with a controllable `rpc` so the
 * cache/loading tests can hold snapshot reads open. No network, no real DOM.
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

/**
 * RPC fake: `status` answers immediately; every `snapshot` call is a deferred
 * promise recorded per workspace, so a test can hold a read in flight and
 * settle it later (success envelope or error envelope).
 */
function deferredRpc() {
  const queues = new Map();
  const calls = [];

  async function rpc(channel, method, payload) {
    assert.equal(channel, '/api');
    calls.push({ method, payload: plain(payload ?? {}) });

    if (method === 'githubActions.status') return { ok: true, value: AUTH };

    if (method === 'githubActions.snapshot') {
      const id = payload?.workspaceId;
      const entry = deferred();
      const queue = queues.get(id) ?? [];

      queue.push(entry);
      queues.set(id, queue);

      return entry.promise;
    }

    throw new Error(`unexpected RPC method ${method}`);
  }

  function next(id) {
    const queue = queues.get(id) ?? [];
    const entry = queue.find((candidate) => !candidate.settled);

    assert.ok(entry, `no pending snapshot read for workspace ${id}`);

    return entry;
  }

  function resolve(id, value) {
    next(id).resolve({ ok: true, value });
  }

  function fail(id, code = 'github-unreachable', message = 'GitHub read failed') {
    next(id).resolve({ ok: false, error: { code, message, details: {} } });
  }

  return { rpc, calls, next, resolve, fail };
}

function immediateRpc() {
  async function rpc(channel, method, payload) {
    assert.equal(channel, '/api');

    if (method === 'githubActions.status') return { ok: true, value: AUTH };
    if (method === 'githubActions.snapshot') {
      return {
        ok: true,
        value: snapshotFor(
          payload.workspaceId,
          String(payload.workspaceId).replace('ws-', 'Project '),
          `${payload.workspaceId} run`,
        ),
      };
    }

    throw new Error(`unexpected RPC method ${method}`);
  }

  return { rpc };
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

function selectsIn(tree) {
  return visit(tree, (node) => node.type === 'select');
}

function optionsIn(select) {
  return visit(select, (node) => node.type === 'option');
}

function loadingStatuses(tree) {
  return visit(
    tree,
    (node) => node.props?.role === 'status' && text(node).trim() === LOADING_TEXT,
  );
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

async function switchWorkspace(harness, workspaceId) {
  const select = selectsIn(harness.tree())[0];

  assert.ok(select, 'the workspace select exists');

  await select.props.onChange({
    target: { value: workspaceId },
    currentTarget: { value: workspaceId },
  });
  await harness.settle();
}

/* ------------------------------------------------------------------ */
/* CSS helpers (same approach as the frozen layout/ux suites)          */
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

      if (selector.startsWith('@')) {
        if (selector.startsWith('@media') || selector.startsWith('@supports')) walk(body, true);
      } else {
        rules.push({ selector, media, declarations: parseDeclarations(body) });
      }

      index = cursor;
    }
  };

  walk(css, false);

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

function declarationsForAny(rules, classes) {
  for (const className of classes) {
    const declarations = declarationsFor(rules, className);

    if (Object.keys(declarations).length > 0) return { className, declarations };
  }

  return undefined;
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* §20 / §24.1 — in-memory snapshot cache                              */
/* ------------------------------------------------------------------ */

test('switching workspaces renders cached snapshots immediately while a background refresh runs (§20)', async () => {
  const rpc = deferredRpc();
  const workspaces = [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')];
  const harness = await mount({ workspaces, rpc: rpc.rpc });

  assert.ok(
    rpc.calls.some(
      (call) =>
        call.method === 'githubActions.snapshot' && call.payload.workspaceId === 'ws-a',
    ),
  );

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A run'));
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A run'));

  await switchWorkspace(harness, 'ws-b');

  rpc.resolve('ws-b', snapshotFor('ws-b', 'Beta', 'B run'));
  await harness.settle();

  assert.ok(text(harness.tree()).includes('B run'));

  // Switch back: the cached A snapshot must render immediately, before the
  // background read settles, with no loading state.
  await switchWorkspace(harness, 'ws-a');

  const cachedTree = harness.tree();

  assert.ok(text(cachedTree).includes('A run'), 'A renders from cache immediately');
  assert.equal(loadingStatuses(cachedTree).length, 0, 'no loading state on a cache hit');

  const aCalls = rpc.calls.filter(
    (call) => call.method === 'githubActions.snapshot' && call.payload.workspaceId === 'ws-a',
  );

  assert.equal(aCalls.length, 2, 'the background refresh still runs on a cache hit');
  assert.equal(aCalls[1].payload.refresh, undefined, 'the background read is not a forced refresh');

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A run v2'));
  await harness.settle();

  assert.ok(text(harness.tree()).includes('A run v2'), 'the successful refresh replaces the entry');

  harness.unmount();
});

test('a failed background refresh keeps the cached rows + banner, and failures are never cached (§20)', async () => {
  const rpc = deferredRpc();
  const workspaces = [
    workspace('ws-a', 'Alpha'),
    workspace('ws-b', 'Beta'),
    workspace('ws-c', 'Gamma'),
  ];
  const harness = await mount({ workspaces, rpc: rpc.rpc });

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A run'));
  await harness.settle();

  await switchWorkspace(harness, 'ws-b');
  rpc.resolve('ws-b', snapshotFor('ws-b', 'Beta', 'B run'));
  await harness.settle();

  // A cache hit starts a background read; make that read fail.
  await switchWorkspace(harness, 'ws-a');
  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A run'));
  await harness.settle();

  await switchWorkspace(harness, 'ws-b');
  rpc.fail('ws-b');
  await harness.settle();

  const failedTree = harness.tree();
  const en = harness.dictionaries.en;

  assert.ok(text(failedTree).includes('B run'), 'cached rows survive a failed refresh');
  assert.equal(loadingStatuses(failedTree).length, 0);
  assert.ok(
    visit(failedTree, (node) => hasClass(node, 'gha-banner')).length > 0 ||
      text(failedTree).includes(en['error.banner']),
    'the existing error banner is surfaced',
  );

  // Failed reads are not cached: a never-successful workspace shows loading on
  // its next selection instead of a cached error snapshot.
  await switchWorkspace(harness, 'ws-c');
  rpc.fail('ws-c');
  await harness.settle();

  assert.equal(loadingStatuses(harness.tree()).length, 0, 'the failed read settles to the error surface');

  await switchWorkspace(harness, 'ws-b');
  rpc.resolve('ws-b', snapshotFor('ws-b', 'Beta', 'B run'));
  await harness.settle();

  await switchWorkspace(harness, 'ws-c');

  assert.equal(
    loadingStatuses(harness.tree()).length,
    1,
    'a workspace whose only read failed has no cache and shows loading again',
  );
  assert.equal(text(harness.tree()).includes('C run'), false);

  rpc.resolve('ws-c', snapshotFor('ws-c', 'Gamma', 'C run'));
  await harness.settle();

  assert.ok(text(harness.tree()).includes('C run'));

  harness.unmount();
});

test('the snapshot cache is bounded to 20 workspace entries (§20)', async () => {
  const rpc = deferredRpc();
  const workspaces = Array.from({ length: 21 }, (_, index) =>
    workspace(`ws-${index}`, `Project ${index}`),
  );
  const harness = await mount({ workspaces, rpc: rpc.rpc });

  rpc.resolve('ws-0', snapshotFor('ws-0', 'Project 0', 'run 0'));
  await harness.settle();

  for (let index = 1; index < workspaces.length; index += 1) {
    const id = `ws-${index}`;

    await switchWorkspace(harness, id);
    rpc.resolve(id, snapshotFor(id, `Project ${index}`, `run ${index}`));
    await harness.settle();
  }

  // ws-0 was the oldest insertion and must have been evicted by the 21st entry.
  await switchWorkspace(harness, 'ws-0');

  assert.equal(
    loadingStatuses(harness.tree()).length,
    1,
    'the oldest cache entry is evicted once the bound is exceeded',
  );
  assert.equal(text(harness.tree()).includes('run 0'), false);

  rpc.resolve('ws-0', snapshotFor('ws-0', 'Project 0', 'run 0'));
  await harness.settle();

  assert.ok(text(harness.tree()).includes('run 0'));

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §21 / §24.2 — loading state                                         */
/* ------------------------------------------------------------------ */

test('a cache miss with a pending read renders exactly one localized loading status and no lists/headers/empty lines (§21)', async () => {
  const rpc = deferredRpc();
  const harness = await mount({
    workspaces: [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')],
    rpc: rpc.rpc,
  });

  const pendingTree = harness.tree();
  const statuses = loadingStatuses(pendingTree);

  assert.equal(statuses.length, 1, 'exactly one localized loading status');
  assert.equal(statuses[0].props['aria-live'], 'polite');
  assert.equal(text(statuses[0]).trim(), LOADING_TEXT);
  assert.equal(visit(pendingTree, (node) => node.props?.role === 'list').length, 0);
  assert.equal(visit(pendingTree, (node) => hasClass(node, 'gha-list')).length, 0);
  assert.equal(visit(pendingTree, (node) => hasClass(node, 'gha-empty-line')).length, 0);
  assert.equal(visit(pendingTree, (node) => hasClass(node, 'gha-header')).length, 0);
  assert.equal(harness.module.describeState(null).kind, 'error', 'describeState(null) stays error');

  rpc.resolve('ws-a', snapshotFor('ws-a', 'Alpha', 'A run'));
  await harness.settle();

  assert.equal(loadingStatuses(harness.tree()).length, 0, 'loading is transient');
  assert.ok(text(harness.tree()).includes('A run'));

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §22 / §24.3 — toolbar                                              */
/* ------------------------------------------------------------------ */

test('the dropdown always shows the workspace title and the repo control shows slug + icon on the shared center line (§22)', async () => {
  const rpc = immediateRpc();
  const workspaces = [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')];
  const harness = await mount({ workspaces, rpc: rpc.rpc });
  const tree = harness.tree();
  const selects = selectsIn(tree);

  assert.equal(selects.length, 1);

  const select = selects[0];
  const options = optionsIn(select);
  const selected = options.find(
    (option) => String(option.props.value) === String(select.props.value),
  );

  assert.ok(selected);
  assert.equal(text(selected).trim(), 'Alpha', 'the selected label is the workspace title');
  assert.notEqual(text(selected).trim(), REPO.slug, 'the repo slug must not be the selected label');

  for (const option of options) {
    const id = String(option.props.value);
    const workspaceEntry = workspaces.find((candidate) => candidate.workspaceId === id);

    assert.equal(text(option).trim(), workspaceEntry.title, `option ${id} shows the workspace title`);
  }

  const header = visit(tree, (node) => hasClass(node, 'gha-toolbar'))[0];
  const links = visit(header, (node) => node.type === 'a');
  const repoControl = links.find(
    (link) => text(link).includes(REPO.slug) && visit(link, (node) => node.type === 'svg').length > 0,
  );

  assert.ok(repoControl, 'the repo control contains the slug text and the inline icon');
  assert.equal(repoControl.props.href, REPO.webUrl);
  assert.equal(repoControl.props.target, '_blank');
  assert.match(repoControl.props.rel ?? '', /noreferrer/);
  assert.match(repoControl.props.rel ?? '', /noopener/);

  const nodes = flattenNodes(tree);

  assert.ok(
    nodes.indexOf(select) < nodes.indexOf(repoControl),
    'the repo control comes after the dropdown',
  );

  const css = readStylesheet();
  const rules = parseRules(css);

  // Select sizing: DSH picker conventions.
  let selectStyle;
  let selectClass;

  for (const className of classNames(select)) {
    const declarations = declarationsFor(rules, className);

    if (normalize(declarations['min-width']) === '240px') {
      selectStyle = declarations;
      selectClass = className;
      break;
    }
  }

  assert.ok(selectStyle, 'the select must declare min-width:240px');
  assert.equal(normalize(selectStyle['max-width']), '360px');
  assert.equal(normalize(selectStyle.width), 'auto');
  assert.match(normalize(selectStyle['text-overflow']), /ellipsis/);

  const selectHeight = normalize(selectStyle.height || selectStyle['min-height']);

  assert.match(selectHeight, /^\d+px$/, `${selectClass} has a toolbar height`);
  assert.ok(Number.parseInt(selectHeight, 10) > 0);

  // Repo control: inline-flex button-like link, height 32px, centered content.
  const controlClass = classNames(repoControl).find((className) => {
    const declarations = declarationsFor(rules, className);

    return normalize(declarations.display) === 'inline-flex';
  });

  assert.ok(controlClass, 'the repo control carries an inline-flex button-like class');

  const controlStyle = declarationsFor(rules, controlClass);

  assert.equal(normalize(controlStyle['align-items']), 'center');
  assert.equal(normalize(controlStyle.height), '32px');
  assert.match(normalize(controlStyle.padding), /^0(?:px)? 10px$/);
  assert.match(normalize(controlStyle.border), /^1px solid/);
  assert.equal(normalize(controlStyle['border-radius']), '8px');
  assert.match(normalize(controlStyle['white-space']), /nowrap/);

  // Icon: display:block, flex:none, line-height:1.
  const svg = visit(repoControl, (node) => node.type === 'svg')[0];
  const iconClass = classNames(svg).find((className) => {
    const declarations = declarationsFor(rules, className);

    return normalize(declarations.display) !== '';
  });

  assert.ok(iconClass, 'the icon has its own class');

  const iconStyle = declarationsFor(rules, iconClass);

  assert.equal(normalize(iconStyle.display), 'block');
  assert.equal(normalize(iconStyle.flex), 'none');
  assert.equal(normalize(iconStyle['line-height']), '1');

  // Toolbar rows share the same vertical center line.
  const toolbarStyle = declarationsFor(rules, 'gha-toolbar');
  const leftGroupStyle = declarationsFor(rules, 'gha-toolbar-main');

  assert.equal(normalize(toolbarStyle['align-items']), 'center');
  assert.equal(normalize(leftGroupStyle['align-items']), 'center');

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §23 / §24.4 — spacing and empty state                               */
/* ------------------------------------------------------------------ */

test('Running/Recent are separated by 16px and the empty line is centered while keeping its inset (§23)', () => {
  const css = readStylesheet();
  const rules = parseRules(css);
  const runs = declarationsFor(rules, 'gha-runs');
  const empty = declarationsFor(rules, 'gha-empty-line');

  assert.equal(normalize(runs.gap), '16px', '.gha-runs has an explicit 16px vertical gap');
  assert.equal(normalize(empty['text-align']), 'center');
  assert.equal(normalize(empty.padding), '14px');
  assert.equal(normalize(empty.margin), '0');
});

/* ------------------------------------------------------------------ */
/* §21 / §24.2 — loading locale key                                    */
/* ------------------------------------------------------------------ */

test('the loading locale key exists in both inline dictionaries and both locale files with identical key sets (§21)', async () => {
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

  assert.deepEqual(Object.keys(runtimeEn).sort(), Object.keys(runtimeZh).sort());
  assert.deepEqual(Object.keys(runtimeEn).sort(), Object.keys(enFile).sort());
  assert.deepEqual(Object.keys(runtimeZh).sort(), Object.keys(zhFile).sort());
  assert.deepEqual(Object.keys(enFile).sort(), Object.keys(zhFile).sort());

  const key = Object.keys(runtimeEn).find((candidate) => runtimeEn[candidate] === LOADING_TEXT);

  assert.ok(key, `the inline en dictionary has ${JSON.stringify(LOADING_TEXT)}`);
  assert.equal(enFile[key], LOADING_TEXT, 'locale/en.json has the loading text');
  assert.equal(typeof runtimeZh[key], 'string');
  assert.ok(runtimeZh[key].length > 0);
  assert.equal(typeof zhFile[key], 'string');
  assert.ok(zhFile[key].length > 0);

  harness.unmount();
});
