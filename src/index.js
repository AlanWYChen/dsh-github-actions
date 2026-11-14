/**
 * Host half of the GitHub Actions bundle — REQUIREMENTS.md §3, §4, §6, §7.
 *
 * `createHandlers(deps)` is the composition seam the acceptance tests drive
 * directly: it receives every I/O dependency (credentials, workspaces, config
 * editor, git process, GitHub HTTP, clock) and returns the seven RPC handlers.
 * `apply(ctx, config)` only adapts the Cordis context to that same deps shape
 * and registers the seven authenticated Fetch routes.
 */

import { execFile } from 'node:child_process';
import s from 'schemastery';

import { createDeviceFlow } from './device-flow.js';
import { detectCheckout } from './git.js';
import { activeRuns, historyRuns } from './runs.js';
import {
  isSafeSegment,
  repoApiHistoryUrl,
  repoApiRunsUrl,
} from './remotes.js';

export const PLUGIN_ID = 'github-actions';
export const PLUGIN_NAME = '@local/dsh-github-actions';

export const inject = ['connection', 'credentials', 'workspaceRegistry'];

const METHODS = [
  'status',
  'begin',
  'poll',
  'cancel',
  'signOut',
  'snapshot',
  'setClientId',
];

const CONFIG_DEFAULTS = Object.freeze({
  clientId: '',
  scopes: 'repo',
  host: 'github.com',
  apiBaseUrl: 'https://api.github.com',
  refreshMs: 3000,
  pollMs: 5000,
  timeoutMs: 10000,
  historyLimit: 20,
  historyRefreshMs: 15000,
});

const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{6,64}$/;
const SAFE_HOST = /^[A-Za-z0-9.-]+$/;

// Only these codes are documented by REQUIREMENTS §4/§6 (plus the actionable
// device-flow-disabled path). Raw Node/DOM error codes (ENOTFOUND, ABORT_ERR,
// DOMException numeric codes, ...) must never cross the RPC boundary.
const DOCUMENTED_ERROR_CODES = new Set([
  'no-client-id',
  'auth-required',
  'rate-limited',
  'github-unreachable',
  'no-git',
  'workspace-missing',
  'not-signed-in',
  'invalid-input',
  'internal',
  'device-flow-disabled',
  'config-unavailable',
]);

export class GitHubActionsError extends Error {
  constructor(code, message, details = {}) {
    super(message);

    this.name = 'GitHubActionsError';
    this.code = code;
    this.details = details !== null && typeof details === 'object' ? details : {};
  }
}

