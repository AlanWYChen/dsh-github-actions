/**
 * Host contract for src/index.js — REQUIREMENTS.md §3, §4, §6, §7, §9.5, §9.6.
 *
 * Two layers:
 *   1. `createHandlers(deps)` called directly with fake credentials, workspaces,
 *      editor, gitRun, githubFetch and now.
 *   2. `apply(ctx, config)` with a fake ctx, exercised through
 *      `ctx.connection.fetch.register` and the frozen RPC envelope.
 *
 * The workspace path is a real temporary directory because §9.6 states checkout
 * state in filesystem terms; every process and network seam is a fake. No test
 * performs real network I/O or spawns a real subprocess.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, Config, createHandlers, inject } from '../src/index.js';

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
    completedAt: null,
    htmlUrl: 'https://github.com/octo/hello/actions/runs/101',
    workflowUrl: 'https://github.com/octo/hello/blob/main/.github/workflows/ci.yml',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Config and module surface                                           */
/* ------------------------------------------------------------------ */

test('Config exposes the §7 defaults and accepts overrides', () => {
  assert.deepEqual(
    { ...parseConfig({}) },
    {
      clientId: '',
      scopes: 'repo',
      host: 'github.com',
      apiBaseUrl: 'https://api.github.com',
      refreshMs: 3000,
      pollMs: 5000,
      timeoutMs: 10000,
      historyLimit: 20,
      historyRefreshMs: 15000,
    },
  );

  const overridden = parseConfig({ clientId: 'Iv1.host-client', pollMs: 9000, refreshMs: 1000 });

  assert.equal(overridden.clientId, 'Iv1.host-client');
  assert.equal(overridden.pollMs, 9000);
  assert.equal(overridden.refreshMs, 1000);
});

test('the host entry exports inject and a seven-method handler table', () => {
  assert.ok(Array.isArray(inject));
  assert.ok(inject.includes('connection'));

  const handlers = createHandlers(handlerDeps());

  for (const method of METHODS) {
    assert.equal(typeof handlerFor(handlers, method), 'function', method);
  }
});

/* ------------------------------------------------------------------ */
/* status / begin / poll / cancel / signOut                            */
/* ------------------------------------------------------------------ */

test('status reports the signed-out state without a token', async () => {
  const handlers = createHandlers(handlerDeps());
  const status = await invoke(handlers, 'status', {});

  assert.deepEqual(status, {
    signedIn: false,
    login: null,
    scopes: [],
    clientIdConfigured: true,
  });
  assert.equal(Object.hasOwn(status, 'token'), false);
  assert.equal(JSON.stringify(status).includes(SECRET), false);
});

test('status reports the signed-in state from the stored grant without leaking it', async () => {
  const credentials = credentialFixture(grantRecord());
  const handlers = createHandlers(handlerDeps({ credentials }));
  const status = await invoke(handlers, 'status', {});

  assert.deepEqual(status, {
    signedIn: true,
    login: 'octocat',
    scopes: ['repo'],
    clientIdConfigured: true,
  });
  assert.equal(JSON.stringify(status).includes(SECRET), false);
  assert.equal(Object.hasOwn(status, 'token'), false);
});

test('begin refuses to start without a configured client id', async () => {
  const github = githubFixture(() => githubResponse({ body: {} }));
  const handlers = createHandlers(
    handlerDeps({ config: baseConfig({ clientId: '' }), github }),
  );

  const error = await expectError(handlers, 'begin', {}, 'no-client-id');

  assert.equal(github.calls.length, 0);
  assert.equal(JSON.stringify(error.details ?? {}).includes(SECRET), false);
});

