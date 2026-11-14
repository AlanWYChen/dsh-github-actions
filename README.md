# GitHub Actions for DSH

A DSH Web bundle that shows, live, the GitHub Actions workflow runs that are
**currently running or queued** for the workspace selected in the Harness UI,
plus a **Recent** list of the last finished runs, when that workspace is
connected to a GitHub repository. Clicking any run opens it on GitHub.

The package ships both halves:

- **Host** (`src/index.js`) — resolves the workspace checkout, reads GitHub over
  HTTPS, presents seven authenticated `/api/githubActions.*` RPC routes, and
  keeps the OAuth access token on the Host only.
- **Client** (`src/client.js`) — a "GitHub Actions" sidebar panel and main page,
  registered through the Harness module loader. It talks to the Host only
  through the authenticated `/api` bridge and polls the snapshot while mounted
  and visible.

## How it works

1. The panel asks the Host for a `snapshot` of the selected workspace.
2. The Host looks for a git checkout at/above the workspace path, reads
   `git remote -v`, and picks the GitHub remote (a remote with upstream tracking
   evidence first, then `origin`, then declaration order).
3. When signed in, the Host issues **two** GitHub reads for the repository:
   - active runs: `GET .../actions/runs?per_page=50`, keeping only
     `queued`, `in_progress`, `requested`, `waiting`, `pending`, newest first,
     capped at 20, cached per repository for `refreshMs`;
   - finished runs: `GET .../actions/runs?status=completed&per_page={historyLimit}`,
     newest `completedAt` first, capped at `historyLimit`, cached independently
     for `historyRefreshMs`.
   A history-only failure never fails the snapshot: the last finished list (or
   an empty one) is kept and a `historyWarning` is added. A 401 on either read
   still signs the user out.
4. The Client re-fetches every `pollMs` while the page is mounted and the
   document is visible. The page always shows two sections: **Running** (runs
   that are still active) and **Recent** (the finished runs, each with a
   conclusion pill such as Success, Failed, or Timed out). Clicking or pressing
   Enter/Space on a row opens the run on GitHub in a new tab.

Authentication uses the GitHub **OAuth device flow**, so there is no client
secret, no redirect handling, and no password typed into the panel. The token is
stored in the Host credential store and is never sent to the browser.

## Create the GitHub OAuth App (one time)