function fail(code, message, details) {
  throw new GitHubActionsError(code, message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveNumber(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * Native Schemastery schema for the §7 config.
 *
 * The DSH config inspector/editor only accepts native Schemastery graphs
 * (`Reflect.get(value, Symbol.for('schemastery')) === true`, plus `type` and
 * `meta`), so `Config` is the schema instance itself rather than a wrapper.
 * Schemastery instances are callable, so `Config(input)` resolves defaults
 * exactly like `Config.parse(input)`.
 */
export const Config = s.object({
  clientId: s.string().default(CONFIG_DEFAULTS.clientId),
  scopes: s.string().default(CONFIG_DEFAULTS.scopes),
  host: s.string().default(CONFIG_DEFAULTS.host),
  apiBaseUrl: s.string().default(CONFIG_DEFAULTS.apiBaseUrl),
  refreshMs: s.number().default(CONFIG_DEFAULTS.refreshMs),
  pollMs: s.number().default(CONFIG_DEFAULTS.pollMs),
  timeoutMs: s.number().default(CONFIG_DEFAULTS.timeoutMs),
  historyLimit: s.number().default(CONFIG_DEFAULTS.historyLimit),
  historyRefreshMs: s.number().default(CONFIG_DEFAULTS.historyRefreshMs),
});

// Attaching `.parse` keeps the frozen test's compatibility path. A
// non-enumerable property leaves the native schema graph untouched.
Object.defineProperty(Config, 'parse', {
  configurable: true,
  enumerable: false,
  writable: true,
  value: (input) => Config(input === undefined || input === null ? {} : input),
});

/**
 * Resolve the §7 + §11 config to exactly its nine documented fields, applying
 * the runtime clamps (`pollMs >= refreshMs`, `timeoutMs >= 1`,
 * `historyLimit` 1..100). The native schema stays pure so the config editor
 * keeps rendering individual fields.
 */
function normalizeConfig(value) {
  const raw = isPlainObject(value) ? value : {};
  const refreshMs = positiveNumber(raw.refreshMs, CONFIG_DEFAULTS.refreshMs);
  const pollMs = Math.max(
    positiveNumber(raw.pollMs, CONFIG_DEFAULTS.pollMs),
    refreshMs,
  );
  const historyLimit = Math.min(
    100,
    Math.max(1, Math.trunc(positiveNumber(raw.historyLimit, CONFIG_DEFAULTS.historyLimit))),
  );
  const historyRefreshMs = positiveNumber(
    raw.historyRefreshMs,
    CONFIG_DEFAULTS.historyRefreshMs,
  );

  return {
    clientId: typeof raw.clientId === 'string' ? raw.clientId : CONFIG_DEFAULTS.clientId,
    scopes:
      typeof raw.scopes === 'string' && raw.scopes.trim().length > 0
        ? raw.scopes
        : CONFIG_DEFAULTS.scopes,
    host:
      typeof raw.host === 'string' && raw.host.trim().length > 0
        ? raw.host.trim()
        : CONFIG_DEFAULTS.host,
    apiBaseUrl:
      typeof raw.apiBaseUrl === 'string' && raw.apiBaseUrl.trim().length > 0
        ? raw.apiBaseUrl.trim().replace(/\/+$/, '')
        : CONFIG_DEFAULTS.apiBaseUrl,
    refreshMs,
    pollMs,
    timeoutMs: Math.max(positiveNumber(raw.timeoutMs, CONFIG_DEFAULTS.timeoutMs), 1),
    historyLimit,
    historyRefreshMs,
  };
}

function objectPayload(payload) {
  if (!isPlainObject(payload)) {
    fail('invalid-input', 'The request payload must be an object.');
  }

  return payload;
}

function snapshotPayload(payload) {
  const body = objectPayload(payload);

  if (typeof body.workspaceId !== 'string' || body.workspaceId.length === 0) {
    fail('invalid-input', '`workspaceId` must be a non-empty string.');
  }

  if (body.refresh !== undefined && typeof body.refresh !== 'boolean') {
    fail('invalid-input', '`refresh` must be a boolean when present.');
  }

  return { workspaceId: body.workspaceId, refresh: body.refresh === true };
}

function setClientIdPayload(payload) {
  const body = objectPayload(payload);

  if (typeof body.clientId !== 'string' || !CLIENT_ID_PATTERN.test(body.clientId)) {
    fail('invalid-input', 'The GitHub OAuth App client ID has an invalid shape.');
  }

  return body.clientId;
}

/**
 * Adapt the Host credential record API to the flow's `read`/`write`/`clear`
 * store seam. The token stays inside this adapter and the flow; no handler
 * returns it.
 */
function createCredentialStore(credentials, key) {
  const recordApi = credentials !== null && typeof credentials === 'object';

  return {
    async read() {
      if (!recordApi) return undefined;
      if (typeof credentials.readRecord === 'function') {
        return await credentials.readRecord(key);
      }
      if (typeof credentials.read === 'function') return await credentials.read();

      return undefined;
    },
    async write(record) {
      if (recordApi && typeof credentials.modifyRecord === 'function') {
        await credentials.modifyRecord(key, () => record);

        return;
      }
      if (recordApi && typeof credentials.write === 'function') {
        await credentials.write(record);

        return;
      }

      fail('internal', 'The credential store is unavailable.');
    },
    async clear() {
      if (!recordApi) return;
      if (typeof credentials.deleteRecord === 'function') {
        await credentials.deleteRecord(key);

        return;
      }
      if (typeof credentials.clear === 'function') await credentials.clear();
    },
  };
}

function errorCodeOf(error) {
  return error !== null && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function createPost(githubFetch) {
  return async function post(url, params, headers, signal) {
    const body = new URLSearchParams();

    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null) body.set(key, String(value));
    }

    const init = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(headers ?? {}),
      },
      body: body.toString(),
    };

    if (signal !== undefined) init.signal = signal;

    const response = await githubFetch(url, init);

    let json;

    try {
      json = await response.json();
    } catch {
      json = {};
    }

    return { status: response.status, json };
  };
}