test('begin and poll drive the device flow through the injected GitHub fetcher', async (t) => {
  const guard = guardGlobalFetch();
  t.after(guard.restore);

  let clock = 0;
  const responses = [
    githubResponse({
      body: {
        device_code: 'dc-1',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      },
    }),
    githubResponse({ body: { error: 'authorization_pending' } }),
    githubResponse({
      body: { access_token: 'gho_flow_secret', token_type: 'bearer', scope: 'repo' },
    }),
    githubResponse({ body: { login: 'octocat' } }),
  ];
  const github = githubFixture(() => responses.shift());
  const credentials = credentialFixture();
  const handlers = createHandlers(handlerDeps({ credentials, github, now: () => clock }));

  const started = await invoke(handlers, 'begin', {});

  assert.deepEqual(started, {
    deviceCode: 'dc-1',
    userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device',
    expiresIn: 900,
    interval: 5,
  });

  const startCall = github.calls[0];

  assert.equal(startCall.url, 'https://github.com/login/device/code');
  assert.equal(requestMethod(startCall.init), 'POST');
  assert.equal(requestParams(startCall.init).client_id, 'Iv1.host-client');
  assert.equal(requestParams(startCall.init).scope, 'repo');

  // Too early: no second GitHub request, but the poll reports pending.
  assert.deepEqual(await invoke(handlers, 'poll', {}), { state: 'pending', interval: 5 });
  assert.equal(github.calls.length, 1);

  clock = 5000;
  assert.deepEqual(await invoke(handlers, 'poll', {}), { state: 'pending', interval: 5 });
  assert.equal(github.calls.length, 2);

  const pollCall = github.calls[1];

  assert.equal(pollCall.url, 'https://github.com/login/oauth/access_token');
  assert.equal(requestMethod(pollCall.init), 'POST');
  assert.equal(
    requestParams(pollCall.init).grant_type,
    'urn:ietf:params:oauth:grant-type:device_code',
  );
  assert.equal(requestParams(pollCall.init).device_code, 'dc-1');
  assert.match(requestHeaders(pollCall.init).accept ?? '', /application\/json/);

  clock = 10000;
  const authorized = await invoke(handlers, 'poll', {});

  assert.deepEqual(authorized, {
    state: 'authorized',
    auth: {
      signedIn: true,
      login: 'octocat',
      scopes: ['repo'],
      clientIdConfigured: true,
    },
  });
  assert.equal(JSON.stringify(authorized).includes('gho_flow_secret'), false);

  const record = credentials.current;

  assert.equal(record.kind, 'grant');
  assert.equal(record.payload.token, 'gho_flow_secret');
  assert.equal(record.payload.login, 'octocat');
  assert.deepEqual(record.payload.scopes, ['repo']);
  assert.equal(credentials.counts.write + credentials.counts.modify + credentials.counts.clear, 1);

  const userCall = github.calls.find((call) => /\/user$/.test(call.url));

  assert.ok(userCall, 'the login is read from GET /user');
  assert.match(requestHeaders(userCall.init).authorization ?? '', /Bearer gho_flow_secret/);
  assert.equal(JSON.stringify(await invoke(handlers, 'status', {})).includes('gho_flow_secret'), false);
});

test('cancel and signOut return AuthStatus and clear the stored grant', async () => {
  const credentials = credentialFixture(grantRecord());
  const github = githubFixture(() => githubResponse({ body: {} }));
  const handlers = createHandlers(handlerDeps({ credentials, github }));

  const canceled = await invoke(handlers, 'cancel', {});

  assert.equal(typeof canceled.signedIn, 'boolean');

  const signedOut = await invoke(handlers, 'signOut', {});

  assert.deepEqual(signedOut, {
    signedIn: false,
    login: null,
    scopes: [],
    clientIdConfigured: true,
  });
  assert.equal(credentials.current, undefined);
  assert.equal(JSON.stringify(signedOut).includes(SECRET), false);
  assert.equal(JSON.stringify(await invoke(handlers, 'status', {})).includes(SECRET), false);
});

/* ------------------------------------------------------------------ */
/* snapshot                                                            */
/* ------------------------------------------------------------------ */

