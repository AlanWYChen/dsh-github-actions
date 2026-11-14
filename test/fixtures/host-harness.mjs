/**
 * Shared host-side fakes copied from the frozen v1 harness (test/host.test.js)
 * for the v1.1 history suite. This file is a copy, not the frozen v1 file; the
 * v1 harness stays byte-identical.
 *
 * Exposes the same in-memory credentials/workspace/editor/git/GitHub seams and
 * handler-invocation normalization helpers. No network, no subprocess.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Config } from '../../src/index.js';

const METHODS = ['status', 'begin', 'poll', 'cancel', 'signOut', 'snapshot', 'setClientId'];
const ROUTE_PREFIX = '/api/githubActions.';
const SECRET = 'gho_host_secret';
const NOW = Date.parse('2026-01-02T03:04:05.000Z');

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function parseConfig(input = {}) {
  if (typeof Config === 'function') return Config(input);
  if (Config && typeof Config.parse === 'function') return Config.parse(input);

  assert.fail('src/index.js must export a Config schema that can parse config');
}

function baseConfig(overrides = {}) {
  return {
    clientId: 'Iv1.host-client',
    scopes: 'repo',
    host: 'github.com',
    apiBaseUrl: 'https://api.github.com',
    refreshMs: 3000,
    pollMs: 5000,
    timeoutMs: 10000,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Credentials seam                                                    */
/* ------------------------------------------------------------------ */

