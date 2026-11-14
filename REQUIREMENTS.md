# GitHub Actions for DSH — v1 contract

Status: frozen requirements for the v1 prototype. This file is the single source of
truth for behavior. Tests and implementation are derived from it.

## 1. Purpose

A persistent DSH Web bundle that connects to the user's GitHub account and shows, live,
the GitHub Actions runs that are **currently running (or queued)** for the workspace
(project) selected in the Harness UI, when that workspace is connected to a GitHub
repository. Clicking a run opens that run on GitHub.

Explicitly **out of scope for v1** (later increments): branch management, commits,
push/pull, logs and per-step progress, job re-run/cancel, PRs, notifications,
multi-account, GitHub Enterprise beyond a configurable base URL.

## 2. Package

- Name `@local/dsh-github-actions`, id `github-actions`, a Cordis **bundle** that inserts
  one Host row; the same package ships the Client half (`./client`).
- Host half: `src/index.js` — `export function apply(ctx, config)` plus
  `export const inject = [...]` and `export const Config`.
- Client half: `src/client.js` — `window.__ModuleLoader__.load({ id, factory(require) })`.
- Pure modules (no Cordis/`ctx`): `src/remotes.js`, `src/runs.js`, `src/device-flow.js`.
- Locale resources `locale/en.json`, `locale/zh.json`, original `icon.svg`,
  `cordis.patch.yml`, `package.json` with `dsh.bundle.patch` and `dsh.client`.

## 3. GitHub authentication — OAuth device flow

The plugin authenticates with a **GitHub OAuth App client ID** (public; no client
secret) supplied through plugin config. The access token is obtained by the device flow,
never typed by hand, and is stored on the Host only.

- Config field `clientId` (string, default `''`): the OAuth app client ID.
  When empty, sign-in cannot start and the Client shows setup instructions.
- Config field `scopes` (string, default `'repo'`): space-separated OAuth scopes.
  `read:user` may be added; `repo` is required for any private-repository visibility.
- Device flow (Host → GitHub):
  1. `POST https://github.com/login/device/code` with `client_id`, `scope`.
  2. Response: `device_code`, `user_code`, `verification_uri`, `expires_in`,
     `interval` (seconds).
  3. Poll `POST https://github.com/login/oauth/access_token` with
     `client_id`, `device_code`, `grant_type=urn:ietf:params:oauth:grant-type:device_code`
     and header `Accept: application/json`, after at least `interval` seconds, honoring
     GitHub's rules:
     - `authorization_pending` → keep waiting.
     - `slow_down` → add 5 seconds to the interval and keep waiting.
     - `expired_token` → the attempt is expired; report `expired`.
     - `access_denied` → the user declined; report `denied`.
     - `incorrect_client_credentials` / `unsupported_grant_type` /
       `invalid_grant` / HTTP failure → report the failure; do not retry silently.
  4. Success response: `access_token`, `token_type`, `scope` (comma- or
     space-separated). Store a credential record.
- Credential store: `ctx.credentials.modifyRecord(credentialKey('github-actions',
  'oauth'), …)` with a `{ kind: 'grant', payload: { token, tokenType, scopes, login,
  obtainedAt } }` record. `login` is filled from `GET /user` after the token is
  obtained. Deleting the record signs out.
- The access token is **never** returned to the Client and never written to logs.

## 4. Host ↔ Client transport

The Host registers exact Fetch routes through `ctx.connection.fetch.register` (the
authenticated `/api` bridge), one route per method, path
`/api/githubActions.<method>`, `methods: ['POST']`, `requestBody: 'buffered'`.

Request envelope: `{ "type": "client-request", "rpcId": string, "method":
"githubActions.<method>", "payload": object }`.
Response envelope: `{ "type": "server-response", "rpcId": string, "result": { "ok":
true, "value": T } | { "ok": false, "error": { "code": string, "message": string,
"details": object } } }`.

A malformed/mismatched envelope answers HTTP 400 with a short text body. A malformed
payload answers `ok:false` with code `invalid-input`.