test('snapshot maps a GitHub checkout and its active runs', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const credentials = credentialFixture(grantRecord());
  const workspaces = workspaceRegistry([workspaceEntity(git.dir)]);
  const github = githubFixture(() =>
    githubResponse({
      body: runsPayload([
        rawRun({
          id: 102,
          name: 'Docs',
          workflow_name: 'Docs',
          status: 'queued',
          event: 'pull_request',
          head_branch: 'docs',
          actor: { login: 'hubot' },
          run_number: 3,
          created_at: '2026-01-02T03:02:00Z',
          run_started_at: null,
          html_url: 'https://github.com/octo/hello/actions/runs/102',
          workflow_id: 56,
          path: '.github/workflows/docs.yml',
        }),
        rawRun(),
        rawRun({
          id: 103,
          name: 'Finished',
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-01-02T03:05:00Z',
          html_url: 'https://github.com/octo/hello/actions/runs/103',
        }),
      ]),
    }),
  );

  const handlers = createHandlers(
    handlerDeps({ credentials, workspaces, github, git, now: () => NOW }),
  );
  const snapshot = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.deepEqual(snapshot.workspace, {
    id: 'ws-1',
    title: 'Project',
    path: git.dir,
  });
  assert.deepEqual(snapshot.repo, {
    host: 'github.com',
    owner: 'octo',
    name: 'hello',
    slug: 'octo/hello',
    webUrl: 'https://github.com/octo/hello',
    defaultBranch: null,
    source: 'remote',
  });
  assert.equal(snapshot.repoStatus, 'ok');
  assert.deepEqual(snapshot.auth, {
    signedIn: true,
    login: 'octocat',
    scopes: ['repo'],
    clientIdConfigured: true,
  });
  assert.match(snapshot.fetchedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  assert.equal(snapshot.stale, false);
  assert.deepEqual(snapshot.runs, [
    mappedRun({
      id: 102,
      name: 'Docs',
      workflowName: 'Docs',
      status: 'queued',
      event: 'pull_request',
      branch: 'docs',
      actor: 'hubot',
      number: 3,
      createdAt: '2026-01-02T03:02:00Z',
      startedAt: null,
      htmlUrl: 'https://github.com/octo/hello/actions/runs/102',
      workflowUrl: 'https://github.com/octo/hello/blob/docs/.github/workflows/docs.yml',
    }),
    mappedRun(),
  ]);
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);

  assert.equal(github.calls.length, 2, 'active read plus history read (§13.3)');

  const call = github.calls.find((entry) =>
    entry.url.includes('/actions/runs?per_page=50'),
  );

  assert.equal(
    call.url,
    'https://api.github.com/repos/octo/hello/actions/runs?per_page=50',
  );
  assert.equal(requestMethod(call.init), 'GET');

  const headers = requestHeaders(call.init);

  assert.equal(headers.authorization, `Bearer ${SECRET}`);
  assert.equal(headers.accept, 'application/vnd.github+json');
  assert.equal(headers['x-github-api-version'], '2022-11-28');
});

test('snapshot reports no-checkout, no-remote, and not-github', async (t) => {
  const cases = [
    {
      name: 'no-checkout',
      options: { checkout: false, remotes: [] },
      expected: 'no-checkout',
    },
    {
      name: 'no-remote',
      options: { checkout: true, remotes: [] },
      expected: 'no-remote',
    },
    {
      name: 'not-github',
      options: {
        checkout: true,
        remotes: [['origin', 'https://gitlab.com/octo/hello.git']],
      },
      expected: 'not-github',
    },
  ];

  for (const entry of cases) {
    const git = await checkoutFixture(entry.options);
    t.after(git.cleanup);

    const credentials = credentialFixture(grantRecord());
    const github = githubFixture(() => githubResponse({ body: runsPayload([]) }));
    const handlers = createHandlers(
      handlerDeps({
        credentials,
        workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
        github,
        git,
      }),
    );
    const snapshot = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

    assert.equal(snapshot.repoStatus, entry.expected, entry.name);
    assert.equal(snapshot.repo, null, entry.name);
    assert.deepEqual(snapshot.runs, [], entry.name);
    assert.equal(snapshot.fetchedAt, null, entry.name);
    assert.equal(snapshot.stale, false, entry.name);
    assert.deepEqual(snapshot.workspace, {
      id: 'ws-1',
      title: 'Project',
      path: git.dir,
    });
    assert.equal(github.calls.length, 0, entry.name);
  }
});

