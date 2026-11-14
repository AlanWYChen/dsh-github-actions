/**
 * Client contract for src/client.js — REQUIREMENTS.md §5 and docs/ARCHITECTURE.md
 * "src/client.js — browser half".
 *
 * The real file is loaded in a `vm` context through the Harness module-loader
 * contract (window.__ModuleLoader__.load). React is a small deterministic stub
 * that records state, effects and cleanups; timers, visibility, and window.open
 * are fakes. No network, no real DOM.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const CLIENT_URL = new URL('../src/client.js', import.meta.url);
const NAMESPACE = 'github-actions';

/* ------------------------------------------------------------------ */
/* Tree helpers                                                        */
/* ------------------------------------------------------------------ */

function visit(node, predicate, result = []) {
  if (node === null || node === undefined) return result;

  if (Array.isArray(node)) {
    for (const child of node) visit(child, predicate, result);

    return result;
  }

  if (typeof node !== 'object') return result;

  if (predicate(node)) result.push(node);

  if (node.children !== undefined) visit(node.children, predicate, result);

  return result;
}

function text(node) {
  if (node === null || node === undefined || node === true || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'object') return text(node.children);

  return '';
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const flushMicrotasks = async (times = 2) => {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/* ------------------------------------------------------------------ */
/* Requirement fixtures                                                */
/* ------------------------------------------------------------------ */

function auth(overrides = {}) {
  return {
    signedIn: true,
    login: 'octocat',
    scopes: ['repo'],
    clientIdConfigured: true,
    ...overrides,
  };
}

function repo(overrides = {}) {
  return {
    host: 'github.com',
    owner: 'octo',
    name: 'hello',
    slug: 'octo/hello',
    webUrl: 'https://github.com/octo/hello',
    defaultBranch: null,
    source: 'remote',
    ...overrides,
  };
}

function run(overrides = {}) {
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

function snapshot(overrides = {}) {
  return {
    workspace: { id: 'ws-1', title: 'Project', path: '/repo' },
    repo: repo(),
    repoStatus: 'ok',
    auth: auth(),
    runs: [
      run(),
      run({
        id: 102,
        name: 'Docs preview',
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
    ],
    fetchedAt: '2026-01-02T03:04:05.000Z',
    stale: false,
    ...overrides,
  };
}

function setupSnapshot(overrides = {}) {
  return snapshot({
    auth: auth({ signedIn: false, login: null, scopes: [], clientIdConfigured: false }),
    runs: [],
    fetchedAt: null,
    ...overrides,
  });
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

function createRenderer(React, state) {
  const instances = new Map();
  let currentInstance = null;
  let dirty = false;
  let page = null;
  let tree = null;

  const instanceFor = (key) => {
    let instance = instances.get(key);

    if (instance === undefined) {
      instance = {
        key,
        states: [],
        refs: [],
        effects: [],
        memos: [],
        reductions: [],
        pending: [],
        stateIndex: 0,
        refIndex: 0,
        effectIndex: 0,
        memoIndex: 0,
        reductionIndex: 0,
        mounted: false,
      };
      instances.set(key, instance);
    }

    return instance;
  };

  const markDirty = () => {
    dirty = true;
  };

  const renderComponent = (Component, props, key) => {
    const instance = instanceFor(key);

    instance.stateIndex = 0;
    instance.refIndex = 0;
    instance.effectIndex = 0;
    instance.memoIndex = 0;
    instance.reductionIndex = 0;
    instance.pending = [];

    const previous = currentInstance;

    currentInstance = instance;

    let output;

    try {
      output = Component(props);
    } finally {
      currentInstance = previous;
    }

    const pending = instance.pending;

    instance.pending = [];

    for (const commit of pending) commit();

    instance.mounted = true;

    return output;
  };

  const expand = (node, key) => {
    if (node === null || node === undefined || typeof node !== 'object') return node;
    if (Array.isArray(node)) {
      return node.map((child, index) => expand(child, `${key}.${index}`));
    }
    if (typeof node.type === 'function') {
      const childTree = renderComponent(node.type, node.props, key);

      return expand(childTree, `${key}>`);
    }
    if (node.children !== undefined) {
      return {
        ...node,
        children: expand(node.children, `${key}.children`),
      };
    }

    return node;
  };

  const renderRoot = () => {
    dirty = false;
    tree = expand(renderComponent(page.type, page.props, 'page'), 'page>');

    return tree;
  };

  const settle = async (limit = 100) => {
    for (let attempt = 0; attempt < limit; attempt += 1) {
      await flushMicrotasks(4);
      if (!dirty) {
        await flushMicrotasks(4);
        if (!dirty) return tree;
      }
      renderRoot();
    }

    throw new Error('client page did not settle (state updates kept re-rendering)');
  };

  const mount = async (Component, props) => {
    page = { type: Component, props };
    renderRoot();
    await settle();

    return tree;
  };

  const unmount = () => {
    for (const instance of instances.values()) {
      for (const effect of instance.effects) {
        try {
          effect?.cleanup?.();
        } catch {
          /* a cleanup failure must not hide the assertions that follow */
        }
      }
      instance.effects = [];
      instance.mounted = false;
    }
    for (const cleanup of state.pluginCleanups) {
      try {
        cleanup?.();
      } catch {
        /* ignore */
      }
    }
    state.pluginCleanups = [];
  };

  const renderIsolated = (Component, props = {}) =>
    expand(renderComponent(Component, props, 'isolated'), 'isolated>');

  return {
    markDirty,
    settle,
    mount,
    unmount,
    renderIsolated,
    get tree() {
      return tree;
    },
    get dirty() {
      return dirty;
    },
    get currentInstance() {
      return currentInstance;
    },
    set currentInstance(value) {
      currentInstance = value;
    },
    instanceFor,
  };
}

async function createHarness(options = {}) {
  const localeName = options.locale ?? 'en';
  const state = {
    definitions: [],
    dictionaries: undefined,
    localeNamespaces: [],
    bindNamespaces: [],
    registrations: [],
    calls: [],
    requires: [],
    opens: [],
    pluginCleanups: [],
    visibility: 'visible',
    timers: new Map(),
    timerSeq: 0,
    time: 0,
    idSeq: 0,
  };

  let definition;
  let module;

  /* ---------------- timers ---------------- */
  const addTimer = (fn, ms = 0, repeat = false) => {
    const id = ++state.timerSeq;
    const delay = Math.max(0, Number(ms) || 0);

    state.timers.set(id, { fn, delay, due: state.time + delay, repeat });

    return id;
  };
  const timers = {
    setTimeout: (fn, ms) => addTimer(fn, ms, false),
    clearTimeout: (id) => state.timers.delete(id),
    setInterval: (fn, ms) => addTimer(fn, ms, true),
    clearInterval: (id) => state.timers.delete(id),
  };

  /* ---------------- visibility / document ---------------- */
  const documentListeners = new Map();
  const windowListeners = new Map();
  const listen = (map) => (type, fn) => {
    const set = map.get(type) ?? new Set();

    set.add(fn);
    map.set(type, set);
  };
  const unlisten = (map) => (type, fn) => {
    map.get(type)?.delete(fn);
  };

  const documentStub = {
    get visibilityState() {
      return state.visibility;
    },
    get hidden() {
      return state.visibility === 'hidden';
    },
    addEventListener: listen(documentListeners),
    removeEventListener: unlisten(documentListeners),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tagName) => ({
      tagName: String(tagName).toUpperCase(),
      style: {},
      setAttribute() {},
      appendChild() {},
      addEventListener() {},
      removeEventListener() {},
      click() {},
    }),
    body: { appendChild() {}, removeChild() {} },
  };

  const windowStub = {
    document: documentStub,
    location: { assign: (url) => state.opens.push([url]), href: 'http://localhost/' },
    open: (...args) => {
      state.opens.push(args);

      return { focus() {}, closed: false };
    },
    addEventListener: listen(windowListeners),
    removeEventListener: unlisten(windowListeners),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => addTimer(fn, 16, false),
    cancelAnimationFrame: (id) => state.timers.delete(id),
    get localStorage() {
      return {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      };
    },
    history: { replaceState() {}, pushState() {} },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  };

  windowStub.window = windowStub;

  /* ---------------- React stub ---------------- */
  const React = {
    createElement(type, props, ...children) {
      const normalized =
        children.length === 0 ? undefined : children.length === 1 ? children[0] : children;

      return {
        type,
        props: {
          ...(props ?? {}),
          ...(normalized === undefined ? {} : { children: normalized }),
        },
        children,
      };
    },
    Fragment: 'fragment',
    useState(initial) {
      const instance = renderer.currentInstance;

      assert.ok(instance, 'useState used outside a component render');

      const index = instance.stateIndex++;
      const values = instance.states;

      if (!(index in values)) {
        values[index] = typeof initial === 'function' ? initial() : initial;
      }
      const set = (next) => {
        const value = typeof next === 'function' ? next(values[index]) : next;

        if (!Object.is(value, values[index])) {
          values[index] = value;
          renderer.markDirty();
        }
      };

      return [values[index], set];
    },
    useRef(initial) {
      const instance = renderer.currentInstance;

      assert.ok(instance, 'useRef used outside a component render');

      const index = instance.refIndex++;

      if (!(index in instance.refs)) instance.refs[index] = { current: initial };

      return instance.refs[index];
    },
    useEffect(fn, deps) {
      const instance = renderer.currentInstance;

      assert.ok(instance, 'useEffect used outside a component render');

      const index = instance.effectIndex++;
      const slot = (instance.effects[index] ??= { deps: undefined, cleanup: undefined });
      const changed =
        slot.deps === undefined ||
        deps === undefined ||
        deps.length !== slot.deps.length ||
        deps.some((value, position) => !Object.is(value, slot.deps[position]));

      if (changed) {
        instance.pending.push(() => {
          slot.cleanup?.();
          slot.deps = deps;
          slot.cleanup = fn();
        });
      }
    },
    useLayoutEffect(fn, deps) {
      React.useEffect(fn, deps);
    },
    useMemo(factory, deps) {
      const instance = renderer.currentInstance;
      const index = instance.memoIndex++;
      const slot = instance.memos[index];
      const changed =
        slot === undefined ||
        deps === undefined ||
        deps.length !== slot.deps.length ||
        deps.some((value, position) => !Object.is(value, slot.deps[position]));

      if (changed) instance.memos[index] = { deps, value: factory() };

      return instance.memos[index].value;
    },
    useCallback(fn, deps) {
      return React.useMemo(() => fn, deps);
    },
    useReducer(reducer, initialArg, init) {
      const instance = renderer.currentInstance;
      const index = instance.reductionIndex++;

      if (!(index in instance.reductions)) {
        instance.reductions[index] =
          typeof init === 'function' ? init(initialArg) : initialArg;
      }
      const dispatch = (action) => {
        const next = reducer(instance.reductions[index], action);

        if (!Object.is(next, instance.reductions[index])) {
          instance.reductions[index] = next;
          renderer.markDirty();
        }
      };

      return [instance.reductions[index], dispatch];
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
    useContext() {
      return {};
    },
    useId() {
      return `id-${++state.idSeq}`;
    },
    memo(component) {
      return component;
    },
    forwardRef(component) {
      return component;
    },
    createContext(defaultValue) {
      return { _currentValue: defaultValue, Provider: 'provider', Consumer: 'consumer' };
    },
    Children: {
      map(children, fn) {
        if (children === undefined || children === null) return [];

        return (Array.isArray(children) ? children : [children]).map(fn);
      },
      forEach(children, fn) {
        React.Children.map(children, fn);
      },
      count(children) {
        if (children === undefined || children === null) return 0;

        return Array.isArray(children) ? children.length : 1;
      },
      toArray(children) {
        if (children === undefined || children === null) return [];

        return Array.isArray(children) ? children : [children];
      },
      only(children) {
        return children;
      },
    },
    cloneElement(element, props, ...children) {
      return {
        ...element,
        props: {
          ...element.props,
          ...(props ?? {}),
          ...(children.length === 0
            ? {}
            : { children: children.length === 1 ? children[0] : children }),
        },
      };
    },
    isValidElement(value) {
      return Boolean(value && typeof value === 'object' && 'type' in value && 'props' in value);
    },
  };

  const renderer = createRenderer(React, state);

  /* ---------------- locale ---------------- */
  const bind = (namespace) => {
    if (namespace !== undefined) state.bindNamespaces.push(namespace);

    return (key, params) => {
      const table = state.dictionaries?.[localeName] ?? {};
      const value = table[key];

      if (value === undefined) return key;
      if (!params) return value;

      return String(value).replace(/\{(\w+)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]),
      );
    };
  };

  /* ---------------- rpc ---------------- */
  let configured = options.status?.clientIdConfigured ?? true;
  const statusValue = () => ({
    ...(options.status ?? auth()),
    clientIdConfigured: configured,
  });
  const snapshotValue = () => structuredClone(options.snapshot ?? snapshot());

  const defaultRpc = async (channel, method, _payload) => {
    assert.equal(channel, '/api', 'all client traffic uses the authenticated /api bridge');

    switch (method) {
      case 'githubActions.status':
        return { ok: true, value: statusValue() };
      case 'githubActions.snapshot':
        return { ok: true, value: snapshotValue() };
      case 'githubActions.setClientId':
        configured = true;

        return { ok: true, value: statusValue() };
      case 'githubActions.begin':
        return {
          ok: true,
          value: {
            deviceCode: 'dc-1',
            userCode: 'ABCD-1234',
            verificationUri: 'https://github.com/login/device',
            expiresIn: 900,
            interval: 5,
          },
        };
      case 'githubActions.poll':
        return { ok: true, value: { state: 'pending', interval: 5 } };
      case 'githubActions.cancel':
      case 'githubActions.signOut':
        return { ok: true, value: statusValue() };
      default:
        throw new Error(`unexpected RPC method ${method}`);
    }
  };

  const rpc = options.rpc ?? defaultRpc;

  /* ---------------- client context ---------------- */
  const workspaceItems = options.workspaces ?? [
    { workspaceId: 'ws-1', title: 'Project', path: '/repo', sessionIds: [] },
  ];
  const workspaceSnapshot = {
    items: workspaceItems,
    archivedSessionIds: [],
    pinnedSessionIds: [],
  };

  const ctx = {
    effect: (fn) => {
      const cleanup = fn();

      if (typeof cleanup === 'function') state.pluginCleanups.push(cleanup);

      return cleanup ?? (() => {});
    },
    locale: {
      register: (namespace, dictionaries) => {
        state.localeNamespaces.push(namespace);
        state.dictionaries = dictionaries;

        return () => {};
      },
      bind,
    },
    slots: {
      inject: (name, factory) => {
        const result = factory();

        if (result && typeof result.next === 'function') {
          for (const _value of result) {
            /* the registration happens inside the generator */
          }
        }

        return result;
      },
      register: (options_, Component) => {
        state.registrations.push({ options: options_, Component });

        return () => {};
      },
      provideRoot: () => () => {},
      entries: () => [],
      entriesOfSlot: () => [],
      subscribe: () => () => {},
    },
    connection: {
      rpc: {
        call: (...args) => {
          state.calls.push(args);

          return rpc(...args);
        },
      },
    },
    sessions: {},
    workspaces: {
      list: {
        getSnapshot: () => workspaceSnapshot,
        subscribe: () => () => {},
      },
    },
    get: (name) => {
      if (name === 'workspaces') return ctx.workspaces;
      if (name === 'sessions') return ctx.sessions;
      if (name === 'connection') return ctx.connection;
      if (name === 'locale') return ctx.locale;
      if (name === 'slots') return ctx.slots;

      return undefined;
    },
    on: () => () => {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  /* ---------------- load the browser half ---------------- */
  const source = readFileSync(CLIENT_URL, 'utf8');
  const sandbox = {
    window: windowStub,
    document: documentStub,
    ...timers,
    AbortController,
    URL,
    URLSearchParams,
    structuredClone,
    console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
    queueMicrotask: (fn) => queueMicrotask(fn),
    // Browser globals: bare open()/location/history/localStorage resolve on the
    // page's global object, exactly as in the Web shell.
    open: windowStub.open,
    location: windowStub.location,
    history: windowStub.history,
    localStorage: windowStub.localStorage,
    matchMedia: windowStub.matchMedia,
    requestAnimationFrame: windowStub.requestAnimationFrame,
    cancelAnimationFrame: windowStub.cancelAnimationFrame,
    navigator: { userAgent: 'dsh-test', clipboard: {} },
  };

  windowStub.__ModuleLoader__ = {
    load: (value) => {
      state.definitions.push(value);
      definition = value;
    },
  };

  vm.runInNewContext(source, sandbox, { filename: 'src/client.js' });

  if (definition === undefined) {
    throw new Error('src/client.js must call window.__ModuleLoader__.load({ id, factory })');
  }
  if (typeof definition.factory !== 'function') {
    throw new Error('the module-loader definition must expose factory(require)');
  }

  module = definition.factory((name) => {
    state.requires.push(name);

    if (name === 'react') return React;

    throw new Error(`src/client.js may require('react') only; it required ${JSON.stringify(name)}`);
  });

  if (module === undefined || module === null) {
    throw new Error('the client factory must return the plugin module');
  }
  if (typeof module.apply !== 'function') {
    throw new Error('the client module must export apply(ctx, config)');
  }

  const config = {
    clientId: '',
    scopes: 'repo',
    host: 'github.com',
    apiBaseUrl: 'https://api.github.com',
    refreshMs: 3000,
    pollMs: 5000,
    timeoutMs: 10000,
    ...(options.config ?? {}),
  };

  await module.apply(ctx, config);

  if (state.dictionaries === undefined) {
    throw new Error('apply(ctx) must register the github-actions locale dictionaries');
  }

  /* ---------------- page wiring ---------------- */
  const findRegistration = (predicate, description) => {
    const found = state.registrations.find(({ options: registrationOptions }) =>
      predicate(registrationOptions),
    );

    assert.ok(found, `apply(ctx) must register ${description}`);

    return found;
  };

  const mainRegistration = () =>
    findRegistration(
      (registrationOptions) =>
        registrationOptions.name === 'main' && registrationOptions.key === NAMESPACE,
      `main with key ${NAMESPACE}`,
    );

  const pageProps = () => {
    const main = mainRegistration();
    const injected =
      typeof main.options.inject === 'function' ? (main.options.inject() ?? {}) : {};

    return {
      ...injected,
      t: bind(main.options.locale ?? NAMESPACE),
      workspaceId: workspaceItems[0]?.workspaceId,
      workspaces: workspaceItems,
      useWorkspaces: (selector = (value) => value) => selector(workspaceSnapshot),
      useSessions: (selector = (value) => value) =>
        selector({ ids: [], byId: {}, projectionsBySession: {} }),
      usePanelInfo: (selector = (value) => value) =>
        selector({ activePanelId: NAMESPACE, visible: true }),
      useWorkspaceAccess: () => ({ access: 'ok' }),
    };
  };

  const mountPage = async (overrides = {}) => {
    const main = mainRegistration();

    return await renderer.mount(main.Component, { ...pageProps(), ...overrides });
  };

  const countCalls = (method) =>
    state.calls.filter((call) => call[1] === method).length;

  const advance = async (ms) => {
    const target = state.time + ms;

    for (let guard = 0; guard < 2000; guard += 1) {
      let nextId;
      let nextTimer;

      for (const [id, timer] of state.timers) {
        if (timer.due > target) continue;
        if (
          nextTimer === undefined ||
          timer.due < nextTimer.due ||
          (timer.due === nextTimer.due && id < nextId)
        ) {
          nextId = id;
          nextTimer = timer;
        }
      }

      if (nextTimer === undefined) break;

      state.time = nextTimer.due;

      if (nextTimer.repeat) nextTimer.due = state.time + nextTimer.delay;
      else state.timers.delete(nextId);

      nextTimer.fn();
      await renderer.settle();
    }

    state.time = target;
    await renderer.settle();
  };

  const setVisibility = async (visibility) => {
    state.visibility = visibility;

    const event = { type: 'visibilitychange', target: documentStub };

    for (const map of [documentListeners, windowListeners]) {
      for (const fn of [...(map.get('visibilitychange') ?? [])]) fn(event);
    }

    await renderer.settle();
  };

  return {
    definition,
    module,
    ctx,
    state,
    renderer,
    timers,
    mountPage,
    renderIsolated: renderer.renderIsolated,
    settle: renderer.settle,
    advance,
    setVisibility,
    unmount: renderer.unmount,
    countCalls,
    tree: () => renderer.tree,
    registrations: state.registrations,
    get dictionaries() {
      return state.dictionaries;
    },
    get localeNamespaces() {
      return state.localeNamespaces;
    },
    get bindNamespaces() {
      return state.bindNamespaces;
    },
    get requires() {
      return state.requires;
    },
    get calls() {
      return state.calls;
    },
    get opens() {
      return state.opens;
    },
    findRegistration,
    mainRegistration,
    pageProps,
  };
}

/* ------------------------------------------------------------------ */
/* Row/setup helpers                                                   */
/* ------------------------------------------------------------------ */

function findRow(tree, forRun) {
  const candidates = visit(
    tree,
    (node) =>
      node.props?.role === 'listitem' ||
      node.props?.role === 'option' ||
      node.props?.role === 'row' ||
      node.props?.['data-gha-run-id'] !== undefined,
  );
  const named = candidates.filter((node) => text(node).includes(forRun.name));

  if (named.length > 0) return named[0];

  const clickable = visit(
    tree,
    (node) =>
      (typeof node.props?.onClick === 'function' ||
        typeof node.props?.onKeyDown === 'function' ||
        node.type === 'a') &&
      text(node).includes(forRun.name),
  );

  return clickable[0];
}

function clickableIn(row) {
  if (typeof row.props?.onClick === 'function') return row;

  return visit(row, (node) => typeof node.props?.onClick === 'function')[0];
}

function keyboardIn(row) {
  if (typeof row.props?.onKeyDown === 'function') return row;

  return visit(row, (node) => typeof node.props?.onKeyDown === 'function')[0];
}

function anchorIn(row) {
  return visit(
    row,
    (node) => node.type === 'a' && typeof node.props?.href === 'string',
  )[0];
}

function eventStub(overrides = {}) {
  return {
    preventDefault() {},
    stopPropagation() {},
    currentTarget: {},
    target: {},
    ...overrides,
  };
}

function findSaveControl(tree) {
  const form = visit(
    tree,
    (node) => node.type === 'form' && typeof node.props?.onSubmit === 'function',
  )[0];

  if (form) return { kind: 'form', node: form };

  const controls = visit(
    tree,
    (node) =>
      (node.type === 'button' || node.type === 'input') &&
      (typeof node.props?.onClick === 'function' || node.props?.type === 'submit'),
  );
  const byText = controls.find((node) => /save/i.test(text(node)));

  if (byText && typeof byText.props.onClick === 'function') {
    return { kind: 'button', node: byText };
  }

  const clickable = controls.find((node) => typeof node.props?.onClick === 'function');

  if (clickable) return { kind: 'button', node: clickable };

  return undefined;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('the browser half loads through the Harness module-loader contract and requires only react', async () => {
  const harness = await createHarness();

  assert.match(String(harness.definition.id), /github-actions/);
  assert.equal(typeof harness.definition.factory, 'function');
  assert.equal(typeof harness.module.apply, 'function');
  assert.ok(
    harness.module.inject === undefined ||
      Array.isArray(harness.module.inject) ||
      typeof harness.module.inject === 'object',
  );
  assert.deepEqual([...new Set(harness.requires)], ['react']);
});

test('apply registers the github-actions locale and both required slots', async () => {
  const harness = await createHarness();

  assert.ok(harness.localeNamespaces.includes(NAMESPACE), 'locale namespace github-actions is registered');
  assert.ok(harness.bindNamespaces.includes(NAMESPACE), 'visible text is bound through ctx.locale.bind');

  const dictionaries = harness.dictionaries;

  assert.equal(typeof dictionaries.en, 'object');
  assert.equal(typeof dictionaries.zh, 'object');

  const enKeys = Object.keys(dictionaries.en).sort();
  const zhKeys = Object.keys(dictionaries.zh).sort();

  assert.deepEqual(zhKeys, enKeys, 'both dictionaries cover the same keys');

  for (const key of enKeys) {
    assert.equal(typeof dictionaries.en[key], 'string', `en.${key}`);
    assert.ok(dictionaries.en[key].length > 0, `en.${key} is not empty`);
    assert.equal(typeof dictionaries.zh[key], 'string', `zh.${key}`);
    assert.ok(dictionaries.zh[key].length > 0, `zh.${key} is not empty`);
  }

  const panel = harness.findRegistration(
    (options) => options.name === 'sidebar.panellist' && options.id === NAMESPACE,
    'sidebar.panellist with id github-actions',
  );

  assert.equal(panel.options.name, 'sidebar.panellist');
  assert.equal(panel.options.id, 'github-actions');
  assert.equal(panel.options.order, 30);
  assert.equal(typeof panel.Component, 'function');

  if (panel.options.locale !== undefined) assert.equal(panel.options.locale, NAMESPACE);

  const label =
    typeof panel.options.label === 'function' ? panel.options.label() : panel.options.label;

  assert.equal(typeof label, 'string');
  assert.ok(
    Object.values(dictionaries.en).includes(label),
    'the sidebar label comes from the en dictionary',
  );

  const icon = harness.renderIsolated(panel.Component, { t: harness.ctx.locale.bind(NAMESPACE) });
  const svg = visit(icon, (node) => node.type === 'svg')[0];

  assert.ok(svg, 'the sidebar icon is an original inline SVG');
  assert.equal(typeof svg.props.viewBox, 'string');

  const main = harness.findRegistration(
    (options) => options.name === 'main' && options.key === NAMESPACE,
    'main with key github-actions',
  );

  assert.equal(main.options.name, 'main');
  assert.equal(main.options.key, 'github-actions');
  assert.equal(typeof main.Component, 'function');

  if (main.options.locale !== undefined) assert.equal(main.options.locale, NAMESPACE);
});

test('describeState covers every §5 body state with a localized title', async () => {
  const harness = await createHarness();
  const { describeState } = harness.module;

  assert.equal(typeof describeState, 'function');

  const cases = [
    [setupSnapshot(), 'setup'],
    [
      snapshot({
        auth: auth({ signedIn: false, login: null, scopes: [], clientIdConfigured: true }),
        repo: null,
        repoStatus: 'no-checkout',
        runs: [],
        fetchedAt: null,
      }),
      'signed-out',
    ],
    [
      snapshot({
        repo: null,
        repoStatus: 'no-checkout',
        runs: [],
        fetchedAt: null,
      }),
      'no-checkout',
    ],
    [
      snapshot({
        repo: null,
        repoStatus: 'no-remote',
        runs: [],
        fetchedAt: null,
      }),
      'no-remote',
    ],
    [
      snapshot({
        repo: null,
        repoStatus: 'not-github',
        runs: [],
        fetchedAt: null,
      }),
      'not-github',
    ],
    [snapshot(), 'ready'],
  ];

  for (const [value, expectedKind] of cases) {
    const result = describeState(value);

    assert.equal(result.kind, expectedKind);
    assert.equal(typeof result.titleKey, 'string');
    assert.ok(result.titleKey.length > 0);
    assert.equal(
      harness.dictionaries.en[result.titleKey] === undefined,
      false,
      `${expectedKind}: titleKey "${result.titleKey}" exists in en`,
    );
    assert.equal(
      harness.dictionaries.zh[result.titleKey] === undefined,
      false,
      `${expectedKind}: titleKey "${result.titleKey}" exists in zh`,
    );
  }

  // A snapshot that has not been read yet (failed load) is the error surface.
  assert.equal(describeState(null).kind, 'error');
  assert.equal(typeof describeState(null).titleKey, 'string');
});

test('the page polls snapshot no faster than pollMs', async () => {
  const harness = await createHarness();

  await harness.mountPage();
  await harness.settle();

  const initial = harness.countCalls('githubActions.snapshot');

  assert.ok(initial >= 1, 'the page reads snapshot on mount');

  await harness.advance(4999);
  assert.equal(
    harness.countCalls('githubActions.snapshot'),
    initial,
    'must not poll faster than pollMs',
  );

  await harness.advance(1);

  const afterInterval = harness.countCalls('githubActions.snapshot');

  assert.ok(afterInterval > initial, 'the page polls again at pollMs');

  await harness.advance(5000);
  assert.ok(harness.countCalls('githubActions.snapshot') > afterInterval);

  harness.unmount();
});

test('polling stops while the document is hidden', async () => {
  const harness = await createHarness();

  await harness.mountPage();
  await harness.settle();
  await harness.advance(5000);

  const beforeHide = harness.countCalls('githubActions.snapshot');

  assert.ok(beforeHide >= 2);

  await harness.setVisibility('hidden');
  await harness.advance(20000);

  assert.equal(
    harness.countCalls('githubActions.snapshot'),
    beforeHide,
    'hidden documents must not poll',
  );

  harness.unmount();
});

test('polling stops when the page unmounts', async () => {
  const harness = await createHarness();

  await harness.mountPage();
  await harness.settle();
  await harness.advance(5000);

  const beforeUnmount = harness.countCalls('githubActions.snapshot');

  harness.unmount();
  await harness.advance(20000);

  assert.equal(
    harness.countCalls('githubActions.snapshot'),
    beforeUnmount,
    'unmounted pages must not poll',
  );
});

test('ready runs render their fields and activate the GitHub run URL', async () => {
  const harness = await createHarness();
  const tree = await harness.mountPage();

  assert.equal(visit(tree, (node) => node.type === 'h2').length, 1, 'one h2 title region');

  const running = snapshot().runs[0];
  const queued = snapshot().runs[1];

  const runningRow = findRow(tree, running);

  assert.ok(runningRow, 'the running run has a row');
  const runningText = text(runningRow);

  assert.ok(runningText.includes(running.name));
  assert.ok(runningText.includes(running.workflowName));
  assert.ok(runningText.includes(running.branch));
  assert.ok(new RegExp(running.event, 'i').test(runningText), 'the event is shown');
  assert.ok(/running|progress|active/i.test(runningText), 'an indeterminate running pill');

  const titles = visit(runningRow, (node) => node.props?.title === running.htmlUrl);

  assert.ok(titles.length >= 1, 'the full run URL is the title');

  const queuedRow = findRow(tree, queued);

  assert.ok(queuedRow, 'the queued run has a row');
  assert.match(text(queuedRow), /queued/i, 'queued runs use a queued pill');

  // Click activation.
  harness.opens.length = 0;
  const clickNode = clickableIn(runningRow);

  if (clickNode) {
    await clickNode.props.onClick(eventStub());

    assert.ok(harness.opens.length >= 1, 'clicking the row opens a new tab');
    assert.equal(harness.opens[0][0], running.htmlUrl);
  } else {
    const anchor = anchorIn(runningRow);

    assert.ok(anchor, 'the row is clickable or a link');
    assert.equal(anchor.props.href, running.htmlUrl);
    assert.equal(anchor.props.target, '_blank');
  }

  // Keyboard activation (Enter / Space).
  harness.opens.length = 0;
  const keyNode = keyboardIn(runningRow);

  if (keyNode) {
    await keyNode.props.onKeyDown(eventStub({ key: 'Enter' }));
    await keyNode.props.onKeyDown(eventStub({ key: ' ' }));

    assert.ok(harness.opens.length >= 2, 'Enter and Space activate the row');
    for (const opened of harness.opens.slice(0, 2)) {
      assert.equal(opened[0], running.htmlUrl);
    }
  } else {
    const anchor = anchorIn(runningRow);

    assert.ok(anchor, 'the row is keyboard-operable');
    assert.equal(anchor.props.href, running.htmlUrl);
    assert.equal(anchor.props.target, '_blank');
  }

  harness.unmount();
});

test('the setup form saves clientId through githubActions.setClientId and re-reads status', async () => {
  const harness = await createHarness({
    status: auth({ signedIn: false, login: null, scopes: [], clientIdConfigured: false }),
    snapshot: setupSnapshot({ repoStatus: 'no-checkout', repo: null }),
  });

  const tree = await harness.mountPage();
  const input = visit(
    tree,
    (node) =>
      node.type === 'input' &&
      !node.props?.disabled &&
      ['text', 'url', 'search', undefined].includes(node.props?.type),
  )[0];

  assert.ok(input, 'setup renders a client-id text input');

  const clientId = 'Iv1.setup-client';
  const changeEvent = eventStub({ target: { value: clientId }, currentTarget: { value: clientId } });

  if (typeof input.props.onChange === 'function') await input.props.onChange(changeEvent);
  else if (typeof input.props.onInput === 'function') await input.props.onInput(changeEvent);
  else assert.fail('the setup input must be editable');

  await harness.settle();

  const save = findSaveControl(harness.tree());

  assert.ok(save, 'setup offers a Save control');

  const before = harness.calls.length;

  if (save.kind === 'form') await save.node.props.onSubmit(eventStub());
  else await save.node.props.onClick(eventStub());

  await harness.settle();

  const newCalls = harness.calls.slice(before);
  const setCall = newCalls.find((call) => call[1] === 'githubActions.setClientId');

  assert.ok(setCall, 'Save calls githubActions.setClientId');
  assert.equal(setCall[0], '/api');
  assert.deepEqual(plain(setCall[2]), { clientId });

  const setIndex = harness.calls.indexOf(setCall);
  const statusAfterSave = harness.calls
    .slice(setIndex + 1)
    .some((call) => call[1] === 'githubActions.status');

  assert.equal(statusAfterSave, true, 'the panel re-reads status after saving');

  harness.unmount();
});