function grantRecord(overrides = {}) {
  return {
    kind: 'grant',
    payload: {
      token: SECRET,
      tokenType: 'bearer',
      scopes: ['repo'],
      login: 'octocat',
      obtainedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

/**
 * In-memory credentials adapter that satisfies both plausible host seams: the
 * flow store interface (`read`/`write`/`clear`) and the Cordis record API
 * (`readRecord`/`modifyRecord`/`deleteRecord`). Tests observe the resulting
 * state through `current`, never through a particular method name.
 */
function credentialFixture(record) {
  let current = record === undefined ? undefined : structuredClone(record);
  const counts = { read: 0, write: 0, clear: 0, modify: 0, delete: 0 };
  const keys = { read: [], modify: [], delete: [] };

  const api = {
    read() {
      counts.read += 1;

      return current;
    },
    write(next) {
      counts.write += 1;
      current = structuredClone(next);
    },
    clear() {
      counts.clear += 1;
      current = undefined;
    },
    async readRecord(key) {
      counts.read += 1;
      keys.read.push(String(key));

      return current;
    },
    async modifyRecord(key, mutate) {
      counts.modify += 1;
      keys.modify.push(String(key));

      const next = await mutate(current);

      if (next !== undefined) current = structuredClone(next);

      return current;
    },
    async deleteRecord(key) {
      counts.delete += 1;
      keys.delete.push(String(key));
      current = undefined;
    },
    async describeRecord() {
      return current === undefined
        ? { configured: false, writable: true }
        : { configured: true, kind: current.kind, writable: true };
    },
    async listRecords() {
      return [];
    },
  };

  Object.defineProperty(api, 'current', { get: () => current });
  Object.defineProperty(api, 'counts', { value: counts });
  Object.defineProperty(api, 'keys', { value: keys });

  return api;
}

/* ------------------------------------------------------------------ */
/* Workspace and config-editor seams                                   */
/* ------------------------------------------------------------------ */

function workspaceEntity(path, overrides = {}) {
  return {
    id: 'ws-1',
    workspaceId: 'ws-1',
    title: 'Project',
    path,
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function workspaceRegistry(entries) {
  const ordered = [...entries];
  const byId = new Map(ordered.map((entry) => [entry.id, entry]));

  return {
    get: (id) => byId.get(id),
    list: () => [...ordered],
    resolveByPath: async (path) => ordered.find((entry) => entry.path === path),
  };
}

function editorFixture(initialConfig = { clientId: '', scopes: 'repo' }) {
  const entry = {
    options: {
      id: 'github-actions',
      name: '@local/dsh-github-actions',
      config: structuredClone(initialConfig),
    },
  };
  const edits = [];

  const editor = {
    entries: () => [entry],
    edit: async (target, change) => {
      const next = await change(structuredClone(entry.options.config), {});

      edits.push({ entry: target, next: structuredClone(next) });
      entry.options.config = next;

      return next;
    },
    entry,
    edits,
  };

  return editor;
}

/* ------------------------------------------------------------------ */
/* git process seam                                                    */
/* ------------------------------------------------------------------ */

function remotesText(entries) {
  if (entries.length === 0) return '';

  return (
    entries
      .flatMap(([name, url]) => [
        `${name}\t${url} (fetch)`,
        `${name}\t${url} (push)`,
      ])
      .join('\n') + '\n'
  );
}

/**
 * A real temporary workspace (with or without a `.git` directory) plus a fake
 * git process. Both plausible checkout detectors pass: filesystem existence is
 * correct for the fixture, and the fake answers `rev-parse`/`remote` commands.
 * Supports `(cwd, args)` and `(args, { cwd })` call shapes.
 */
async function checkoutFixture({ checkout = true, remotes = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-github-actions-'));

  if (checkout) await mkdir(join(dir, '.git'), { recursive: true });

  const calls = [];
  const ok = (stdout) => ({ stdout, stderr: '', exitCode: 0 });
  const fail = (stderr) => ({ stdout: '', stderr, exitCode: 128 });

  const run = async (first, second) => {
    const cwd = Array.isArray(first) ? (second && second.cwd) ?? dir : first;
    const args = Array.isArray(first) ? first : Array.isArray(second) ? second : [];
    const joined = args.join(' ');

    calls.push({ cwd, args: [...args] });

    if (joined.includes('@{upstream}')) return fail('fatal: no upstream configured');
    if (args.includes('remote') && args.includes('-v')) return ok(remotesText(remotes));

    if (args.includes('rev-parse')) {
      if (!checkout) {
        return fail('fatal: not a git repository (or any of the parent directories): .git');
      }
      if (args.includes('--show-toplevel')) return ok(`${dir}\n`);
      if (args.includes('--git-dir')) return ok('.git\n');
      if (args.includes('--is-inside-work-tree')) return ok('true\n');

      return ok(`${dir}\n`);
    }

    return fail(`unexpected git command: git ${joined}`);
  };

  return {
    dir,
    run,
    calls,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/* ------------------------------------------------------------------ */
/* GitHub HTTP seam                                                    */
/* ------------------------------------------------------------------ */

function githubResponse({ status = 200, body = {}, headers = {} } = {}) {
  const lower = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );
  const headerBag = {
    get: (name) => {
      const key = String(name).toLowerCase();

      return lower.has(key) ? lower.get(key) : null;
    },
    has: (name) => lower.has(String(name).toLowerCase()),
    entries: () => lower.entries(),
    forEach: (callback) => lower.forEach((value, key) => callback(value, key)),
    ...Object.fromEntries(lower),
  };

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerBag,
    json: async () => structuredClone(body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function githubFixture(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), init };
    calls.push(call);

    const next = await handler(String(url), init, calls.length);

    if (next instanceof Error) throw next;

    return next;
  };

  return { fetch, calls };
}

function requestHeaders(init = {}) {
  const raw = init && init.headers !== undefined ? init.headers : init ?? {};

  if (raw && typeof raw.entries === 'function') {
    return Object.fromEntries(
      [...raw.entries()].map(([key, value]) => [String(key).toLowerCase(), String(value)]),
    );
  }
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map(([key, value]) => [String(key).toLowerCase(), String(value)]));
  }

  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );
}

function requestParams(init = {}) {
  const body = init && init.body !== undefined ? init.body : undefined;

  if (body === undefined || body === null) return {};
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);

      if (parsed && typeof parsed === 'object') return { ...parsed };
    } catch {
      /* fall through to form encoding */
    }

    return Object.fromEntries(new URLSearchParams(body));
  }
  if (typeof body.entries === 'function') return Object.fromEntries(body.entries());
  if (typeof body === 'object') return { ...body };

  return {};
}