test('snapshot still succeeds for a GitHub repo when signed out', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const credentials = credentialFixture();
  const github = githubFixture(() => githubResponse({ body: runsPayload([]) }));
  const handlers = createHandlers(
    handlerDeps({
      credentials,
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      github,
      git,
    }),
  );
  const snapshot = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(snapshot.repoStatus, 'ok');
  assert.deepEqual(snapshot.auth, {
    signedIn: false,
    login: null,
    scopes: [],
    clientIdConfigured: true,
  });
  assert.deepEqual(snapshot.runs, []);
  assert.equal(snapshot.fetchedAt, null);
  assert.equal(snapshot.stale, false);
  assert.equal(github.calls.length, 0);
});

test('snapshot validates its payload before touching git or GitHub', async (t) => {
  const git = await checkoutFixture({ remotes: [] });
  t.after(git.cleanup);

  const github = githubFixture(() => githubResponse({ body: runsPayload([]) }));
  const handlers = createHandlers(
    handlerDeps({
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      github,
      git,
    }),
  );

  const invalidPayloads = [
    {},
    { workspaceId: 42 },
    { workspaceId: 'ws-1', refresh: 'yes' },
    null,
    [],
  ];

  for (const payload of invalidPayloads) {
    await expectError(handlers, 'snapshot', payload, 'invalid-input');
  }

  assert.equal(git.calls.length, 0, 'payload validation happens first');
  assert.equal(github.calls.length, 0, 'payload validation happens first');
});

test('snapshot reports workspace-missing for an unknown workspace', async () => {
  const github = githubFixture(() => githubResponse({ body: runsPayload([]) }));
  const handlers = createHandlers(
    handlerDeps({
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([]),
      github,
    }),
  );

  await expectError(handlers, 'snapshot', { workspaceId: 'missing' }, 'workspace-missing');
  assert.equal(github.calls.length, 0);
});

test('snapshot caches per repository within refreshMs and refresh bypasses the cache', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  let clock = NOW;
  let activeReads = 0;
  let historyReads = 0;
  let activePayload = runsPayload([rawRun({ id: 101 })]);
  let historyPayload = runsPayload([
    rawRun({ id: 2101, status: 'completed', updated_at: '2026-01-02T04:00:00Z' }),
  ]);
  const github = githubFixture((url) => {
    if (url.includes('status=completed')) {
      historyReads += 1;

      return githubResponse({ body: historyPayload });
    }

    activeReads += 1;

    return githubResponse({ body: activePayload });
  });
  const handlers = createHandlers(
    handlerDeps({
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      github,
      git,
      now: () => clock,
    }),
  );

  const first = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(first.runs[0].id, 101);
  assert.equal(activeReads, 1);
  assert.equal(historyReads, 1, 'the first snapshot reads active runs and history');

  // Inside both TTLs: cached runs, same fetchedAt, no live reads.
  clock += 2000;

  const cached = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.deepEqual(cached.runs, first.runs);
  assert.deepEqual(cached.history, first.history);
  assert.equal(cached.fetchedAt, first.fetchedAt);
  assert.equal(cached.stale, false);
  assert.equal(activeReads, 1);
  assert.equal(historyReads, 1);

  // Past refreshMs but inside historyRefreshMs: a live active read only.
  clock += 1001;
  activePayload = runsPayload([
    rawRun({ id: 201, html_url: 'https://github.com/octo/hello/actions/runs/201' }),
  ]);

  const refreshed = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(refreshed.runs[0].id, 201);
  assert.equal(activeReads, 2);
  assert.equal(historyReads, 1, 'history is cached independently of refreshMs');
  assert.deepEqual(refreshed.history, first.history);

  // refresh:true bypasses both warm caches.
  clock += 10;
  activePayload = runsPayload([
    rawRun({ id: 301, html_url: 'https://github.com/octo/hello/actions/runs/301' }),
  ]);
  historyPayload = runsPayload([
    rawRun({ id: 2102, status: 'completed', updated_at: '2026-01-02T05:00:00Z' }),
  ]);

  const bypassed = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1', refresh: true });

  assert.equal(bypassed.runs[0].id, 301);
  assert.equal(bypassed.history[0].id, 2102);
  assert.equal(activeReads, 3);
  assert.equal(historyReads, 2, 'refresh bypasses the history cache too');

  // And the bypassed reads become the new cache.
  const reused = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  assert.equal(reused.runs[0].id, 301);
  assert.equal(reused.history[0].id, 2102);
  assert.equal(activeReads, 3);
  assert.equal(historyReads, 2);
});