1. Open **GitHub → Settings → Developer settings → OAuth Apps** (or directly
   <https://github.com/settings/developers>) and choose **New OAuth App**.
2. Fill in the form:
   - **Application name** — anything, for example `DSH GitHub Actions`.
   - **Homepage URL** — `http://127.0.0.1:3080` (this profile's DSH Web GUI
     origin).
   - **Authorization callback URL** — `http://127.0.0.1:3080`. The device flow
     never redirects, so it is never used; GitHub only requires the field to be
     non-empty. (Do not leave it blank — GitHub rejects the form.)
   - **Enable Device Flow** — **tick this checkbox**. This is required; without
     it every sign-in attempt fails with `device_flow_disabled` (HTTP 400) from
     `begin`.
   - **Expire user access tokens** — leave **disabled/unchecked** for the
     prototype. A non-expiring token keeps the panel connected.
3. Click **Register application** (or **Update application** when editing an
   existing app).
4. On the app page, copy the **Client ID** (for example
   `Ov23lioKDGMGDQLQXTIz`). No client secret is needed.

> **If device flow is disabled:** GitHub answers `begin` with HTTP 400 and
> `{"error":"device_flow_disabled"}`. The plugin surfaces this as the
> `device-flow-disabled` error code, and the page shows an actionable banner
> with a one-click link to <https://github.com/settings/developers>. Tick
> **Enable Device Flow** on the app, click **Update application**, then retry.
>
> **If you enabled token expiry anyway:** tokens last 8 hours (GitHub shows the
> expiry on the app settings page) and the device flow returns no refresh
> token. After expiry the panel's reads fail with `auth-required`; recover by
> signing out in the panel and signing in again.

## Install and enable in this DSH profile

From this repository:

```sh
# inside the DSH profile that runs http://127.0.0.1:3080
dsh plugin add "/path/to/dsh-github-intergration"
```

or install the bundle from the Web GUI's plugin manager by pointing it at this
directory (the package is `@local/dsh-github-actions`). The bundle inserts one
Host row:

```yaml
- insert:
    - id: github-actions
      name: '@local/dsh-github-actions'
```

After enabling the bundle, the **GitHub Actions** entry appears in the sidebar
(order 30). Open it.

## Sign in from the panel

1. Open the **GitHub Actions** panel.
2. With no `clientId` configured, the setup surface appears. Paste the OAuth App
   **Client ID** into the input and press **Save**. This persists the value
   through `githubActions.setClientId` into the plugin config row — no YAML
   editing and no Host restart required.
3. Press **Sign in with GitHub**. The panel shows a short `userCode` and an
   **Open GitHub** link. Enter the code on GitHub and authorize the app.
4. The panel polls no faster than the interval GitHub returns (and backs off by
   5 seconds on `slow_down`). When authorization completes, the account login
   appears and the run list loads.
5. **Sign out** in the panel deletes the stored credential.

## Troubleshooting

### Sign-in says "device flow is disabled"

GitHub answers `githubActions.begin` with HTTP 400 and
`{"error":"device_flow_disabled"}` when the OAuth App does not have device flow
enabled. The Host reports this as the actionable `device-flow-disabled` error
and the panel shows a one-click link to the app settings.

1. Open <https://github.com/settings/developers> → **OAuth Apps** → your app.
2. Tick **Enable Device Flow**.
3. Click **Update application**, then press **Sign in with GitHub** again.

### Sign-in stopped working after a while

If you enabled **Expire user access tokens**, the token lasts 8 hours and device
flow returns no refresh token. Sign out in the panel and sign in again. For a
long-lived prototype, disable token expiry (see above).

## Configuration

All fields are optional; the defaults are shown.

| Key | Default | Meaning |
| --- | --- | --- |
| `clientId` | `''` | GitHub OAuth App client ID. Empty means sign-in cannot start and the panel shows setup instructions. |
| `scopes` | `'repo'` | Space-separated OAuth scopes. Add `read:user` if needed; `repo` is required for private-repository visibility. |
| `host` | `'github.com'` | GitHub host used for remote parsing and web URLs (GitHub Enterprise is configurable but not exercised in v1). |
| `apiBaseUrl` | `'https://api.github.com'` | GitHub REST base URL. |
| `refreshMs` | `3000` | Host-side per-repository active-runs cache TTL. |
| `pollMs` | `5000` | Client poll interval; clamped to be at least `refreshMs`. |
| `timeoutMs` | `10000` | Per GitHub HTTP request timeout. |
| `historyLimit` | `20` | How many finished runs the Recent section shows (integer, clamped to 1–100); also the `per_page` of the history read. |
| `historyRefreshMs` | `15000` | Host-side per-repository finished-runs cache TTL, independent of `refreshMs`. |

Example row config:

```yaml
- id: github-actions
  name: '@local/dsh-github-actions'
  config:
    clientId: 'Ov23lioKDGMGDQLQXTIz'
    scopes: 'repo'
    host: 'github.com'
    apiBaseUrl: 'https://api.github.com'
    refreshMs: 3000
    pollMs: 5000
    timeoutMs: 10000
    historyLimit: 20
    historyRefreshMs: 15000
```

## RPC surface (Host → Client)

Every route is `POST /api/githubActions.<method>`, registered with
`methods: ['POST']` and `requestBody: 'buffered'` on the authenticated `/api`
bridge. Requests use the `client-request` envelope and answers use the
`server-response` envelope; a malformed or mismatched envelope is HTTP 400 with
a short text body, and a malformed payload is `ok:false` with
`error.code: 'invalid-input'`.

| Method | Payload | Value |
| --- | --- | --- |
| `status` | `{}` | `AuthStatus` |
| `begin` | `{}` | `{deviceCode, userCode, verificationUri, expiresIn, interval}` |
| `poll` | `{}` | `{state:'authorized', auth}` \| `{state:'pending', interval}` \| `{state:'expired'}` \| `{state:'denied'}` |
| `cancel` | `{}` | `AuthStatus` |
| `signOut` | `{}` | `AuthStatus` |
| `snapshot` | `{workspaceId, refresh?}` | `Snapshot` |
| `setClientId` | `{clientId}` | `AuthStatus` |

`Snapshot` carries both lists: `runs` (active only) and `history` (finished runs,
newest `completedAt` first, at most `historyLimit`). `refresh: true` bypasses
both host caches. When only the history read fails, the response still succeeds
with the previous `history` (or `[]`) and a `historyWarning` string; the Client
renders that warning above the Recent rows.

Error codes: `no-client-id`, `auth-required`, `rate-limited`,
`github-unreachable`, `no-git`, `workspace-missing`, `not-signed-in`,
`invalid-input`, `internal`, `config-unavailable`, and the actionable
`device-flow-disabled`.

## Security notes

- The access token lives only on the Host (the DSH credential store, key
  `github-actions/oauth`). It is never returned to the Client, never included in
  an RPC error, and never logged.
- All browser traffic goes through the authenticated `/api` bridge; there is no
  unauthenticated route.
- Client payloads are validated before use (`workspaceId`, `refresh`,
  `clientId`), with hand-rolled validation and no extra dependency.
- `owner`/`name`/`host` are validated against GitHub-safe characters before
  being interpolated into a URL or a git invocation.
- Git is invoked via `execFile` with a scrubbed environment and a timeout; the
  plugin spawns no shell.

## Limitations (v1.1)

- The Running section lists only active runs (queued, in progress, requested,
  waiting, pending). Finished runs appear in Recent, capped at `historyLimit`
  and never paginated beyond that.
- `defaultBranch` is always `null` (v1 makes no extra API call).
- No branch management, commits, push/pull, logs, per-step progress, re-run,
  cancellation, PRs, notifications, or multi-account support.
- GitHub Enterprise beyond a configurable `host`/`apiBaseUrl` is not exercised.
- Manual repository selection (`source: 'manual'`) is modeled but not exposed.
- The panel is read-only apart from auth/config actions.

## Tests

The only runtime dependency is `schemastery` (declared in `package.json` and
resolved from the DSH install/profile; the workspace `node_modules/schemastery`
dev symlink is not packaged). Everything else uses Node built-ins and the global
`fetch`.

```sh
node scripts/run-tests.mjs all
```