/**
 * Wrap the real global fetch with the §7 per-request deadline. Only real fetch
 * implementations are wrapped; an injected `githubFetch` seam is used as-is.
 * The deadline and any caller signal both abort the same controller.
 */
function createTimedFetch(timeoutMs) {
  const deadline = Math.max(1, Number(timeoutMs) || CONFIG_DEFAULTS.timeoutMs);

  return async function timedGithubFetch(url, init) {
    if (typeof globalThis.fetch !== 'function') {
      throw new GitHubActionsError(
        'github-unreachable',
        'GitHub is unreachable: no fetch implementation is available.',
      );
    }

    const requestInit = init === null || init === undefined ? {} : init;
    const callerSignal = requestInit.signal;
    const controller = new AbortController();
    const abortFromCaller = () => {
      if (controller.signal.aborted) return;
      try {
        controller.abort(callerSignal?.reason);
      } catch {
        controller.abort();
      }
    };

    if (callerSignal !== undefined && callerSignal !== null) {
      if (callerSignal.aborted === true) {
        abortFromCaller();
      } else if (typeof callerSignal.addEventListener === 'function') {
        callerSignal.addEventListener('abort', abortFromCaller, { once: true });
      }
    }

    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      try {
        controller.abort(
          typeof DOMException === 'function'
            ? new DOMException('GitHub request timed out', 'TimeoutError')
            : new Error('GitHub request timed out'),
        );
      } catch {
        controller.abort();
      }
    }, deadline);

    try {
      return await globalThis.fetch(url, { ...requestInit, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      if (
        callerSignal !== undefined &&
        callerSignal !== null &&
        typeof callerSignal.removeEventListener === 'function'
      ) {
        callerSignal.removeEventListener('abort', abortFromCaller);
      }
    }
  };
}

function headerValue(response, name) {
  const headers = response?.headers;

  if (headers === undefined || headers === null) return undefined;

  if (typeof headers.get === 'function') {
    const value = headers.get(name);

    return value === undefined || value === null ? undefined : String(value);
  }

  const lower = String(name).toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === lower) return String(value);
  }

  return undefined;
}

/**
 * Build the seven RPC handlers from injected dependencies.
 *
 * @param {object} deps
 * @param {object} deps.config §7 config value
 * @param {object} deps.credentials credential record store
 * @param {object} deps.workspaces workspace registry (`get(id)`)
 * @param {object} [deps.editor] config editor (`entries()`, `edit(entry, mutate)`)
 * @param {(cwd: string, args: string[]) => Promise<{stdout: string, stderr: string, exitCode: number}>} deps.gitRun
 * @param {(url: string, init?: object) => Promise<object>} deps.githubFetch
 * @param {() => number} [deps.now]
 */
