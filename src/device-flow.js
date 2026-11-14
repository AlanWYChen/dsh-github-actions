/**
 * Pure GitHub OAuth device-flow state machine — REQUIREMENTS.md §3 and §9.4.
 *
 * All I/O is injected (`post`, `fetchUser`, `store`, `now`); the flow itself
 * touches no network and never hands the access token to a caller. `status()`
 * and every `poll()` result are token-free by construction.
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const HARD_OAUTH_ERRORS = new Set([
  'invalid_grant',
  'incorrect_client_credentials',
  'unsupported_grant_type',
  'device_flow_disabled',
  'unauthorized_client',
  'invalid_client',
]);

function flowError(code, message, details = {}) {
  const error = new Error(message);

  error.name = 'GitHubActionsDeviceFlowError';
  error.code = code;
  error.details = details;

  return error;
}

function option(value, fallback) {
  if (typeof value === 'function') {
    try {
      return value();
    } catch {
      return fallback;
    }
  }

  return value === undefined ? fallback : value;
}

function splitScopes(value) {
  if (typeof value !== 'string') return [];

  return value
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

async function readStatus(store, clientIdConfigured) {
  const record = await store.read();
  const grant =
    record !== null &&
    typeof record === 'object' &&
    record.kind === 'grant' &&
    record.payload !== null &&
    typeof record.payload === 'object' &&
    typeof record.payload.token === 'string'
      ? record.payload
      : undefined;

  return {
    signedIn: grant !== undefined,
    login: grant !== undefined && typeof grant.login === 'string' ? grant.login : null,
    scopes: grant !== undefined && Array.isArray(grant.scopes) ? [...grant.scopes] : [],
    clientIdConfigured,
  };
}

/**
 * @param {object} deps
 * @param {(url: string, params: object, headers: object, signal?: AbortSignal) => Promise<{status: number, json: object}>} deps.post
 * @param {() => number} [deps.now] epoch milliseconds
 * @param {{read: Function, write: Function, clear: Function}} deps.store
 * @param {(token: string, signal?: AbortSignal) => Promise<{login?: string}>} [deps.fetchUser]
 * @param {string | (() => string)} [deps.clientId]
 * @param {string | (() => string)} [deps.scopes]
 * @param {{clientId?: string, scopes?: string}} [deps.config] alternate spelling
 */