Methods:

| method | payload | value |
| --- | --- | --- |
| `githubActions.status` | `{}` | `AuthStatus` |
| `githubActions.begin` | `{}` | `{ deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }` |
| `githubActions.poll` | `{}` | `{ state: 'authorized'; auth: AuthStatus } \| { state: 'pending'; interval: number } \| { state: 'expired' } \| { state: 'denied' }` |
| `githubActions.cancel` | `{}` | `AuthStatus` |
| `githubActions.signOut` | `{}` | `AuthStatus` |
| `githubActions.snapshot` | `{ workspaceId: string; refresh?: boolean }` | `Snapshot` |

```ts
interface AuthStatus {
  signedIn: boolean
  login: string | null           // GitHub login when known
  scopes: string[]               // granted scopes, [] when unknown
  clientIdConfigured: boolean
}

interface Snapshot {
  workspace: { id: string; title: string; path: string }
  repo: {
    host: string                 // 'github.com'
    owner: string
    name: string
    slug: string                 // 'owner/name'
    webUrl: string               // 'https://github.com/owner/name'
    defaultBranch: string | null
    source: 'remote' | 'manual'
  } | null
  repoStatus: 'ok' | 'no-checkout' | 'no-remote' | 'not-github'
  auth: AuthStatus
  runs: Run[]
  fetchedAt: string | null       // ISO time of the GitHub read, null when not read
  stale: boolean                 // true when runs came from cache older than the TTL
}

interface Run {
  id: number
  name: string                   // workflow run display name
  workflowName: string
  status: 'queued' | 'in_progress' | 'requested' | 'waiting' | 'pending'
  conclusion: null               // always null for active runs
  event: string
  branch: string | null
  actor: string | null
  number: number | null
  createdAt: string              // ISO
  startedAt: string | null       // ISO
  htmlUrl: string                // run page on GitHub
  workflowUrl: string | null     // workflow file page on GitHub
}
```

`runs` is every run in an active status (`queued`, `in_progress`, `requested`,
`waiting`, `pending`) for the repository, newest `createdAt` first, at most 20.
Completed runs never appear.

Error codes: `no-client-id`, `auth-required`, `rate-limited`, `github-unreachable`,
`no-git`, `workspace-missing`, `not-signed-in`, `invalid-input`, `internal`.

`snapshot` behavior:
- Resolves the workspace path from `ctx.workspaceRegistry`.
- `no-checkout`: no `.git` directory at/above the workspace path.
- Otherwise runs `git remote -v` (cwd = workspace path). Repo detection order:
  upstream-bearing remote first, then `origin`, then the rest in output order.
  Only `github.com` (configurable `host`, default `github.com`) URLs count.
  Accepts `https://`, `http://`, `ssh://`, `git://`, and scp form
  `git@host:owner/name.git`, with or without `.git`/trailing slash.
  No GitHub URL → `not-github` if some remote exists, else `no-remote`.
- `defaultBranch` is `null` in v1 (no extra API call).
- `auth`: current status.
- When not signed in, `runs` is `[]`, `fetchedAt` is `null`, `stale` is `false`, and
  the Client shows the sign-in surface — `snapshot` itself does **not** fail.
- When signed in, reads `GET https://api.github.com/repos/{owner}/{name}/actions/runs?per_page=50`
  with `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`, filtered to active runs and mapped as above.
- Per-repository cache TTL `refreshMs` (config, default 3000). A call within the TTL
  returns the cached runs with `stale: false`; `refresh: true` bypasses the cache.
  `stale: true` is only used when a live read fails and a cached value exists — the
  failure is then reported through `details.warning` on a successful response.
- A 401 from GitHub deletes the stored credential and returns `auth-required`.
- A 403/429 with `x-ratelimit-remaining: 0` returns `rate-limited` with
  `details.reset` (epoch seconds) when known.
- Network failure/timeouts return `github-unreachable`.

## 5. Client UI