test('snapshot serves a stale cached list with a warning when the live read fails', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  let clock = NOW;
  let fail = false;
  const github = githubFixture(() => {
    if (fail) return new Error('getaddrinfo ENOTFOUND api.github.com');

    return githubResponse({ body: runsPayload([rawRun({ id: 101 })]) });
  });
  const handlers = createHandlers(
    handlerDeps({
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      github,
      git,
      now: () => clock,
    }),
  );

  const first = await invoke(handlers, 'snapshot', { workspaceId: 'ws-1' });

  clock += 3001;
  fail = true;

  const raw = await invokeRaw(handlers, 'snapshot', { workspaceId: 'ws-1' });
  const snapshot = unwrap(raw);

  assert.equal(snapshot.stale, true);
  assert.deepEqual(snapshot.runs, first.runs);
  assert.equal(snapshot.fetchedAt, first.fetchedAt);
  assert.equal(
    JSON.stringify(snapshot).includes(SECRET),
    false,
    'a cached list never carries the token',
  );

  const warning = warningOf(raw);

  assert.equal(typeof warning, 'string', '§4 requires details.warning on the successful stale response');
  assert.ok(warning.length > 0);
});

test('a GitHub 401 deletes the credential and returns auth-required', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const credentials = credentialFixture(grantRecord());
  const github = githubFixture(() =>
    githubResponse({ status: 401, body: { message: 'Bad credentials' } }),
  );
  const handlers = createHandlers(
    handlerDeps({
      credentials,
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      github,
      git,
    }),
  );

  const error = await expectError(handlers, 'snapshot', { workspaceId: 'ws-1' }, 'auth-required');

  assert.equal(JSON.stringify(error.details ?? {}).includes(SECRET), false);
  assert.equal(credentials.current, undefined, 'the stored credential was deleted');

  const status = await invoke(handlers, 'status', {});

  assert.deepEqual(status, {
    signedIn: false,
    login: null,
    scopes: [],
    clientIdConfigured: true,
  });
});

test('snapshot maps GitHub rate limits with reset details', async (t) => {
  const cases = [
    {
      name: '403 with reset',
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
      reset: 1767225600,
    },
    {
      name: '429 with reset',
      status: 429,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
      reset: 1767225600,
    },
    {
      name: '403 without reset',
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      reset: undefined,
    },
  ];

  for (const entry of cases) {
    const git = await checkoutFixture({
      remotes: [['origin', 'https://github.com/octo/hello.git']],
    });
    t.after(git.cleanup);

    const github = githubFixture(() =>
      githubResponse({
        status: entry.status,
        headers: entry.headers,
        body: { message: 'API rate limit exceeded' },
      }),
    );
    const handlers = createHandlers(
      handlerDeps({
        credentials: credentialFixture(grantRecord()),
        workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
        github,
        git,
      }),
    );

    const error = await expectError(handlers, 'snapshot', { workspaceId: 'ws-1' }, 'rate-limited');

    if (entry.reset === undefined) {
      assert.ok(!error.details.reset, `${entry.name}: no invented reset`);
    } else {
      assert.equal(Number(error.details.reset), entry.reset, entry.name);
    }
  }
});

test('snapshot maps a network failure to github-unreachable', async (t) => {
  const git = await checkoutFixture({
    remotes: [['origin', 'https://github.com/octo/hello.git']],
  });
  t.after(git.cleanup);

  const github = githubFixture(() => new Error('socket hang up'));
  const handlers = createHandlers(
    handlerDeps({
      credentials: credentialFixture(grantRecord()),
      workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
      github,
      git,
    }),
  );

  await expectError(handlers, 'snapshot', { workspaceId: 'ws-1' }, 'github-unreachable');
});

/* ------------------------------------------------------------------ */
/* setClientId                                                         */
/* ------------------------------------------------------------------ */

