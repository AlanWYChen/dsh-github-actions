/**
 * v1.3 panel UX acceptance tests.
 *
 * Contract: REQUIREMENTS.md "v1.3 increment — panel UX" (§16 workspace memory,
 * §17 repo-labelled header, §18 vertical layout + empty state, §19 criteria).
 * NEW suite; existing test files, fixtures and scripts/run-tests.mjs untouched.
 *
 * The frozen client harness is copied below (with one extra seam: a configurable
 * `options.storage` used as `window.localStorage`) so the workspace-memory tests
 * can supply a stubbed browser storage. No network, no real DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
  const storage =
    options.storage ?? {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };

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
      return storage;
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
    localStorage: storage,
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
/* v1.3 fixtures                                                       */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'github-actions.workspace';
const REPO = {
  host: 'github.com',
  owner: 'octo',
  name: 'hello',
  slug: 'octo/hello',
  webUrl: 'https://github.com/octo/hello',
  defaultBranch: null,
  source: 'remote',
};

const WORKSPACES = [
  { workspaceId: 'ws-a', title: 'Alpha', path: '/a', sessionIds: [] },
  { workspaceId: 'ws-b', title: 'Beta', path: '/b', sessionIds: [] },
  { workspaceId: 'ws-c', title: 'Gamma', path: '/c', sessionIds: [] },
];

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const calls = { get: [], set: [], remove: [] };

  return {
    getItem(key) {
      calls.get.push(key);

      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      calls.set.push([key, String(value)]);
      data.set(key, String(value));
    },
    removeItem(key) {
      calls.remove.push(key);
      data.delete(key);
    },
    stored(key) {
      return data.has(key) ? data.get(key) : null;
    },
    calls,
  };
}

function throwingStorage() {
  const calls = { get: 0, set: 0, remove: 0 };

  return {
    getItem() {
      calls.get += 1;
      throw new Error('storage denied');
    },
    setItem() {
      calls.set += 1;
      throw new Error('storage denied');
    },
    removeItem() {
      calls.remove += 1;
      throw new Error('storage denied');
    },
    calls,
  };
}