One dedicated main panel, "GitHub Actions", registered as:

- `sidebar.panellist` — id `github-actions`, order 30, label from locale.
- `main` — key `github-actions`, body page component.
- The sidebar icon is an original inline SVG (no dependency on Harness primitives).

The page, top to bottom:
1. **Toolbar**: title, the connected repo as `owner/name` (link to its GitHub page),
   a workspace picker (`select`) when more than one workspace exists, Refresh, and a
   sign-out action when signed in.
2. **Body states** (one at a time):
   - `setup`: when `clientIdConfigured` is false — steps to create the OAuth app,
     the exact fields to fill, and a **text input + Save** that persists `clientId`
     through the Host (`githubActions.setClientId`; see §6) so the user never edits
     YAML. After saving, the panel re-reads `status`.
   - `signed-out`: "Sign in with GitHub" button; after `begin`, shows `userCode`, the
     verification URL as a link ("Open GitHub"), and a pending indicator; polls
     `githubActions.poll` no faster than the returned `interval`; offers Cancel.
   - `no-checkout` / `no-remote` / `not-github`: explains why no repo is connected and
     what to do (open a git checkout with a GitHub remote).
   - `ready`: the run list; each row shows the workflow run name, workflow name,
     branch, event, relative start time, an indeterminate "running" pill, and the full
     URL as its `title`; activating the row (click or Enter/Space) opens the run in a
     new tab. Queued runs show a "queued" pill instead. Empty state: "No runs are
     currently running."
3. **Live updates**: while the page is mounted and visible, re-fetch `snapshot` at most
   every `pollMs` (config, default 5000) and after Refresh, workspace change, or
   sign-in completion. Stop polling when unmounted or when the document is hidden.
   Keep the last successful list while a poll is in flight; show a small error banner
   with Retry when a poll fails without discarding the list.
4. **A11y**: one `h2` title region, `role="list"`/`role="listitem"` or equivalent
   semantics on the rows, focus-visible styles, no color-only status (text pill).
5. Styling only with `--dsw-alias-*` theme tokens; scoped class prefix `gha-`.

All visible text goes through `ctx.locale.register('github-actions', { en, zh })` +
`ctx.locale.bind`; both dictionaries cover every key used.

## 6. Additional Host methods (needed by §5)

| method | payload | value |
| --- | --- | --- |
| `githubActions.setClientId` | `{ clientId: string }` | `AuthStatus` |

`setClientId` validates a GitHub client-id shape (`^[A-Za-z0-9._-]{6,64}$`) and persists
it by writing the row's complete config back through `ctx.get('configEditor')`
(`editor.edit(entry, current => ({ ...current, clientId }))`). Missing editor →
`ok:false` with code `config-unavailable`; the value the plugin uses in the current
process is updated in memory as well, so saving does not require a restart to sign in.
It must never be usable to read secrets. The durable write is required: after a Host
restart the saved `clientId` is present in config.

## 7. Config

```yaml
- id: github-actions
  name: '@local/dsh-github-actions'
  config:
    clientId: ''            # GitHub OAuth App client ID
    scopes: 'repo'          # OAuth scopes
    host: 'github.com'      # GitHub host
    apiBaseUrl: 'https://api.github.com'
    refreshMs: 3000         # server-side runs cache
    pollMs: 5000            # client poll interval, clamped to >= refreshMs
    timeoutMs: 10000        # per GitHub HTTP request
```

## 8. Security

- Access token only on the Host; never in Client responses, errors, or logs.
- All transport goes through the authenticated `/api` bridge; no unauthenticated route.
- Client payloads are validated (zod-free: hand-rolled or schemastery) before use.
- `owner`/`name`/`host` are validated against GitHub-safe characters before being
  interpolated into a URL or a `git` invocation.

## 9. Acceptance criteria (what tests must prove)

1. Remote URL parsing: all listed forms map to `{host, owner, name}`; non-GitHub,
   malformed, and lookalike hosts (`github.com.evil.io`, `notgithub.com`) fail.
