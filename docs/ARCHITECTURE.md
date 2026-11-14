# Architecture and test seams — v1

This file tells the test author and the implementer how the frozen contract in
[`REQUIREMENTS.md`](../REQUIREMENTS.md) is split into modules, and exactly where a test
may substitute a fake dependency. It adds no behavior: the requirements file wins on any
conflict.

## Runtime picture

```
Harness Host (Node)                                  Browser (Web GUI)
┌──────────────────────────────────────────┐         ┌──────────────────────────────────┐
│ src/index.js  apply(ctx, config)         │         │ src/client.js                    │
│  ├ src/device-flow.js  (pure, injectable)│         │  sidebar.panellist → icon        │
│  ├ src/remotes.js      (pure)            │         │  main → GitHub Actions page      │
│  ├ src/runs.js         (pure)            │         │  ├ connects via ctx.connection   │
│  └ src/git.js          (spawn → execa)   │         │  │  .rpc.call('/api',           │
│                                          │  /api   │  │     'githubActions.<m>', …) │
│  ctx.connection.fetch.register(7 routes) │◄────────┤  └ polls while mounted/visible   │
│  ctx.credentials.modifyRecord/readRecord │         └──────────────────────────────────┘
│  ctx.workspaceRegistry                   │
│  ctx.get('configEditor')                 │
└──────────────────────────────────────────┘
```

All browser traffic uses the authenticated `/api` bridge (`ctx.connection.rpc.call` on the
Client, `ctx.connection.fetch.register` on the Host), exactly like
`@local/dsh-agent-activity-intelligence` does today.

## Module boundaries and injected seams

### `src/remotes.js` — pure, no I/O

Exports at least:

- `parseGitHubRemote(url, host = 'github.com')` → `{ host, owner, name } | undefined`
- `parseRemoteLines(text)` → `Array<{ name, url, kind }>` for `git remote -v` output
- `pickGitHubRemote(remotes, host)` → `{ name, repo } | undefined`
  (order: remote with upstream tracking evidence, then `origin`, then declaration order).
  Upstream evidence must be passed in, not discovered: the signature is
  `pickGitHubRemote(remotes, host, upstreamBranchOf)` where `upstreamBranchOf(remoteName)`
  returns `string | null`; it is a seam the Host fills from
  `git rev-parse --abbrev-ref <remote>/<branch>@{upstream}`-class information. A simpler
  equivalent seam is acceptable while the observable order in §9.2 is preserved.
- `isSafeSegment(value)` — `^[A-Za-z0-9_.-]+$`, not `.`/`..`.
- URL builders for repo/runs/workflow pages (the only place URLs are built).

Never spawns processes, never fetches.

### `src/runs.js` — pure, no I/O

- `mapWorkflowRun(raw, host)` → `Run` from the GitHub REST shape
  (`id`, `name`, `workflow_name`/`name`, `status`, `conclusion`, `event`,
  `head_branch`, `actor.login`, `run_number`, `created_at`, `run_started_at`,
  `html_url`, `workflow_id`, `path`).
- `isActiveStatus(status)`.
- `activeRuns(rawRuns, host, limit = 20)` → filtered, newest-`createdAt`-first, capped.
- Tolerant of unknown statuses (drop them) and missing optional fields.

Never fetches.

### `src/device-flow.js` — pure state machine, injectable I/O

```js
export function createDeviceFlow({ post, now, store, fetchUser }) { … }
```

- `post(url, params, headers, signal)` → `{ status, json }` (injected; the Host passes
  the real `fetch`-based one).
- `now()` → epoch milliseconds (injected, for expiry and interval accounting).
- `store` → `{ read(), write(record), clear() }` (injected; the Host passes the
  `ctx.credentials` adapter, in memory during tests).
- `fetchUser(token, signal)` → `{ login }` (injected).

Methods: `start(signal)`, `poll(signal)`, `cancel()`, `status()`, `signOut()`.
Owns the `interval`/`slow_down`/expiry rules from §3; the token never leaves `store`.

### `src/git.js` — process seam

`detectCheckout({ run, workspacePath, host })` → `{ repoStatus, repo, remotes }`.
`run(args, options)` is injected: `(cwd, args) => Promise<{ stdout, stderr, exitCode }>`.
The Host's real `run` uses `execa` with a scrubbed environment and `timeoutMs`-class
timeouts. Tests pass a fake `run`; nothing in this file touches the network.

### `src/index.js` — composition root

- Exports `apply`, `inject`, `Config`.
- Builds the flow/git/github adapters from injected, exported factory seams so a unit
  test can construct the same RPC handler table without `ctx`:
  **`export function createHandlers(deps)`** where `deps = { config, credentials,
  workspaces, editor, gitRun, githubFetch, now }`. `apply` wires `ctx` to
  `createHandlers` and registers the routes. This is the preferred test seam: the
  acceptance tests call `createHandlers` directly and through the registered routes.
- Registers the 7 routes (`status`, `begin`, `poll`, `cancel`, `signOut`, `snapshot`,
  `setClientId`) with envelope validation.

### `src/client.js` — browser half

`window.__ModuleLoader__.load({ id, factory(require) })`; `require('react')` only.
Exports (for tests, through the factory's returned module) the registration list and the
pure view-model helpers, for example:

- `describeState(snapshot)` → `{ kind: 'setup' | 'signed-out' | 'no-checkout' |
  'no-remote' | 'not-github' | 'ready' | 'error', titleKey, … }`.
- `nextPollDelay(config)` / `visibleRuns(snapshot)` where useful.
- `apply(ctx)` registers `sidebar.panellist` (id `github-actions`, order 30) and `main`
  (key `github-actions`), registers the `github-actions` locale dictionaries, and calls
  `ctx.connection.rpc.call`.

Tests load the file in a `vm` context with `window.__ModuleLoader__.load` and
`require('react')` stubs, reproducing the Harness module-loader contract.

## Configuration plumbing

`Config` is the Schemastery-style export used by other bundles. `apply(ctx, config)`
receives the parsed value; `createHandlers` receives the same shape. Defaults are in §7
of the requirements. `clientId` may be changed at runtime by `setClientId`.

## Test layering (what the test author writes)

1. **Unit** (`test/remotes.test.js`, `test/runs.test.js`, `test/device-flow.test.js`):
   the pure modules against table-driven cases from §9.1–§9.4.
2. **Host contract** (`test/host.test.js`): `createHandlers` with fake `credentials`,
   `workspaces`, `editor`, `gitRun`, `githubFetch`, `now`, plus one test that goes
   through `ctx.connection.fetch.register` and the real envelope, reproducing the
   activity-intelligence harness pattern.
3. **Client** (`test/client.test.js`): the module-loader contract, locale registration,
   both slot registrations, `describeState` for every state in §5, poll scheduling
   (no faster than `pollMs`, stops when hidden/unmounted), row activation opening the
   run URL, and the setup form saving a client ID.

Test runner: `node --test` with a `scripts/run-tests.mjs` that mirrors the sibling
`dsh-agent-activity-intelligence` project (`all`/`unit`/`integration` groups).
No test may perform real network I/O; port-0 HTTP is allowed only if a test needs a
real socket.

## Protected artifacts (frozen after RED)

- Every file under `test/`
- `scripts/run-tests.mjs`
- Any fixtures the tests add under `test/fixtures/`

The implementer may not edit these; only explicit user approval reopens them.