function requestMethod(init = {}) {
  return String(init && init.method !== undefined ? init.method : 'GET').toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Handler invocation (tolerant of the documented result conventions)  */
/* ------------------------------------------------------------------ */

function rpcError(error) {
  const normalized = new Error(error && typeof error.message === 'string' ? error.message : 'rpc failed');

  normalized.code = error && error.code;
  normalized.details = (error && error.details) ?? {};

  return normalized;
}

function handlerFor(handlers, method) {
  const fullName = `githubActions.${method}`;
  const fn = handlers ? handlers[fullName] ?? handlers[method] : undefined;

  assert.equal(
    typeof fn,
    'function',
    `createHandlers must expose ${fullName} (short or fully qualified key)`,
  );

  return fn;
}

function unwrap(raw) {
  if (raw && typeof raw === 'object' && typeof raw.ok === 'boolean') {
    if (raw.ok) return raw.value;

    throw rpcError(raw.error);
  }

  return raw;
}

function warningOf(raw) {
  const value = raw && typeof raw === 'object' && raw.ok === true ? raw.value : raw;

  return (raw && raw.details && raw.details.warning) ?? (raw && raw.warning) ?? (value && value.warning);
}

async function invokeRaw(handlers, method, payload = {}) {
  return await handlerFor(handlers, method)(payload);
}

async function invoke(handlers, method, payload = {}) {
  return unwrap(await invokeRaw(handlers, method, payload));
}

async function expectError(handlers, method, payload, code) {
  try {
    await invoke(handlers, method, payload);
  } catch (error) {
    const actual = error && (error.code ?? (error.error && error.error.code));

    assert.equal(actual, code, `${method} must fail with ${code}`);
    assert.equal(typeof (error.message ?? error.error?.message), 'string');

    const details = error.details ?? error.error?.details;

    if (details !== undefined) assert.equal(typeof details, 'object');

    return error;
  }

  assert.fail(`${method} must fail with ${code}`);
}

/* ------------------------------------------------------------------ */
/* Handler deps                                                        */
/* ------------------------------------------------------------------ */

function handlerDeps(options = {}) {
  const hasEditor = Object.hasOwn(options, 'editor');
  const { config, credentials, workspaces, editor, git, github, now } = options;
  return {
    config: config ?? baseConfig(),
    credentials: credentials ?? credentialFixture(),
    workspaces: workspaces ?? workspaceRegistry([]),
    editor: hasEditor ? editor : editorFixture(),
    gitRun: git ? git.run : async () => ({ stdout: '', stderr: '', exitCode: 1 }),
    githubFetch: github ? github.fetch : async () => githubResponse({ body: {} }),
    now: now ?? (() => NOW),
  };
}

function runsPayload(runs) {
  return { total_count: runs.length, workflow_runs: runs };
}

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
    htmlUrl: 'https://github.com/octo/hello/actions/runs/101',
    workflowUrl: 'https://github.com/octo/hello/blob/main/.github/workflows/ci.yml',
    ...overrides,
  };
}


export {
  METHODS,
  ROUTE_PREFIX,
  SECRET,
  NOW,
  parseConfig,
  baseConfig,
  grantRecord,
  credentialFixture,
  workspaceEntity,
  workspaceRegistry,
  editorFixture,
  remotesText,
  checkoutFixture,
  githubResponse,
  githubFixture,
  requestHeaders,
  requestParams,
  requestMethod,
  rpcError,
  handlerFor,
  unwrap,
  warningOf,
  invokeRaw,
  invoke,
  expectError,
  handlerDeps,
  runsPayload,
  rawRun,
  mappedRun,
};