2. Remote selection order: upstream remote wins, then `origin`, then declaration order.
3. Run mapping: only active statuses survive; sort newest-first; 20 cap; every field
   mapped; `conclusion` null; `htmlUrl` and `workflowUrl` correct.
4. Device flow: pending → keep waiting; `slow_down` increases the interval by 5s;
   success stores the credential record exactly once; `expired`/`denied` reported;
   never returns the token; status describes signed-in state without the token.
5. RPC: envelope validation (400 on malformed), `invalid-input` on bad payloads, the
   documented result shape for every method, no `ok` value containing the token.
6. Snapshot: not-a-checkout, no-remote, not-github, GitHub repo with runs, cache hit
   within TTL, `refresh` bypass, 401 deletes the credential and returns
   `auth-required`, rate-limit mapping, cached-value-on-failure with `stale: true`.
7. Regression: once frozen, all passing tests stay passing.

## 10. Verification (manual, after install)

- Panel appears in the sidebar, opens, shows setup when no `clientId`.
- Device-flow sign-in completes against the real GitHub; account login appears.
- With the workspace connected to a repo that has a running workflow, the run appears
  within one poll interval after it starts, updates while running, and disappears
  after it finishes; clicking opens the run page.

---

# v1.1 increment — historical runs (user-approved 2026-11-11)

This section EXTENDS the frozen v1 contract above. Everything not restated here is
unchanged. Approved answers: **two sections on the same panel** (Running + Recent), and
**last 20 finished runs**.

## 11. Host: history read

- Config gains one field: `historyLimit` (number, integer, default `20`, clamped to
  1..100) — how many finished runs the panel shows.
- `snapshot` value gains `history: Run[]` (completed runs, newest `completedAt` first,
  at most `historyLimit`). `runs` keeps its v1 meaning: active runs only.
- `Run` gains `completedAt: string | null`. For active runs it is `null`. For history
  entries `status` is `'completed'` and `conclusion` is GitHub's conclusion string
  (`success`, `failure`, `cancelled`, `skipped`, `neutral`, `timed_out`,
  `action_required`, `stale`, `startup_failure`) or `null` when GitHub omits it.
- History source: `GET {apiBaseUrl}/repos/{owner}/{name}/actions/runs?status=completed&per_page={historyLimit}`
  with the same auth headers as the active read. Entries are mapped with the same
  `Run` field rules as active runs, using `updated_at` for `completedAt` when GitHub
  provides it (fall back to `created_at`), and newest-first by `completedAt`.
- History is cached per repository for `historyRefreshMs` (new config, default `15000`)
  independently of the active-runs cache (`refreshMs`). `refresh: true` bypasses both.
  A history read failure must not fail the snapshot when an active read succeeded: the
  value keeps the previous `history` (or `[]`) and adds a `historyWarning` string to the
  value. A 401 still deletes the credential and returns `auth-required`. A rate-limited
  history read alone is downgraded to `historyWarning` (active list still returned);
  a rate-limited active read remains the `rate-limited` error.
- Not signed in → `history: []`, no GitHub read.
- Snapshot budget: the whole `snapshot` call must still answer within `timeoutMs` per
  request; the two reads may run concurrently.

## 12. Client: Recent section

- The panel shows, top to bottom, a **Running** section and a **Recent** section.
  - Running: unchanged rows (running/queued pills).
  - Recent: one row per `history` entry, newest first, showing name, workflow name,
    branch, event, a conclusion pill (`Success` / `Failed` / `Cancelled` / `Skipped` /
    `Neutral` / `Timed out` / `Action required` / `Unknown` mapped from `conclusion`),
    and time since `completedAt`. Click/Enter/Space opens `htmlUrl` in a new tab.
- Section headings are localized; both sections are always present (each with its own
  empty line): Running empty = "No runs are currently running."; Recent empty =
  "No finished runs yet."
- When `historyWarning` is present, a subdued inline warning line appears above the
  Recent list; it never hides the rows.