test('setClientId persists the complete row config through the config editor', async () => {
  const editor = editorFixture({ clientId: '', scopes: 'repo', host: 'github.com' });
  const handlers = createHandlers(
    handlerDeps({ config: baseConfig({ clientId: '' }), editor }),
  );

  const value = await invoke(handlers, 'setClientId', { clientId: 'Iv1.saved-client' });

  assert.deepEqual(value, {
    signedIn: false,
    login: null,
    scopes: [],
    clientIdConfigured: true,
  });
  assert.equal(editor.edits.length, 1);
  assert.equal(editor.entry.options.config.clientId, 'Iv1.saved-client');
  assert.equal(editor.entry.options.config.scopes, 'repo');
  assert.equal(editor.entry.options.config.host, 'github.com');

  // The in-memory value changed too: no restart is needed before signing in.
  const status = await invoke(handlers, 'status', {});

  assert.equal(status.clientIdConfigured, true);
  assert.equal(JSON.stringify(status).includes(SECRET), false);
});

test('setClientId validates the GitHub client-id shape', async () => {
  const editor = editorFixture({ clientId: '' });
  const handlers = createHandlers(handlerDeps({ config: baseConfig({ clientId: '' }), editor }));
  const invalid = ['', 'short', 'has space', 'bad!', 'a'.repeat(65), 42, null, undefined, {}];

  for (const clientId of invalid) {
    await expectError(handlers, 'setClientId', { clientId }, 'invalid-input');
  }

  assert.equal(editor.edits.length, 0, 'invalid values are never persisted');

  for (const clientId of ['abcdef', 'A.b_c-d1', 'a'.repeat(64)]) {
    const value = await invoke(handlers, 'setClientId', { clientId });

    assert.equal(value.clientIdConfigured, true, clientId);
  }
});

test('setClientId reports config-unavailable without a config editor', async () => {
  const handlers = createHandlers(
    handlerDeps({ config: baseConfig({ clientId: '' }), editor: undefined }),
  );

  await expectError(handlers, 'setClientId', { clientId: 'abcdef' }, 'config-unavailable');
});

/* ------------------------------------------------------------------ */
/* Transport: registered routes and the frozen envelope                */
/* ------------------------------------------------------------------ */