function historyEntry(overrides = {}) {
  return {
    ...run(),
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

function readySnapshot(overrides = {}) {
  return {
    ...snapshot(),
    workspace: { id: 'ws-a', title: 'Alpha', path: '/a' },
    repo: REPO,
    repoStatus: 'ok',
    auth: { signedIn: true, login: 'octocat', scopes: ['repo'], clientIdConfigured: true },
    runs: [run()],
    history: [historyEntry()],
    fetchedAt: '2026-01-02T03:04:05.000Z',
    stale: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Tree / CSS helpers                                                  */
/* ------------------------------------------------------------------ */

function classNames(node) {
  const value = node !== null && typeof node === 'object' ? node.props?.className : undefined;

  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

function hasClass(node, token) {
  return classNames(node).includes(token);
}

function findClass(tree, token) {
  return visit(tree, (node) => hasClass(node, token))[0];
}

function selectsIn(tree) {
  return visit(tree, (node) => node.type === 'select');
}

function optionNodes(select) {
  return visit(select, (node) => node.type === 'option');
}

function snapshotCalls(harness) {
  return harness.calls.filter((call) => call[1] === 'githubActions.snapshot');
}

function lastSnapshotPayload(harness) {
  const calls = snapshotCalls(harness);

  assert.ok(calls.length > 0, 'the panel read a snapshot');

  return plain(calls[calls.length - 1][2]);
}

async function open(options = {}, props = {}) {
  const harness = await createHarness(options);
  const tree = await harness.mountPage(props);

  await harness.settle();

  return { harness, tree };
}

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
  const walk = (text, media) => {
    let index = 0;

    while (index < text.length) {
      while (index < text.length && /[\s;}]/.test(text[index])) index += 1;
      if (index >= text.length) break;

      const open = text.indexOf('{', index);

      if (open === -1) break;

      const selector = text.slice(index, open).trim();
      let depth = 1;
      let cursor = open + 1;

      while (cursor < text.length && depth > 0) {
        if (text[cursor] === '{') depth += 1;
        else if (text[cursor] === '}') depth -= 1;
        cursor += 1;
      }

      const body = text.slice(open + 1, cursor - 1);

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

function declarationOf(rule, property) {
  const found = rule.declarations.find(([name]) => name === property);

  return found === undefined ? undefined : found[1];
}

function mergedDeclarations(rules, className) {
  const merged = {};

  for (const rule of rules) {
    if (rule.media) continue;
    if (!selectorClasses(rule.selector).includes(className)) continue;

    for (const [property, value] of rule.declarations) merged[property] = value;
  }

  return merged;
}

function horizontalPadding(declarations) {
  const left = declarations['padding-left'];
  const right = declarations['padding-right'];
  const shorthand = declarations.padding;

  if (left !== undefined || right !== undefined) return [left ?? '0', right ?? '0'];

  if (typeof shorthand !== 'string') return undefined;

  const parts = shorthand.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return [parts[0], parts[0]];
  if (parts.length === 2) return [parts[1], parts[1]];
  if (parts.length === 3) return [parts[1], parts[1]];

  return [parts[3], parts[1]];
}

function isZero(value) {
  return /^0(?:px|rem|em)?$/.test(String(value).trim());
}

function flexFills(declarations) {
  const flex = declarations.flex;

  if (typeof flex === 'string' && /^1(?:\s|$)/.test(flex.trim())) return true;

  return declarations['flex-grow'] === '1';
}

const COLOR_PROPS = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
]);

/* The alias tokens defined by the running DSH Web theme (dsh-client-ui-theme),
 * frozen at test-authoring time. Every token the plugin uses must exist here. */
const THEME_ALIAS_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-document-preview',
  '--dsw-alias-bg-document-selection',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-bg-mask-2',
  '--dsw-alias-bg-mask-3',
  '--dsw-alias-bg-mask-drop',
  '--dsw-alias-bg-mask-photo',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-multi-select',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-skeleton',
  '--dsw-alias-border-inverted',
  '--dsw-alias-border-inverted2',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l2-darkmode-thin',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-primary-new-colorprimary-new-color',
  '--dsw-alias-brand-text',
  '--dsw-alias-button-contrast-fill',
  '--dsw-alias-button-elevated-fill',
  '--dsw-alias-button-floating-fill',
  '--dsw-alias-button-floating-hover',
  '--dsw-alias-button-ghost-active-border',
  '--dsw-alias-button-ghost-active-fill',
  '--dsw-alias-button-ghost-active-hover',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-hover',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-tool-bar-fill',
  '--dsw-alias-button-tool-bar-fill-invisible',
  '--dsw-alias-button-tool-bar-hover',
  '--dsw-alias-code-diff-added',
  '--dsw-alias-code-diff-deleted',
  '--dsw-alias-file-diff-added-bg',
  '--dsw-alias-file-diff-added-gutter',
  '--dsw-alias-file-diff-added-marker',
  '--dsw-alias-file-diff-deleted-bg',
  '--dsw-alias-file-diff-deleted-gutter',
  '--dsw-alias-file-diff-deleted-marker',
  '--dsw-alias-illustration-background',
  '--dsw-alias-illustration-backing',
  '--dsw-alias-illustration-detail',
  '--dsw-alias-illustration-inset',
  '--dsw-alias-illustration-shadow',
  '--dsw-alias-illustration-surface',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-interactive-bg-hover-danger',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-deep-diving',
  '--dsw-alias-label-deep-diving-shimmer',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-document-preview',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-bluish',
  '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-shimmer',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-link',
  '--dsw-alias-markdown-citation',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner',
  '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-placeholder',
  '--dsw-alias-markdown-tag',
  '--dsw-alias-menu-group-header-fill',
  '--dsw-alias-menu-icon',
  '--dsw-alias-scrollbar-bg-l1',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l1',
  '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-done-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-error-secondary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-success-secondary',
  '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-secondary',
  '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-switch-thumb',
  '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label',
  '--dsw-alias-tooltip-bg',
  '--dsw-alias-tooltip-key-bg',
  '--dsw-alias-turn-trigger-bg',
  '--dsw-alias-turn-trigger-bg-hover',
]);

/* ------------------------------------------------------------------ */
/* §16 / §19.1 — workspace memory                                      */
/* ------------------------------------------------------------------ */

test('workspace memory restores a stored id, falls back to the first workspace, and never clobbers on read (§16)', async () => {
  // Stored id present in the list wins on the first snapshot read.
  const stored = memoryStorage({ [STORAGE_KEY]: 'ws-b' });
  const restored = await open({ snapshot: readySnapshot(), workspaces: WORKSPACES, storage: stored });
  const first = snapshotCalls(restored.harness)[0];

  assert.ok(first, 'the panel reads a snapshot on mount');
  assert.equal(plain(first[2]).workspaceId, 'ws-b');

  const selects = selectsIn(restored.tree);

  assert.equal(selects.length, 1);
  assert.equal(String(selects[0].props.value), 'ws-b');

  assert.ok(stored.calls.get.length >= 1, 'mount reads the stored key');
  assert.ok(stored.calls.get.every((key) => key === STORAGE_KEY));
  assert.equal(stored.calls.set.length, 0, 'reading never overwrites storage');
  restored.harness.unmount();

  // No stored id: the first workspace is used and nothing is written.
  const empty = memoryStorage();
  const fallback = await open({ snapshot: readySnapshot(), workspaces: WORKSPACES, storage: empty });

  assert.equal(lastSnapshotPayload(fallback.harness).workspaceId, 'ws-a');
  assert.ok(empty.calls.get.every((key) => key === STORAGE_KEY));
  assert.equal(empty.calls.set.length, 0);
  assert.equal(empty.stored(STORAGE_KEY), null, 'no write merely from reading');
  fallback.harness.unmount();

  // Unknown stored id: ignored; the stored value itself is not clobbered.
  const unknown = memoryStorage({ [STORAGE_KEY]: 'ws-gone' });
  const ignored = await open({ snapshot: readySnapshot(), workspaces: WORKSPACES, storage: unknown });

  assert.equal(lastSnapshotPayload(ignored.harness).workspaceId, 'ws-a');
  assert.equal(unknown.stored(STORAGE_KEY), 'ws-gone', 'reading does not clobber an unknown id');
  assert.equal(unknown.calls.set.length, 0);
  ignored.harness.unmount();
});

test('changing the workspace writes the new id exactly once, and a throwing storage is non-fatal (§16)', async () => {
  const storage = memoryStorage();
  const { harness, tree } = await open({
    snapshot: readySnapshot(),
    workspaces: WORKSPACES,
    storage,
  });

  assert.equal(storage.calls.set.length, 0, 'mount does not write');

  const select = selectsIn(tree)[0];

  assert.ok(select, 'the header select exists');

  await select.props.onChange({ target: { value: 'ws-c' }, currentTarget: { value: 'ws-c' } });
  await harness.settle();

  assert.deepEqual(storage.calls.set, [[STORAGE_KEY, 'ws-c']], 'one write per selection change');
  assert.equal(storage.stored(STORAGE_KEY), 'ws-c');
  assert.equal(lastSnapshotPayload(harness).workspaceId, 'ws-c');

  harness.unmount();

  // A storage whose every access throws behaves as empty and never breaks the panel.
  const denied = throwingStorage();
  const deniedOpen = await open(
    { snapshot: readySnapshot(), workspaces: WORKSPACES, storage: denied },
    { workspaceId: undefined },
  );

  assert.ok(findClass(deniedOpen.tree, 'gha-toolbar'), 'the panel mounts');
  assert.equal(selectsIn(deniedOpen.tree).length, 1);
  assert.equal(findClass(deniedOpen.tree, 'gha-title') !== undefined, true);
  assert.ok(denied.calls.get >= 1, 'the guarded storage read is attempted on mount');
  assert.equal(lastSnapshotPayload(deniedOpen.harness).workspaceId, 'ws-a');

  const deniedSelect = selectsIn(deniedOpen.tree)[0];

  await deniedSelect.props.onChange({ target: { value: 'ws-c' }, currentTarget: { value: 'ws-c' } });
  await deniedOpen.harness.settle();

  assert.ok(denied.calls.set >= 1, 'the guarded storage write is attempted on change');
  assert.equal(selectsIn(deniedOpen.harness.tree()).length, 1, 'the panel still renders');
  assert.equal(lastSnapshotPayload(deniedOpen.harness).workspaceId, 'ws-c');

  deniedOpen.harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §17 / §19.2 — repo-labelled header                                  */
/* ------------------------------------------------------------------ */

test('the header has ONE select labelled with the repo slug and a GitHub icon link (§17)', async () => {
  const { harness, tree } = await open({
    snapshot: readySnapshot(),
    workspaces: WORKSPACES,
    storage: memoryStorage(),
  });
  const header = findClass(tree, 'gha-toolbar');
  const en = harness.dictionaries.en;

  assert.ok(header, 'the toolbar header renders');

  const headerSelects = visit(header, (node) => node.type === 'select');

  assert.equal(headerSelects.length, 1, 'exactly one select in the toolbar');
  assert.equal(selectsIn(tree).length, 1, 'there is no leftover second select');

  const select = headerSelects[0];
  const options = optionNodes(select);

  assert.equal(options.length, WORKSPACES.length, 'the option list covers every workspace');
  assert.deepEqual(
    options.map((option) => String(option.props.value)).sort(),
    WORKSPACES.map((workspace) => workspace.workspaceId).sort(),
    'the option list covers every workspace',
  );

  const selected = options.find(
    (option) => String(option.props.value) === String(select.props.value),
  );

  assert.ok(selected, 'the select has a selected option');
  assert.equal(text(selected).trim(), 'Alpha', 'the closed control shows the workspace title');

  for (const option of options) {
    if (option === selected) continue;
    const id = String(option.props.value);
    const workspace = WORKSPACES.find((candidate) => candidate.workspaceId === id);

    assert.equal(text(option).trim(), workspace.title, `option ${id} shows its workspace title`);
  }

  assert.equal(
    text(header).includes(en.workspace),
    false,
    'the old separate Workspace label is gone',
  );

  const links = visit(header, (node) => node.type === 'a');
  const repoLink = links.find((link) => link.props.href === REPO.webUrl);

  assert.ok(repoLink, 'the GitHub repo link renders for a connected repo');
  assert.equal(repoLink.props.target, '_blank');
  assert.match(repoLink.props.rel ?? '', /noreferrer/);
  assert.match(repoLink.props.rel ?? '', /noopener/);
  assert.equal(repoLink.props['aria-label'], en['a11y.openRepo']);
  assert.ok(en['a11y.openRepo'], 'a11y.openRepo localizes the link');

  const svg = visit(repoLink, (node) => node.type === 'svg')[0];

  assert.ok(svg, 'the repo link contains an inline SVG');
  assert.match(JSON.stringify(svg.props), /currentColor/, 'the mark uses currentColor');

  harness.unmount();

  // Exactly one workspace: the control still renders (no length > 1 gate).
  const { harness: soleHarness, tree: soleTree } = await open({
    snapshot: readySnapshot(),
    workspaces: [WORKSPACES[0]],
    storage: memoryStorage(),
  });
  const soleSelects = selectsIn(soleTree);

  assert.equal(soleSelects.length, 1, 'the repo-labelled select always renders');
  const soleOptions = optionNodes(soleSelects[0]);
  const soleSelected = soleOptions.find(
    (option) => String(option.props.value) === String(soleSelects[0].props.value),
  );

  assert.equal(text(soleSelected).trim(), 'Alpha');

  soleHarness.unmount();
});

test('without a repo the select shows the workspace title and the GitHub link is absent (§17)', async () => {
  const { harness, tree } = await open({
    snapshot: readySnapshot({ repo: null, repoStatus: 'no-checkout', runs: [], history: [], fetchedAt: null }),
    workspaces: WORKSPACES,
    storage: memoryStorage(),
  });
  const header = findClass(tree, 'gha-toolbar');
  const en = harness.dictionaries.en;
  const selects = selectsIn(tree);

  assert.equal(selects.length, 1);

  const options = optionNodes(selects[0]);
  const selected = options.find(
    (option) => String(option.props.value) === String(selects[0].props.value),
  );

  assert.ok(selected);
  assert.equal(text(selected).trim(), 'Alpha', 'the selected label is the workspace title');
  assert.equal(options.length, WORKSPACES.length);
  assert.equal(
    text(header).includes(en.workspace),
    false,
    'the old separate Workspace label is gone',
  );

  assert.equal(
    visit(header, (node) => node.type === 'a' && node.props['aria-label'] === en['a11y.openRepo'])
      .length,
    0,
    'the GitHub link is absent (not disabled) without a repo',
  );
  assert.equal(
    visit(header, (node) => node.type === 'a' && String(node.props.href ?? '').includes('github.com'))
      .length,
    0,
    'no repo link is rendered without a repo',
  );

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §18 / §19.3 — full-height chain and empty-state spacing             */
/* ------------------------------------------------------------------ */

test('the panel fills its height: Recent flex-fills, Running caps at 40vh, and empty/list padding is row-aligned (§18)', () => {
  const css = readStylesheet();
  const rules = parseRules(css);
  const declarations = (className) => mergedDeclarations(rules, className);

  const page = declarations('gha-page');

  assert.equal((page.display ?? '').trim(), 'flex');
  assert.equal((page['flex-direction'] ?? '').trim(), 'column');
  assert.equal((page.height ?? '').trim(), '100%');
  assert.ok(isZero(page['min-height']), '.gha-page needs min-height:0');

  for (const className of ['gha-body', 'gha-runs', 'gha-recent']) {
    const declarationsForClass = declarations(className);

    assert.ok(flexFills(declarationsForClass), `.${className} must be flex:1`);
    assert.ok(isZero(declarationsForClass['min-height']), `.${className} needs min-height:0`);
  }

  // The Recent scroll fills the remaining height and has no 52vh cap.
  const recentScrolls = rules.filter(
    (rule) =>
      !rule.media &&
      (declarationOf(rule, 'max-height') ?? '').trim() === 'none' &&
      /recent/i.test(rule.selector),
  );

  assert.ok(recentScrolls.length > 0, 'the Recent scroll container must set max-height:none');
  assert.ok(
    recentScrolls.some((rule) => flexFills(Object.fromEntries(rule.declarations))),
    'the Recent scroll container must flex-fill',
  );
  assert.ok(
    recentScrolls.some((rule) => isZero(declarationOf(rule, 'min-height') ?? '')),
    'the Recent scroll container needs min-height:0',
  );
  // The frozen v1.2 layout suite still requires a bounded `.gha-scroll` base rule
  // with max-height:min(52vh,640px); the Recent/Running computed overrides above
  // replace it (more specific selectors), so the base rule may remain in the CSS.

  // The Running scroll area stays content-sized but capped at 40vh.
  const runningCaps = rules.filter(
    (rule) =>
      !rule.media &&
      /40vh/.test(declarationOf(rule, 'max-height') ?? '') &&
      /running/i.test(rule.selector),
  );

  assert.ok(runningCaps.length > 0, 'the Running scroll area must cap at 40vh');

  // Padding is consistent and row-aligned.
  const scroll = declarations('gha-scroll');
  const scrollHorizontal = horizontalPadding(scroll);

  if (scrollHorizontal !== undefined) {
    assert.ok(scrollHorizontal.every(isZero), '.gha-scroll has no horizontal padding');
  }

  for (const [className, expectedPadding] of [
    ['gha-section-title', '14px'],
    // The header row sits outside `.gha-list`, so it must absorb the list's 14px
    // plus the row's 14px for its content box to align with a data row's.
    ['gha-header', '28px'],
  ]) {
    const horizontal = horizontalPadding(declarations(className));

    assert.ok(horizontal !== undefined, `.${className} needs horizontal padding`);
    assert.ok(
      horizontal.every((value) => value === expectedPadding),
      `.${className} padding is ${expectedPadding}`,
    );
  }

  const list = declarations('gha-list');

  assert.equal(
    (list.padding ?? '').replace(/\s+/g, ' ').trim(),
    '10px 14px 14px',
    '.gha-list padding is 10px 14px 14px',
  );

  const emptyLine = declarations('gha-empty-line');

  assert.equal(
    (emptyLine.padding ?? '').replace(/\s+/g, ' ').trim(),
    '14px',
    '.gha-empty-line padding is 14px',
  );
  assert.ok(isZero(emptyLine.margin), '.gha-empty-line margin is 0');

  // Theme tokens only; every alias token exists in the running theme.
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no literal hex colors');
  assert.doesNotMatch(css, /\b(?:rgb|rgba|hsl|hsla)\(/, 'no literal rgb/hsl colors');

  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (!COLOR_PROPS.has(property)) continue;
      if (/^(?:transparent|currentcolor|inherit|initial|unset|none)$/i.test(value)) continue;

      assert.match(value, /var\(--dsw-alias-/, `${property}: ${value} must use a theme token`);
    }
  }

  const usedTokens = new Set([...css.matchAll(/var\((--dsw-alias-[a-z0-9-]+)/g)].map((match) => match[1]));

  assert.ok(usedTokens.size > 0, 'the stylesheet uses theme alias tokens');

  for (const token of usedTokens) {
    assert.ok(THEME_ALIAS_TOKENS.has(token), `${token} must exist in the running theme`);
  }
});

/* ------------------------------------------------------------------ */
/* §17 / §19.2 — locale key                                            */
/* ------------------------------------------------------------------ */

test('a11y.openRepo exists in both inline dictionaries and both locale JSON files with identical key sets (§17)', async () => {
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

  assert.equal(runtimeEn['a11y.openRepo'], 'Open repository on GitHub');
  assert.equal(enFile['a11y.openRepo'], 'Open repository on GitHub');
  assert.equal(typeof runtimeZh['a11y.openRepo'], 'string');
  assert.ok(runtimeZh['a11y.openRepo'].length > 0);
  assert.equal(zhFile['a11y.openRepo'], runtimeZh['a11y.openRepo']);

  harness.unmount();
});