- Styling: conclusion pills use theme tokens only (`success` → success tokens,
  `failure`/`timed_out`/`action_required` → error/warn tokens, `cancelled`/`skipped`/
  `neutral` → neutral tokens). Same `gha-` prefix and no literal colors.
- Locale: every new key exists in both `en` and `zh` dictionaries and in
  `locale/en.json` / `locale/zh.json` with identical key sets.

## 13. v1.1 acceptance criteria

1. `mapWorkflowRun` maps `conclusion` and `completedAt`; active mapping keeps
   `conclusion: null` and `completedAt: null`.
2. `historyRuns(rawRuns, host, limit)` keeps only `status === 'completed'`, sorts by
   `completedAt` desc, caps at `limit`, tolerates missing conclusion/dates.
3. `snapshot` issues exactly the two documented requests for a signed-in GitHub repo,
   returns `history` newest-first, caches history for `historyRefreshMs`, and bypasses
   both caches on `refresh: true`.
4. History failure with a successful active read → `ok:true`, previous `history`
   preserved (or `[]`), `historyWarning` set; active failure semantics unchanged.
5. 401 on either read → `auth-required` + credential deleted.
6. Client `describeState` unchanged; the page renders two sections; Recent rows show
   the conclusion pill and open `htmlUrl`; `historyWarning` renders; every new locale
   key exists in both dictionaries.
7. All v1 frozen tests keep passing unchanged (the v1.1 tests are a NEW suite; the v1
   test files must not be edited).

---

# v1.2 increment — list alignment and scrolling (user feedback 2026-11-11)

User-reported design defects in the v1.1 Recent list:
1. The conclusion pill at the right edge must occupy the **same width** for every
   conclusion label (Success/Failed/Cancelled/Skipped/Neutral/Timed out/Action required/
   Unknown), so pills form one vertical right-aligned column.
2. The workflow-name column ("CI") must start at the **same horizontal position on
   every row**, regardless of how long the branch name is.
3. The run list must be **scrollable** inside the panel: a long Recent list must not
   grow the page without bound; the section headings stay visible (sticky) while the
   rows scroll.

## 14. Layout contract

- Both lists (Running and Recent) use ONE shared column template, identical for both
  row kinds and across all rows. Formally: every `.gha-run` element in a rendered panel
  is assigned the same `grid-template-columns` computed from one shared constant, and
  the workflow cell is a fixed-width column (not `max-content`).
- Row cells, in order: run name, workflow name, branch, event, time, status pill.
  The status column is fixed-width and every pill is `justify-self:center` with
  `min-width` large enough for the longest localized pill label; pill text does not
  wrap. Success and Failed pills MUST render at the same width.
- The list container is bounded and scrolls vertically: one element with
  `overflow-y:auto`, `max-height: min(52vh, 640px)` and a themed thin scrollbar; it
  receives `tabindex="0"` and an accessible label so keyboard users can scroll it.
- Section headings are sticky within the scroll container (`position:sticky; top:0`,
  themed background) and the Recent warning line scrolls with the rows.
- Column headers: one header row per list with localized labels for
  Name / Workflow / Branch / Event / Status (and "Completed" for Recent), using the
  same column template, `role="presentation"` or an actual `role="row"` with
  `aria-hidden="true"`; they do not intercept clicks.
- All colors from `--dsw-alias-*` tokens only; no literal colors; no new hard-coded
  pixel font sizes beyond the existing scale.
- Locale: new header-label keys exist in both inline `en`/`zh` dictionaries and in
  `locale/en.json` / `locale/zh.json` with identical key sets.

## 15. v1.2 acceptance criteria

1. A single exported layout constant (e.g. `RUN_GRID_TEMPLATE` or a CSS class applied to
   every row) governs both row kinds; no row uses `max-content` for branch/event cells.
2. The pill element carries one fixed-width class (all conclusions) and is centered in
   its column.
3. The list container has the bounded-scroll styles, `tabindex="0"`, and a label; the
   section heading is sticky; the header row exists for each list.