function guardGlobalFetch() {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new Error('this contract test must not reach the real network');
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function makeCtx({ credentials = credentialFixture(), workspaces = workspaceRegistry([]), editor } = {}) {
  const routes = new Map();
  const disposers = [];

  const ctx = {
    connection: {
      fetch: {
        register: (route) => {
          routes.set(route.path, route);

          return () => routes.delete(route.path);
        },
      },
    },
    credentials,
    workspaceRegistry: workspaces,
    get: (name) => {
      if (name === 'configEditor') return editor;
      if (name === 'workspaceRegistry') return workspaces;
      if (name === 'credentials') return credentials;
      if (name === 'connection') return ctx.connection;

      return undefined;
    },
    effect: (fn) => {
      const cleanup = fn();

      if (typeof cleanup === 'function') disposers.push(cleanup);

      return cleanup ?? (() => {});
    },
    inject: (_names, fn) => fn({}),
    on: () => () => {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    session: undefined,
  };

  return { ctx, routes, disposers };
}

function rpcRequest(route, { payload = {}, rpcId = 'rpc-1', method, body } = {}) {
  const data =
    body !== undefined
      ? body
      : JSON.stringify({
          type: 'client-request',
          rpcId,
          method: method ?? route.path.slice('/api/'.length),
          payload,
        });

  return new Request(`http://localhost${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: data,
  });
}

async function rpcCall(route, options) {
  const response = await route.fetch(rpcRequest(route, options));

  return { response, json: await response.json() };
}

test('apply registers exactly the seven documented host routes', async (t) => {
  const guard = guardGlobalFetch();
  t.after(guard.restore);

  const editor = editorFixture({ clientId: '', scopes: 'repo' });
  const { ctx, routes } = makeCtx({ editor });

  await apply(ctx, baseConfig({ clientId: '' }));

  assert.equal(routes.size, 7);

  for (const method of METHODS) {
    const route = routes.get(`${ROUTE_PREFIX}${method}`);

    assert.ok(route, `missing route ${ROUTE_PREFIX}${method}`);
    assert.equal(route.path, `${ROUTE_PREFIX}${method}`);
    assert.deepEqual(route.methods, ['POST']);
    assert.equal(route.requestBody, 'buffered');
    assert.equal(typeof route.fetch, 'function');
  }

  // With no configured client id the begin route fails before any network I/O.
  const begin = await rpcCall(routes.get(`${ROUTE_PREFIX}begin`), { payload: {} });

  assert.equal(begin.json.result.ok, false);
  assert.equal(begin.json.result.error.code, 'no-client-id');
});

test('RPC routes reject malformed envelopes with HTTP 400 text', async (t) => {
  const guard = guardGlobalFetch();
  t.after(guard.restore);

  const editor = editorFixture({ clientId: '', scopes: 'repo' });
  const { ctx, routes } = makeCtx({ editor });

  await apply(ctx, baseConfig({ clientId: '' }));

  const malformedBodies = [
    'not json',
    JSON.stringify({
      type: 'server-response',
      rpcId: 'r1',
      method: 'githubActions.status',
      payload: {},
    }),
    JSON.stringify({ type: 'client-request', rpcId: 'r1', payload: {} }),
    JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'githubActions.status' }),
    JSON.stringify({ type: 'client-request', method: 'githubActions.status', payload: {} }),
  ];

  for (const body of malformedBodies) {
    for (const method of METHODS) {
      const route = routes.get(`${ROUTE_PREFIX}${method}`);
      const response = await route.fetch(rpcRequest(route, { body }));

      assert.equal(response.status, 400, `${method}: ${body}`);
      const text = await response.text();

      assert.ok(text.length > 0);
      assert.ok(text.length < 400, 'a short text body');
      assert.equal(text.includes(SECRET), false);
    }
  }

  // A mismatched method on an otherwise valid envelope is also malformed.
  const statusRoute = routes.get(`${ROUTE_PREFIX}status`);
  const mismatched = rpcRequest(statusRoute, {
    method: 'githubActions.snapshot',
    payload: {},
  });
  const mismatchedResponse = await statusRoute.fetch(mismatched);

  assert.equal(mismatchedResponse.status, 400);
});

test('RPC routes expose the documented result shapes without the token', async (t) => {
  const guard = guardGlobalFetch();
  t.after(guard.restore);

  const credentials = credentialFixture(grantRecord());
  const editor = editorFixture({ clientId: 'Iv1.host-client', scopes: 'repo' });
  const { ctx, routes } = makeCtx({ credentials, editor });

  await apply(ctx, baseConfig());

  const statusRoute = routes.get(`${ROUTE_PREFIX}status`);
  const snapshotRoute = routes.get(`${ROUTE_PREFIX}snapshot`);
  const signOutRoute = routes.get(`${ROUTE_PREFIX}signOut`);

  const success = await rpcCall(statusRoute, { rpcId: 'rpc-status', payload: {} });

  assert.equal(success.response.status, 200);
  assert.equal(success.json.type, 'server-response');
  assert.equal(success.json.rpcId, 'rpc-status');
  assert.deepEqual(success.json.result, {
    ok: true,
    value: {
      signedIn: true,
      login: 'octocat',
      scopes: ['repo'],
      clientIdConfigured: true,
    },
  });
  assert.equal(JSON.stringify(success.json).includes(SECRET), false);

  const invalidStatus = await rpcCall(statusRoute, { payload: null });

  assert.equal(invalidStatus.json.result.ok, false);
  assert.equal(invalidStatus.json.result.error.code, 'invalid-input');
  assert.equal(typeof invalidStatus.json.result.error.message, 'string');
  assert.equal(typeof invalidStatus.json.result.error.details, 'object');
  assert.equal(JSON.stringify(invalidStatus.json).includes(SECRET), false);

  const invalidSnapshot = await rpcCall(snapshotRoute, { payload: {} });

  assert.equal(invalidSnapshot.response.status, 200);
  assert.equal(invalidSnapshot.json.result.ok, false);
  assert.equal(invalidSnapshot.json.result.error.code, 'invalid-input');

  const signedOut = await rpcCall(signOutRoute, { payload: {} });

  assert.equal(signedOut.json.result.ok, true);
  assert.equal(signedOut.json.result.value.signedIn, false);
  assert.equal(JSON.stringify(signedOut.json).includes(SECRET), false);
  assert.equal(credentials.current, undefined);
});
