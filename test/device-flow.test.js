/**
 * Unit contract for src/device-flow.js — REQUIREMENTS.md §3 and §9.4.
 *
 * The flow is constructed with injected `post`, `now`, `store`, and `fetchUser`
 * seams; no test performs network I/O or spawns a process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDeviceFlow } from '../src/device-flow.js';

const DEVICE_CODE_RESPONSE = () => ({
  status: 200,
  json: {
    device_code: 'dc-1',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5,
  },
});

const PENDING = () => ({ status: 200, json: { error: 'authorization_pending' } });
const SLOW_DOWN = () => ({ status: 200, json: { error: 'slow_down' } });
const EXPIRED = () => ({ status: 200, json: { error: 'expired_token' } });
const DENIED = () => ({ status: 200, json: { error: 'access_denied' } });
const TOKEN = () => ({
  status: 200,
  json: { access_token: 'gho_flow_secret', token_type: 'bearer', scope: 'repo,read:user' },
});

const STARTED = {
  deviceCode: 'dc-1',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
};

function memoryStore(initial) {
  let record = initial === undefined ? undefined : structuredClone(initial);
  const counts = { write: 0, clear: 0, read: 0 };

  return {
    read() {
      counts.read += 1;

      return record;
    },
    write(next) {
      counts.write += 1;
      record = structuredClone(next);
    },
    clear() {
      counts.clear += 1;
      record = undefined;
    },
    current() {
      return record;
    },
    counts,
  };
}

function normalizeParams(params) {
  if (params === undefined || params === null) return {};
  if (typeof params === 'string') return Object.fromEntries(new URLSearchParams(params));
  if (typeof params.entries === 'function') return Object.fromEntries(params.entries());

  return { ...params };
}

function normalizeHeaders(headers) {
  if (headers === undefined || headers === null) return {};
  if (typeof headers.entries === 'function') {
    return Object.fromEntries(
      [...headers.entries()].map(([key, value]) => [String(key).toLowerCase(), String(value)]),
    );
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [String(key).toLowerCase(), String(value)]));
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );
}

function within(value, ms = 750) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('device-flow call did not settle')), ms);

    Promise.resolve(value).then(
      (settled) => {
        clearTimeout(timer);
        resolve(settled);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function setup(overrides = {}) {
  const clock = { t: overrides.now ?? 0 };
  const posts = [];
  const queue = [];
  const userCalls = [];
  const store = overrides.store ?? memoryStore();

  const deps = {
    post: async (url, params, headers, signal) => {
      posts.push({ url, params, headers, signal });

      const next = queue.shift();

      if (next === undefined) throw new Error(`unexpected GitHub OAuth request to ${url}`);
      if (next instanceof Error) throw next;

      return next;
    },
    now: () => clock.t,
    store,
    fetchUser: async (token, signal) => {
      userCalls.push({ token, signal });

      return { login: 'octocat' };
    },
    // The architecture names four seams but the flow also needs the OAuth app
    // identity; both direct and config-shaped spellings are provided so the
    // flow may read whichever it documents.
    clientId: 'Iv1.test-client',
    scopes: 'repo',
    config: { clientId: 'Iv1.test-client', scopes: 'repo', host: 'github.com' },
    ...overrides,
  };

  return { flow: createDeviceFlow(deps), clock, posts, queue, store, userCalls, deps };
}

async function begin(fixture) {
  fixture.queue.push(DEVICE_CODE_RESPONSE());
  const started = await within(fixture.flow.start());

  assert.deepEqual(started, STARTED);

  return started;
}

test('start posts the device-code request and maps the snake_case response', async () => {
  const fixture = setup();

  await begin(fixture);

  assert.equal(fixture.posts.length, 1);

  const [call] = fixture.posts;

  assert.equal(call.url, 'https://github.com/login/device/code');

  const params = normalizeParams(call.params);

  assert.equal(params.client_id, 'Iv1.test-client');
  assert.equal(params.scope, 'repo');
});

test('status describes a signed-out session without a token', async () => {
  const fixture = setup();
  const status = await within(fixture.flow.status());

  assert.deepEqual(status, {
    signedIn: false,
    login: null,
    scopes: [],
    clientIdConfigured: true,
  });
  assert.equal(Object.hasOwn(status, 'token'), false);
  assert.equal(JSON.stringify(status).includes('gho_'), false);

  const unconfigured = setup({ clientId: '', config: { clientId: '', scopes: 'repo' } });
  const statusWithoutClientId = await within(unconfigured.flow.status());

  assert.equal(statusWithoutClientId.clientIdConfigured, false);
});

test('authorization_pending keeps waiting, honouring the interval between requests', async () => {
  const fixture = setup();

  await begin(fixture);

  // Too early: no request leaves the process, but the caller still learns to wait.
  fixture.clock.t = 4999;
  assert.deepEqual(await within(fixture.flow.poll()), { state: 'pending', interval: 5 });
  assert.equal(fixture.posts.length, 1, 'must not poll before the interval elapses');

  fixture.clock.t = 5000;
  fixture.queue.push(PENDING());
  assert.deepEqual(await within(fixture.flow.poll()), { state: 'pending', interval: 5 });
  assert.equal(fixture.posts.length, 2);
  assert.equal(fixture.store.current(), undefined);

  const [startCall, pollCall] = fixture.posts;

  assert.equal(pollCall.url, 'https://github.com/login/oauth/access_token');

  const pollParams = normalizeParams(pollCall.params);

  assert.equal(pollParams.client_id, 'Iv1.test-client');
  assert.equal(pollParams.device_code, 'dc-1');
  assert.equal(pollParams.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  assert.match(normalizeHeaders(pollCall.headers).accept ?? '', /application\/json/);

  // Nothing about the earlier request leaks into the start request.
  assert.equal(normalizeParams(startCall.params).grant_type, undefined);
});

test('slow_down adds five seconds to the interval and keeps waiting', async () => {
  const fixture = setup();

  await begin(fixture);

  fixture.clock.t = 5000;
  fixture.queue.push(SLOW_DOWN());
  assert.deepEqual(await within(fixture.flow.poll()), { state: 'pending', interval: 10 });

  // The next request is gated by the *new* interval (10s from the slow_down).
  fixture.clock.t = 10000;
  assert.deepEqual(await within(fixture.flow.poll()), { state: 'pending', interval: 10 });
  assert.equal(fixture.posts.length, 2, 'slow_down must lengthen the wait');

  fixture.clock.t = 15000;
  fixture.queue.push(PENDING());
  assert.deepEqual(await within(fixture.flow.poll()), { state: 'pending', interval: 10 });
  assert.equal(fixture.posts.length, 3);

  // A second slow_down adds another five seconds.
  fixture.clock.t = 25000;
  fixture.queue.push(SLOW_DOWN());
  assert.deepEqual(await within(fixture.flow.poll()), { state: 'pending', interval: 15 });
});

test('success stores the credential record exactly once and never returns the token', async () => {
  const fixture = setup();

  await begin(fixture);

  fixture.clock.t = 5000;
  fixture.queue.push(TOKEN());
  const authorized = await within(fixture.flow.poll());

  assert.deepEqual(authorized, {
    state: 'authorized',
    auth: {
      signedIn: true,
      login: 'octocat',
      scopes: ['repo', 'read:user'],
      clientIdConfigured: true,
    },
  });
  assert.equal(JSON.stringify(authorized).includes('gho_flow_secret'), false);

  assert.equal(fixture.store.counts.write, 1, 'the grant is stored exactly once');

  const record = fixture.store.current();

  assert.equal(record.kind, 'grant');
  assert.equal(record.payload.token, 'gho_flow_secret');
  assert.equal(record.payload.tokenType, 'bearer');
  assert.deepEqual(record.payload.scopes, ['repo', 'read:user']);
  assert.equal(record.payload.login, 'octocat');
  assert.equal(Object.hasOwn(record.payload, 'obtainedAt'), true);
  assert.equal(fixture.userCalls.length, 1);
  assert.equal(fixture.userCalls[0].token, 'gho_flow_secret');

  const status = await within(fixture.flow.status());

  assert.deepEqual(status, {
    signedIn: true,
    login: 'octocat',
    scopes: ['repo', 'read:user'],
    clientIdConfigured: true,
  });
  assert.equal(JSON.stringify(status).includes('gho_flow_secret'), false);
  assert.equal(Object.hasOwn(status, 'token'), false);

  // A later poll reuses the completed attempt instead of talking to GitHub again.
  const after = await within(fixture.flow.poll());

  assert.equal(after.state, 'authorized');
  assert.equal(fixture.posts.length, 2);
  assert.equal(fixture.store.counts.write, 1);
  assert.equal(JSON.stringify(after).includes('gho_flow_secret'), false);
});

test('success accepts a space-separated scope response', async () => {
  const fixture = setup();

  await begin(fixture);
  fixture.clock.t = 5000;
  fixture.queue.push({
    status: 200,
    json: { access_token: 'gho_flow_secret', token_type: 'bearer', scope: 'repo read:user' },
  });

  const authorized = await within(fixture.flow.poll());

  assert.deepEqual(authorized.auth.scopes, ['repo', 'read:user']);
  assert.deepEqual(fixture.store.current().payload.scopes, ['repo', 'read:user']);
});

test('expired_token and access_denied are reported without storing a credential', async () => {
  for (const [response, expected] of [
    [EXPIRED, { state: 'expired' }],
    [DENIED, { state: 'denied' }],
  ]) {
    const fixture = setup();

    await begin(fixture);
    fixture.clock.t = 5000;
    fixture.queue.push(response());

    const result = await within(fixture.flow.poll());

    assert.deepEqual(result, expected);
    assert.equal(fixture.store.counts.write, 0);
    assert.equal(fixture.store.current(), undefined);
    assert.equal(JSON.stringify(result).includes('gho_'), false);
  }
});

test('the local expiry window ends the attempt without touching GitHub', async () => {
  const fixture = setup();

  await begin(fixture);

  fixture.clock.t = 899999;
  fixture.queue.push(PENDING());
  assert.deepEqual(await within(fixture.flow.poll()), { state: 'pending', interval: 5 });

  fixture.clock.t = 900001;
  assert.deepEqual(await within(fixture.flow.poll()), { state: 'expired' });
  assert.equal(fixture.posts.length, 2, 'an expired attempt must not call GitHub again');
  assert.equal(fixture.store.current(), undefined);
});

test('hard failures are reported and never retried silently', async () => {
  const failureResponses = [
    { status: 200, json: { error: 'invalid_grant' } },
    { status: 200, json: { error: 'incorrect_client_credentials' } },
    { status: 200, json: { error: 'unsupported_grant_type' } },
    { status: 500, json: {} },
    new Error('network down'),
  ];

  for (const response of failureResponses) {
    const fixture = setup();

    await begin(fixture);
    fixture.clock.t = 5000;
    fixture.queue.push(response);

    await assert.rejects(within(fixture.flow.poll()));
    assert.equal(fixture.posts.length, 2, 'must not retry silently');
    assert.equal(fixture.store.counts.write, 0);
    assert.equal(fixture.store.current(), undefined);
  }
});

test('cancel abandons a pending attempt and leaves the status signed out', async () => {
  const fixture = setup();

  await begin(fixture);

  const canceled = await within(fixture.flow.cancel());

  assert.equal(canceled.signedIn, false);

  const status = await within(fixture.flow.status());

  assert.deepEqual(status, {
    signedIn: false,
    login: null,
    scopes: [],
    clientIdConfigured: true,
  });

  // Cancelling without an attempt is harmless.
  const idle = setup();
  const idleCancel = await within(idle.flow.cancel());

  assert.equal(idleCancel.signedIn, false);
});

test('signOut clears the stored grant and reports a signed-out status', async () => {
  const fixture = setup();

  await begin(fixture);
  fixture.clock.t = 5000;
  fixture.queue.push(TOKEN());
  await within(fixture.flow.poll());

  const signedOut = await within(fixture.flow.signOut());

  assert.equal(signedOut.signedIn, false);
  assert.equal(signedOut.login, null);
  assert.deepEqual(signedOut.scopes, []);
  assert.equal(fixture.store.current(), undefined);
  assert.equal(fixture.store.counts.clear, 1);
  assert.equal(JSON.stringify(signedOut).includes('gho_flow_secret'), false);
});

test('status reads a stored grant without exposing the token', async () => {
  const store = memoryStore({
    kind: 'grant',
    payload: {
      token: 'gho_seeded',
      tokenType: 'bearer',
      scopes: ['repo'],
      login: 'octocat',
      obtainedAt: '2026-01-02T03:04:05.000Z',
    },
  });
  const fixture = setup({ store });
  const status = await within(fixture.flow.status());

  assert.deepEqual(status, {
    signedIn: true,
    login: 'octocat',
    scopes: ['repo'],
    clientIdConfigured: true,
  });
  assert.equal(JSON.stringify(status).includes('gho_seeded'), false);
  assert.equal(Object.hasOwn(status, 'token'), false);
});