export function createDeviceFlow(deps = {}) {
  const post = deps.post;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const store = deps.store;
  const fetchUser = typeof deps.fetchUser === 'function' ? deps.fetchUser : undefined;

  const clientId = () =>
    String(option(deps.clientId, option(deps.config?.clientId, '')) ?? '').trim();
  const scopes = () =>
    String(option(deps.scopes, option(deps.config?.scopes, 'repo')) ?? '').trim();
  const clientIdConfigured = () => clientId().length > 0;

  let attempt = null;

  const status = () => readStatus(store, clientIdConfigured());

  async function start(signal) {
    if (!clientIdConfigured()) {
      throw flowError('no-client-id', 'A GitHub OAuth App client ID is not configured.');
    }

    attempt = null;

    const response = await post(
      DEVICE_CODE_URL,
      { client_id: clientId(), scope: scopes() },
      { Accept: 'application/json' },
      signal,
    );

    let json;

    try {
      json =
        response !== null &&
        typeof response === 'object' &&
        response.json !== null &&
        typeof response.json === 'object'
          ? response.json
          : {};
    } catch {
      json = {};
    }

    if (json !== null && typeof json === 'object' && json.error === 'device_flow_disabled') {
      throw flowError(
        'device-flow-disabled',
        'GitHub device flow is disabled for this OAuth App. Open https://github.com/settings/developers, select the app, tick "Enable Device Flow", and click "Update application".',
        { setupUrl: 'https://github.com/settings/developers' },
      );
    }

    if (!response || (typeof response.status === 'number' && response.status >= 400)) {
      throw flowError('github-unreachable', 'GitHub rejected the device-code request.');
    }

    if (!json || typeof json !== 'object') {
      throw flowError('github-unreachable', 'GitHub returned an unreadable device-code response.');
    }

    if (typeof json.error === 'string' && json.error.length > 0) {
      throw flowError('github-unreachable', `GitHub device-code request failed: ${json.error}`);
    }

    if (typeof json.device_code !== 'string' || typeof json.user_code !== 'string') {
      throw flowError('github-unreachable', 'GitHub returned an incomplete device-code response.');
    }

    const interval = Math.max(1, Number(json.interval) || 5);
    const expiresIn = Math.max(1, Number(json.expires_in) || 900);
    const startedAt = now();

    attempt = {
      deviceCode: json.device_code,
      userCode: json.user_code,
      verificationUri:
        typeof json.verification_uri === 'string' ? json.verification_uri : '',
      expiresIn,
      interval,
      nextPollAt: startedAt + interval * 1000,
      expiresAt: startedAt + expiresIn * 1000,
      state: 'pending',
    };

    return {
      deviceCode: attempt.deviceCode,
      userCode: attempt.userCode,
      verificationUri: attempt.verificationUri,
      expiresIn: attempt.expiresIn,
      interval: attempt.interval,
    };
  }

  async function poll(signal) {
    if (attempt === null) {
      throw flowError('auth-required', 'No GitHub sign-in is in progress.');
    }

    if (attempt.state === 'authorized') {
      return { state: 'authorized', auth: await status() };
    }
    if (attempt.state === 'expired') return { state: 'expired' };
    if (attempt.state === 'denied') return { state: 'denied' };

    const moment = now();

    if (moment > attempt.expiresAt) {
      attempt.state = 'expired';

      return { state: 'expired' };
    }

    if (moment < attempt.nextPollAt) {
      return { state: 'pending', interval: attempt.interval };
    }

    const response = await post(
      ACCESS_TOKEN_URL,
      {
        client_id: clientId(),
        device_code: attempt.deviceCode,
        grant_type: DEVICE_GRANT_TYPE,
      },
      { Accept: 'application/json' },
      signal,
    );

    if (!response || (typeof response.status === 'number' && response.status >= 400)) {
      attempt.state = 'failed';

      throw flowError('github-unreachable', 'GitHub rejected the access-token request.');
    }

    const json = response.json !== null && typeof response.json === 'object' ? response.json : {};

    if (typeof json.access_token === 'string' && json.access_token.length > 0) {
      const token = json.access_token;
      const tokenType = typeof json.token_type === 'string' ? json.token_type : 'bearer';
      const granted = splitScopes(json.scope);

      let login = null;

      if (fetchUser !== undefined) {
        const user = await fetchUser(token, signal);

        if (user !== null && typeof user === 'object' && typeof user.login === 'string') {
          login = user.login;
        }
      }

      // The grant is written exactly once; a later poll reuses the attempt.
      await store.write({
        kind: 'grant',
        payload: {
          token,
          tokenType,
          scopes: granted,
          login,
          obtainedAt: new Date(now()).toISOString(),
        },
      });

      attempt.state = 'authorized';

      return { state: 'authorized', auth: await status() };
    }

    const error = typeof json.error === 'string' ? json.error : '';

    if (error === 'authorization_pending') {
      attempt.nextPollAt = now() + attempt.interval * 1000;

      return { state: 'pending', interval: attempt.interval };
    }

    if (error === 'slow_down') {
      attempt.interval += 5;
      attempt.nextPollAt = now() + attempt.interval * 1000;

      return { state: 'pending', interval: attempt.interval };
    }

    if (error === 'expired_token') {
      attempt.state = 'expired';

      return { state: 'expired' };
    }

    if (error === 'access_denied') {
      attempt.state = 'denied';

      return { state: 'denied' };
    }

    attempt.state = 'failed';

    throw flowError(
      HARD_OAUTH_ERRORS.has(error) ? 'auth-required' : 'github-unreachable',
      `GitHub sign-in failed: ${error.length > 0 ? error : 'unknown error'}`,
    );
  }

  async function cancel() {
    attempt = null;

    return status();
  }

  async function signOut() {
    attempt = null;
    await store.clear();

    return status();
  }

  return { start, poll, cancel, signOut, status };
}