export function createHandlers(deps = {}) {
  const config = normalizeConfig(
    Config(deps.config === undefined || deps.config === null ? {} : deps.config),
  );
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const store = createCredentialStore(deps.credentials, 'github-actions/oauth');
  const workspaces = deps.workspaces;
  const editor = deps.editor;
  const gitRun =
    typeof deps.gitRun === 'function'
      ? deps.gitRun
      : async () => ({ stdout: '', stderr: '', exitCode: 1 });
  const githubFetch =
    typeof deps.githubFetch === 'function'
      ? deps.githubFetch // test seam: never wrap an injected implementation
      : createTimedFetch(config.timeoutMs);

  const activeCache = new Map();
  const historyCache = new Map();

  const fetchUser = async (token, signal) => {
    const init = {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    if (signal !== undefined) init.signal = signal;

    const response = await githubFetch(`${config.apiBaseUrl}/user`, init);

    if (response === null || typeof response !== 'object' || response.ok === false) {
      return { login: null };
    }

    let json;

    try {
      json = await response.json();
    } catch {
      json = {};
    }

    return { login: typeof json.login === 'string' ? json.login : null };
  };

  const flow = createDeviceFlow({
    post: createPost(githubFetch),
    now,
    store,
    fetchUser,
    clientId: () => config.clientId,
    scopes: () => config.scopes,
    config,
  });

  async function requestRuns(repo, token, signal) {
    const init = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    if (signal !== undefined) init.signal = signal;

    return await githubFetch(repoApiRunsUrl(config.apiBaseUrl, repo), init);
  }

  async function requestHistory(repo, token, signal) {
    const init = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    if (signal !== undefined) init.signal = signal;

    return await githubFetch(
      repoApiHistoryUrl(config.apiBaseUrl, repo, config.historyLimit),
      init,
    );
  }

  function findEditorEntry() {
    if (editor === null || typeof editor !== 'object') return undefined;
    if (typeof editor.entries !== 'function') return undefined;

    const entries = editor.entries();

    if (!Array.isArray(entries)) return undefined;

    // Match ONLY this plugin's row by id or package name. Never fall back to
    // another row: writing clientId into a foreign plugin's config would leak
    // configuration between bundles.
    const match = entries.find(
      (entry) => entry?.options?.id === PLUGIN_ID || entry?.options?.name === PLUGIN_NAME,
    );

    return match ?? undefined;
  }

  async function status() {
    return await flow.status();
  }

  async function begin() {
    try {
      return await flow.start();
    } catch (error) {
      throw asHostError(error);
    }
  }

  async function poll() {
    try {
      return await flow.poll();
    } catch (error) {
      throw asHostError(error);
    }
  }

  async function cancel() {
    return await flow.cancel();
  }

  async function signOut() {
    return await flow.signOut();
  }

  async function setClientId(payload) {
    const clientId = setClientIdPayload(payload);

    if (editor === null || typeof editor !== 'object' || typeof editor.edit !== 'function') {
      fail('config-unavailable', 'The configuration editor is unavailable.');
    }

    const entry = findEditorEntry();

    if (entry === undefined) {
      fail('config-unavailable', 'The GitHub Actions config entry could not be found.');
    }

    await editor.edit(entry, (current) => ({
      ...(isPlainObject(current) ? current : {}),
      clientId,
    }));

    // The running process signs in with the new value immediately; the durable
    // write above makes it survive a Host restart.
    config.clientId = clientId;

    return await status();
  }

  async function snapshot(payload) {
    const { workspaceId, refresh } = snapshotPayload(payload);

    if (
      workspaces === null ||
      typeof workspaces !== 'object' ||
      typeof workspaces.get !== 'function'
    ) {
      fail('internal', 'The workspace registry is unavailable.');
    }

    const workspace = await workspaces.get(workspaceId);

    if (workspace === null || workspace === undefined) {
      fail('workspace-missing', `Workspace "${workspaceId}" is unknown.`);
    }

    const workspacePath = typeof workspace.path === 'string' ? workspace.path : '';

    if (workspacePath.length === 0) {
      fail('internal', 'The workspace has no filesystem path.');
    }

    const auth = await status();
    const base = {
      workspace: {
        id: workspace.id ?? workspaceId,
        title: typeof workspace.title === 'string' ? workspace.title : '',
        path: workspacePath,
      },
      repo: null,
      repoStatus: 'no-checkout',
      auth,
      runs: [],
      history: [],
      fetchedAt: null,
      stale: false,
    };

    let detected;

    try {
      detected = await detectCheckout({
        run: gitRun,
        workspacePath,
        host: config.host,
      });
    } catch (error) {
      // `no-git` is an RPC error code (§4), not a Snapshot.repoStatus value:
      // a checkout that git cannot read must fail the call, never succeed with
      // an undocumented status.
      const detail =
        error !== null &&
        typeof error === 'object' &&
        typeof error.message === 'string' &&
        error.message.length > 0
          ? error.message
          : 'git cannot read the workspace checkout; check that git is installed and the repository is healthy, then retry.';
      const details =
        error !== null && typeof error === 'object' && isPlainObject(error.details)
          ? error.details
          : {};

      fail('no-git', detail, details);
    }

    const repo = detected.repo;

    base.repoStatus = detected.repoStatus;
    base.repo = repo;

    if (detected.repoStatus !== 'ok' || repo === null) return base;
    if (!auth.signedIn) return base;
    if (!isSafeSegment(repo.owner) || !isSafeSegment(repo.name)) {
      fail('not-github', 'The detected repository is not a safe GitHub repository.');
    }
    if (typeof repo.host !== 'string' || !SAFE_HOST.test(repo.host)) {
      fail('not-github', 'The detected GitHub host is not valid.');
    }

    const record = await store.read();
    const token =
      record !== null &&
      typeof record === 'object' &&
      record.payload !== null &&
      typeof record.payload === 'object' &&
      typeof record.payload.token === 'string'
        ? record.payload.token
        : undefined;

    if (token === undefined) {
      fail('auth-required', 'The GitHub credential is missing; sign in again.');
    }

    const cacheKey = `${repo.host.toLowerCase()}/${repo.owner}/${repo.name}`;
    const moment = now();
    const cachedActive = activeCache.get(cacheKey);
    const cachedHistory = historyCache.get(cacheKey);
    const activeFresh =
      !refresh &&
      cachedActive !== undefined &&
      moment - cachedActive.fetchedAtMs < config.refreshMs;
    const historyFresh =
      !refresh &&
      cachedHistory !== undefined &&
      moment - cachedHistory.fetchedAtMs < config.historyRefreshMs;

    // Issue both documented reads (active + completed history) concurrently.
    const activeResult = activeFresh
      ? Promise.resolve({ cached: cachedActive })
      : requestRuns(repo, token).then(
          (response) => ({ response }),
          (error) => ({ error }),
        );
    const historyResult = historyFresh
      ? Promise.resolve({ cached: cachedHistory })
      : requestHistory(repo, token).then(
          (response) => ({ response }),
          (error) => ({ error }),
        );

    // The two reads run concurrently, so both may observe a 401. Delete the
    // stored credential at most once per snapshot; the final error stays
    // `auth-required` (raised by the priority check below).
    let credentialCleared = false;

    async function clearCredentialOnce() {
      if (credentialCleared) return;

      credentialCleared = true;
      await store.clear();
    }

    async function readRunsResponse(response) {
      if (response === null || typeof response !== 'object') {
        fail('github-unreachable', 'GitHub returned no response.');
      }

      if (response.status === 401) {
        await clearCredentialOnce();

        fail('auth-required', 'GitHub rejected the stored credential; sign in again.');
      }

      if (response.status === 403 || response.status === 429) {
        const remaining = headerValue(response, 'x-ratelimit-remaining');

        if (remaining === '0') {
          const resetHeader = headerValue(response, 'x-ratelimit-reset');
          const reset = resetHeader === undefined ? undefined : Number(resetHeader);
          const details =
            reset !== undefined && Number.isFinite(reset) ? { reset } : {};

          fail('rate-limited', 'GitHub API rate limit exceeded.', details);
        }
      }

      if (response.ok === false) {
        fail('github-unreachable', `GitHub responded with HTTP ${response.status}.`);
      }

      let body;

      try {
        body = await response.json();
      } catch {
        fail('github-unreachable', 'GitHub returned an unreadable response.');
      }

      return Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
    }

    const [resolvedActive, resolvedHistory] = await Promise.all([
      activeResult,
      historyResult,
    ]);

    let activeError;
    let activeValue;

    try {
      if (resolvedActive.cached !== undefined) {
        activeValue = {
          runs: resolvedActive.cached.runs,
          fetchedAt: resolvedActive.cached.fetchedAt,
        };
      } else {
        if (resolvedActive.error !== undefined) throw resolvedActive.error;

        const rawRuns = await readRunsResponse(resolvedActive.response);
        const runs = activeRuns(rawRuns, repo.host);
        const fetchedAt = new Date(now()).toISOString();

        activeCache.set(cacheKey, { runs, fetchedAt, fetchedAtMs: now() });
        activeValue = { runs, fetchedAt };
      }
    } catch (error) {
      activeError = error;
    }

    let historyError;
    let historyValue;

    try {
      if (resolvedHistory.cached !== undefined) {
        historyValue = resolvedHistory.cached.history;
      } else {
        if (resolvedHistory.error !== undefined) throw resolvedHistory.error;

        const rawRuns = await readRunsResponse(resolvedHistory.response);
        const history = historyRuns(rawRuns, repo.host, config.historyLimit);

        historyCache.set(cacheKey, { history, fetchedAtMs: now() });
        historyValue = history;
      }
    } catch (error) {
      historyError = error;
    }

    const activeCode = errorCodeOf(activeError);
    const historyCode = errorCodeOf(historyError);

    // A 401 on either read is authoritative: the credential is deleted and the
    // whole snapshot fails.
    if (activeCode === 'auth-required' || historyCode === 'auth-required') {
      fail('auth-required', 'GitHub rejected the stored credential; sign in again.');
    }

    let runs;
    let fetchedAt;
    let stale = false;

    if (activeError !== undefined) {
      // Active-list failures keep their v1 semantics.
      if (['rate-limited', 'invalid-input', 'internal'].includes(activeCode)) {
        throw activeError;
      }

      if (cachedActive !== undefined) {
        runs = cachedActive.runs;
        fetchedAt = cachedActive.fetchedAt;
        stale = true;
      } else {
        throw asHostError(activeError);
      }
    } else {
      runs = activeValue.runs;
      fetchedAt = activeValue.fetchedAt;
    }

    let history;
    let historyWarning;

    if (historyError !== undefined) {
      // A history-only failure never fails the snapshot: keep the previous
      // completed list (or []) and downgrade to a warning.
      history = cachedHistory !== undefined ? cachedHistory.history : [];
      historyWarning =
        'Finished runs could not be refreshed; showing the last known finished runs.';
    } else {
      history = historyValue;
    }

    return {
      ...base,
      runs,
      fetchedAt,
      stale,
      history,
      ...(stale
        ? { warning: 'GitHub could not be read; showing the last cached runs.' }
        : {}),
      ...(historyWarning === undefined ? {} : { historyWarning }),
    };
  }

  const handlers = {
    'githubActions.status': async (payload) => {
      objectPayload(payload);

      return await status();
    },
    'githubActions.begin': async (payload) => {
      objectPayload(payload);

      return await begin();
    },
    'githubActions.poll': async (payload) => {
      objectPayload(payload);

      return await poll();
    },
    'githubActions.cancel': async (payload) => {
      objectPayload(payload);

      return await cancel();
    },
    'githubActions.signOut': async (payload) => {
      objectPayload(payload);

      return await signOut();
    },
    'githubActions.snapshot': async (payload) => await snapshot(payload),
    'githubActions.setClientId': async (payload) => await setClientId(payload),
  };

  return handlers;
}

function asHostError(error) {
  if (
    error instanceof GitHubActionsError &&
    DOCUMENTED_ERROR_CODES.has(error.code)
  ) {
    return error;
  }

  const rawCode =
    error !== null && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : undefined;
  const aborted =
    error !== null &&
    typeof error === 'object' &&
    (error.name === 'AbortError' || error.name === 'TimeoutError');
  const rawMessage =
    error !== null && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : '';
  const details =
    error !== null && typeof error === 'object' && isPlainObject(error.details)
      ? error.details
      : {};

  const code =
    rawCode !== undefined && DOCUMENTED_ERROR_CODES.has(rawCode)
      ? rawCode
      : 'github-unreachable';

  if (code !== 'github-unreachable') {
    return new GitHubActionsError(
      code,
      rawMessage.length > 0 ? rawMessage : 'The GitHub request failed.',
      details,
    );
  }

  const reason = aborted
    ? 'The GitHub request timed out or was aborted.'
    : rawCode !== undefined
      ? `GitHub is unreachable (${rawCode}).`
      : 'GitHub is unreachable.';

  return new GitHubActionsError(
    'github-unreachable',
    `${reason} Check your network connection, then retry.`,
    details,
  );
}

function textResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Validate the frozen envelope (§4) and dispatch one route.
 * A malformed/mismatched envelope is HTTP 400 with a short text body; a
 * malformed payload is a 200 `{ok:false, error:{code:'invalid-input'}}`.
 */
async function handleRequest(request, method, handler) {
  let data;

  try {
    data = await request.json();
  } catch {
    return textResponse(400, 'Malformed request body.');
  }

  const expected = `githubActions.${method}`;

  if (!isPlainObject(data)) {
    return textResponse(400, 'Malformed request envelope.');
  }
  if (data.type !== 'client-request') {
    return textResponse(400, 'Malformed request envelope.');
  }
  if (typeof data.rpcId !== 'string' || data.rpcId.length === 0) {
    return textResponse(400, 'Malformed request envelope.');
  }
  if (typeof data.method !== 'string' || data.method !== expected) {
    return textResponse(400, 'Malformed request envelope.');
  }
  if (!Object.hasOwn(data, 'payload')) {
    return textResponse(400, 'Malformed request envelope.');
  }

  let result;

  try {
    const value = await handler(data.payload);

    result = { ok: true, value };
  } catch (error) {
    const code =
      error !== null && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : 'internal';
    const message =
      error !== null && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : 'Unexpected error.';
    const details =
      error !== null &&
      typeof error === 'object' &&
      isPlainObject(error.details)
        ? error.details
        : {};

    result = { ok: false, error: { code, message, details } };
  }

  return jsonResponse({ type: 'server-response', rpcId: data.rpcId, result });
}

function createGitRunner(timeoutMs) {
  return function runGit(cwd, args) {
    return new Promise((resolve) => {
      execFile(
        'git',
        args,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            LC_ALL: 'C',
            GIT_TERMINAL_PROMPT: '0',
            GIT_ASKPASS: 'echo',
          },
        },
        (error, stdout, stderr) => {
          let exitCode = 0;

          if (error !== null && error !== undefined) {
            exitCode =
              typeof error.code === 'number' && Number.isFinite(error.code)
                ? error.code
                : 1;
          }

          resolve({
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            exitCode,
          });
        },
      );
    });
  };
}

/**
 * Cordis entry point: adapt `ctx` to `createHandlers` and register the seven
 * authenticated Fetch routes.
 */
export function apply(ctx, config) {
  const parsed = normalizeConfig(
    Config(config === undefined || config === null ? {} : config),
  );
  const credentials = ctx.credentials ?? ctx.get?.('credentials');
  const workspaces = ctx.workspaceRegistry ?? ctx.get?.('workspaceRegistry');
  const editor = ctx.get?.('configEditor');
  const gitRun = createGitRunner(parsed.timeoutMs);
  const githubFetch = createTimedFetch(parsed.timeoutMs);
  const handlers = createHandlers({
    config: parsed,
    credentials,
    workspaces,
    editor,
    gitRun,
    githubFetch,
    now: () => Date.now(),
  });

  for (const method of METHODS) {
    const path = `/api/githubActions.${method}`;
    const handler = handlers[`githubActions.${method}`];
    const register = () =>
      ctx.connection.fetch.register({
        path,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleRequest(request, method, handler),
      });

    if (typeof ctx.effect === 'function') ctx.effect(register);
    else register();
  }

  return handlers;
}