4. Existing v1/v1.1 tests stay green unchanged; v1.2 tests are a NEW suite
   (`test/layout.test.js`).

---

# v1.3 increment — panel UX (user feedback 2026-11-13, screenshot)

Four user-reported issues:
1. The panel does not remember the last selected workspace.
2. The header should identify the current project by its **repo slug**, with a GitHub
   icon that opens that repo, instead of a separate "Workspace" select carrying only a
   workspace title (user chose: one repo-labelled dropdown + GitHub ↗ icon).
3. The Recent section should **fill the remaining panel height** instead of a fixed
   `52vh` box.
4. The empty state ("No runs are currently running.") has bad spacing/padding.

## 16. Workspace memory

- Storage: browser `localStorage`, key `github-actions.workspace`, value = workspace id.
  Every access is guarded (try/catch); a storage that throws behaves as empty and never
  breaks mounting.
- On mount, if the stored id is present in the workspace list, it is the initial
  selection; otherwise the first workspace is selected and the stored value is NOT
  overwritten merely by reading.
- Changing the selection writes the new id immediately (one write per change).
- The stored id is ignored when it is no longer in the list (a deleted workspace must
  not pin the panel to nothing).

## 17. Repo-labelled header control

- Header, left group: `h2` title, then ONE compact select control, then a GitHub icon.
- The select's **selected option label** is the current repo `owner/name` when the
  snapshot has a repo, else the current workspace title. Its option list is every
  workspace (label = that workspace's title; the selected one keeps the repo label so
  the closed control shows the repo).
- The GitHub icon is an `<a>` with `href` = repo web URL, `target="_blank"`,
  `rel="noreferrer noopener"`, `aria-label` from locale ("Open repository on GitHub"),
  and an inline SVG mark (original artwork, currentColor). It renders only when the
  snapshot has a repo; otherwise it is absent (not a disabled control).
- The control renders whenever there is at least one workspace (no `length > 1` gate),
  so the repo identity is always visible.
- The old separate `Workspace` label + select is removed. Locale keys that become
  unused may stay, but no new dead keys: `a11y.openRepo` is added to all four
  dictionaries (inline en/zh and locale files) with identical key sets.

## 18. Vertical layout and empty state

- The panel fills its host height: `.gha-page` is a flex column with `height:100%` and
  `min-height:0`; `.gha-body` and `.gha-runs` carry `flex:1;min-height:0` in the same
  chain so the sections receive a definite remaining height.
- `.gha-running` is content-sized with its scroll area capped at `max-height:40vh` (a
  burst of runs cannot consume the panel); `.gha-recent` is `flex:1;min-height:0` and
  its scroll container is `flex:1;min-height:0;max-height:none`, so it fills whatever
  height remains below Running and scrolls internally. No `52vh` cap on Recent.
- Padding is consistent and row-aligned: `.gha-scroll` has no horizontal padding;
  `.gha-section-title` and `.gha-header` use `14px` horizontal padding; `.gha-list`
  uses `10px 14px 14px`; `.gha-empty-line` uses `14px` padding with `margin:0`, so the
  empty text aligns with the Name column start instead of hugging the border.
- Sticky headings and the bounded/keyboard-accessible scroll contract from §14 remain.

## 19. v1.3 acceptance criteria

1. `localStorage` read/write/ignore-unknown/storage-failure behavior as §16 (new suite
   `test/ux.test.js`, driven through the client harness with a stubbed storage).
2. Header renders one repo-labelled select + GitHub link per §17; the link disappears
   without a repo; exactly one select exists in the toolbar (no leftover Workspace
   control); `a11y.openRepo` present in inline en/zh and both locale files.
3. CSS text satisfies §18: full-height chain, Recent flex-fill with `max-height:none`,
   Running cap `40vh`, empty-line `14px` padding, scroll container without horizontal
   padding; no literal colors; theme tokens only.
4. All previous 80 tests stay green unchanged; v1.3 tests are a NEW suite.
