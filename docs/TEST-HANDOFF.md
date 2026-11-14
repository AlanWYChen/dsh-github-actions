# Test handoff — GitHub Actions for DSH v1

**PROTECTED ARTIFACTS.** The files listed at the bottom are frozen after the RED
validation recorded here. The feature implementer (and the coordinator) must
**not** edit, delete, skip, reorder, mock away, or weaken them. Any correction
requires explicit user approval, a fresh test-authoring phase, a renewed RED
validation, and a new baseline. Do not "fix" a test to match an implementation.

> **Approved repair, 2026-11-11.** After the implementation reached GREEN, the
> user approved (via the Lead) a repair of two defects in the *test helper* of
> `test/host.test.js`. Only test-author-owned helper lines and call-site
> arguments changed; assertions and test bodies are untouched and no production
> file was edited. See §3b; the re-freeze hashes are in §8 and
> [`frozen-tests.json`](frozen-tests.json).

- Test author: `test-author` (author of this handoff; does not implement)
- Implementer: a different agent (the Lead assigns it)
- Requirements are frozen in [`../REQUIREMENTS.md`](../REQUIREMENTS.md) and the
  seams/architecture in [`ARCHITECTURE.md`](ARCHITECTURE.md). This handoff adds
  no behavior; where it interprets an ambiguity it says so explicitly.

## 1. Artifacts

| Path | Layer | Tests |
| --- | --- | --- |
| `test/remotes.test.js` | unit — `src/remotes.js` | 8 |
| `test/runs.test.js` | unit — `src/runs.js` | 6 |
| `test/device-flow.test.js` | unit — `src/device-flow.js` | 12 |
| `test/host.test.js` | host contract — `src/index.js` (`createHandlers` + `apply` routes) | 23 |
| `test/client.test.js` | client contract — `src/client.js` loaded in `vm` | 8 |
| `scripts/run-tests.mjs` | `node --test` runner, groups `all` / `unit` / `integration` | — |

57 tests total (26 unit, 31 integration).

## 2. Commands

Run from the repository root:

```sh
node scripts/run-tests.mjs all          # every suite (what RED was captured with)
node scripts/run-tests.mjs unit         # remotes + runs + device-flow
node scripts/run-tests.mjs integration  # host + client
node --test test/remotes.test.js        # one file
```

The package is ESM. At original test-authoring time there was no
`package.json`; Node ≥ 22 module-syntax detection ran the `.test.js` files
correctly, and the implementer later added `package.json` with
`"type": "module"`. The same commands work unchanged in both states.

## 3. RED evidence (honest)

Captured immediately before freezing, with `src/` completely absent:

```text
$ node scripts/run-tests.mjs all
Running all tests (5 files).
ℹ tests 12
ℹ pass 0
ℹ fail 12
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Group runs produced the same picture:

```text
$ node scripts/run-tests.mjs unit
Running unit tests (3 files).
ℹ tests 3  ℹ pass 0  ℹ fail 3

$ node scripts/run-tests.mjs integration
Running integration tests (2 files).
ℹ tests 9  ℹ pass 0  ℹ fail 9
```

Failure classes:

- `test/remotes.test.js`, `test/runs.test.js`, `test/device-flow.test.js`,
  `test/host.test.js` — each file fails at module load with
  `ERR_MODULE_NOT_FOUND` for its `../src/*.js` import. Node reports each
  unloadable file as one failed test entry.
- `test/client.test.js` — the file loads, but each of its 8 tests fails with
  `ENOENT` while the harness reads `src/client.js` through the real
  module-loader contract.

There were **no passing tests**, so no assertion silently accepted a missing
implementation. This is a module-absence RED, not a behavioral RED: the
behaviors themselves cannot be exercised until `src/` exists. The behavioral
coverage is frozen and the same command is the GREEN gate.

The `vm` + React client harness was additionally smoke-run **outside the
workspace** (`/tmp`, throwaway stub, deleted) to verify its own plumbing (loader,
hooks, fake timers, visibility, tree expansion); the stub was never placed in
this workspace and is not an implementation.

### 3b. Approved post-implementation repair (re-freeze, 2026-11-11)

**User approval:** obtained via the Lead after the implementation completed.
Scope approved and applied: `test/host.test.js` helper/call-site corrections
only; assertions, expected values, test bodies, and test selection untouched.
No `src/` or other production file was modified.

**Repair baseline (captured before the repair, with `src/` complete):**

```text
$ node scripts/run-tests.mjs all
ℹ tests 57
ℹ pass 48
ℹ fail 9
```

The nine failures were traced to two defects in the test helper, not to
production behavior (independently reproduced by the Lead):

- **DEFECT 1 — the `git` fixture was omitted from 9 `handlerDeps` call sites.**
  The snapshot tests created a `checkoutFixture` and passed
  `workspaceEntity(git.dir)` as the workspace, but called
  `handlerDeps({ credentials, workspaces, github, … })` without `git`, so
  `gitRun` remained the deliberately failing default stub. Repo detection could
  not succeed by construction. Observed failure: `snapshot.repo` was `null`
  instead of `octo/hello` (and the snapshot surfaced the failing-git
  `repoStatus`).
- **DEFECT 2 — an explicit `editor: undefined` was defaulted to a working
  editor.** `editor ?? editorFixture()` made the `config-unavailable` path
  unreachable, so `setClientId` succeeded instead of failing. The helper now
  distinguishes an explicitly supplied key with
  `Object.hasOwn(options, 'editor')`.

No assertion, expected value, test declaration, or test body changed. The only
source change is `test/host.test.js` (**+13 / −3**: the helper body plus the
nine `git` arguments). Exact applied diff versus the pre-repair file:

```diff
-function handlerDeps({ config, credentials, workspaces, editor, git, github, now } = {}) {
+function handlerDeps(options = {}) {
+  const hasEditor = Object.hasOwn(options, 'editor');
+  const { config, credentials, workspaces, editor, git, github, now } = options;
   return {
     config: config ?? baseConfig(),
     credentials: credentials ?? credentialFixture(),
     workspaces: workspaces ?? workspaceRegistry([]),
-    editor: editor ?? editorFixture(),
+    editor: hasEditor ? editor : editorFixture(),
     gitRun: git ? git.run : async () => ({ stdout: '', stderr: '', exitCode: 1 }),
     githubFetch: github ? github.fetch : async () => githubResponse({ body: {} }),
     now: now ?? (() => NOW),
   };
 }
@@ -702,7 +704,7 @@
   const handlers = createHandlers(
-    handlerDeps({ credentials, workspaces, github, now: () => NOW }),
+    handlerDeps({ credentials, workspaces, github, git, now: () => NOW }),
   );
@@ -798,6 +800,7 @@
         credentials,
         workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
         github,
+        git,
       }),
     );
@@ -829,6 +832,7 @@
       credentials,
       workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
       github,
+      git,
     }),
   );
@@ -856,6 +860,7 @@
       credentials: credentialFixture(grantRecord()),
       workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
       github,
+      git,
     }),
   );
@@ -907,6 +912,7 @@
       credentials: credentialFixture(grantRecord()),
       workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
       github,
+      git,
       now: () => clock,
     }),
   );
@@ -966,6 +972,7 @@
       credentials: credentialFixture(grantRecord()),
       workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
       github,
+      git,
       now: () => clock,
     }),
   );
@@ -1008,6 +1015,7 @@
       credentials,
       workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
       github,
+      git,
     }),
   );
@@ -1066,6 +1074,7 @@
         credentials: credentialFixture(grantRecord()),
         workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
         github,
+        git,
       }),
     );
@@ -1091,6 +1100,7 @@
       credentials: credentialFixture(grantRecord()),
       workspaces: workspaceRegistry([workspaceEntity(git.dir)]),
       github,
+      git,
     }),
   );
```

**Post-repair gate (observed, exit 0):**

```text
$ node scripts/run-tests.mjs all
Running all tests (5 files).
ℹ tests 57
ℹ pass 57
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Honest RED statement for this re-freeze:** the original RED was the
module-absence RED in §3 (0 pass; 12 failing entries while `src/` did not
exist). A fresh *behavioral* RED cannot be re-established after GREEN: the
implementation already passes and no assertion was weakened. The repair
baseline above (48 pass / 9 fail, failing only for the two defect reasons) is
the only failing evidence available for this edit; it is what motivated the
fix and is preserved as the re-freeze's RED evidence.

## 4. Expected behavior → requirements map

### §9.1 Remote URL parsing — `test/remotes.test.js`

- Accepted forms: `https://`, `http://`, `ssh://`, `git://`, scp `git@host:owner/name`,
  with/without `.git` and trailing slash.
- `host` argument (default `github.com`) honoured; URLs for another host rejected.
- Rejected: non-GitHub hosts, lookalikes `github.com.evil.io` / `notgithub.com`,
  userinfo tricks (`github.com@evil.io`), missing/extra path segments, encoded
  slashes, spaces, `.`/`..` segments, empty/non-string input.
- `isSafeSegment` = `^[A-Za-z0-9_.-]+$` and not `.`/`..`.
- `parseRemoteLines` reads `git remote -v` in declaration order (fetch and push
  lines both preserved, kind `fetch`/`push`).

### §9.2 Remote selection order — `test/remotes.test.js`

`pickGitHubRemote(remotes, host, upstreamBranchOf)`:

1. a remote for which `upstreamBranchOf(name)` returns a branch,
2. then `origin`,
3. then the first GitHub remote in output order,
4. non-GitHub remotes never win,
5. `{ name, repo: { host, owner, name } }` or `undefined`.

### §9.3 Run mapping — `test/runs.test.js`

- `isActiveStatus`: `queued`, `in_progress`, `requested`, `waiting`, `pending`
  only.
- `mapWorkflowRun`: every `Run` field (`id`, `name`, `workflowName`, `status`,
  `conclusion: null`, `event`, `branch`, `actor`, `number`, `createdAt`,
  `startedAt`, `htmlUrl`, `workflowUrl`), tolerant of missing optional fields.
- `activeRuns`: active only, newest `createdAt` first, default cap 20, explicit
  limit, completed/unknown statuses dropped.

### §9.4 Device flow — `test/device-flow.test.js` (+ host integration)

- `start` posts `client_id` + `scope` to `https://github.com/login/device/code`
  and maps `device_code`/`user_code`/`verification_uri`/`expires_in`/`interval`.
- Poll gating honours the interval (no HTTP before it elapses), returns
  `{ state: 'pending', interval }`.
- `authorization_pending` keeps waiting; `slow_down` adds exactly 5 s to the
  interval and the new interval is returned and obeyed.
- Success: parses comma/space scopes, calls `fetchUser`, stores exactly one
  `{ kind: 'grant', payload: { token, tokenType, scopes, login, obtainedAt } }`
  record, returns `{ state: 'authorized', auth: AuthStatus }`.
- `expired_token` → `{ state: 'expired' }`; `access_denied` → `{ state: 'denied' }`.
- Local expiry window ends the attempt without another GitHub request.
- `invalid_grant` / `incorrect_client_credentials` / `unsupported_grant_type` /
  HTTP failure / network failure reject; no silent retry.
- The token never appears in any status/poll/result value, and `status` reflects
  signed-in state without exposing it.
- `cancel`, `signOut`, stored-record status, token-free JSON.

### §9.5 RPC envelope and every method shape — `test/host.test.js`

- `src/index.js` exports `apply`, `inject`, `Config`; `Config` applies §7
  defaults.
- `createHandlers(deps)` exposes all seven methods.
- `apply` registers exactly seven routes at `/api/githubActions.<method>` with
  `methods: ['POST']`, `requestBody: 'buffered'`.
- Malformed/mismatched envelopes ⇒ HTTP 400 + short text body; malformed
  payloads ⇒ `ok:false`, `error.code === 'invalid-input'`; rpcId echoed.
- Documented `AuthStatus`, `begin`, `poll`, `cancel`, `signOut`, `setClientId`
  shapes; no `ok` value contains the token.
- `setClientId` validates `^[A-Za-z0-9._-]{6,64}$`, persists the complete row
  config through `ctx.get('configEditor').edit(entry, …)`, updates the
  in-process value, never reads secrets; no editor ⇒ `config-unavailable`.

### §9.6 Snapshot — `test/host.test.js`

- Ready GitHub checkout: workspace, repo (`slug`, `webUrl`, `defaultBranch:null`,
  `source:'remote'`), `repoStatus:'ok'`, active mapped runs, ISO `fetchedAt`,
  `stale:false`; GitHub request is
  `GET https://api.github.com/repos/octo/hello/actions/runs?per_page=50` with
  `Authorization: Bearer`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`.
- `no-checkout`, `no-remote`, `not-github`; signed-out snapshot still succeeds
  with `runs: []`, `fetchedAt: null`, `stale: false`.
- Payload validation before any git/GitHub work; `workspace-missing`.
- `refreshMs` cache (hit within TTL, live read after TTL, `refresh: true`
  bypasses, bypassed read becomes the cache).
- Cached-value-on-failure with `stale: true` and a warning on the successful
  response.
- 401 deletes the credential and returns `auth-required`; 403/429 with
  `x-ratelimit-remaining: 0` ⇒ `rate-limited` with `details.reset` epoch seconds
  when known; network failure ⇒ `github-unreachable`.

### §5 Client UI — `test/client.test.js`

- Module-loader contract: `window.__ModuleLoader__.load({ id, factory })`,
  `require('react')` only, module exports `apply`.
- Locale: `ctx.locale.register('github-actions', { en, zh })`, `ctx.locale.bind`,
  identical key sets, every value non-empty.
- Slots: `sidebar.panellist` id `github-actions`, order 30, localized label,
  original inline SVG icon; `main` key `github-actions`, page component.
- `describeState` for `setup`, `signed-out`, `no-checkout`, `no-remote`,
  `not-github`, `ready`, and `error` (null snapshot); every `titleKey` exists in
  both dictionaries.
- Polling at most every `pollMs` (default 5000), stops while the document is
  hidden and after unmount.
- Ready rows: one `h2`, run name/workflow/branch/event, running vs queued pill,
  full URL as `title`, click **and** Enter/Space open the run URL in a new tab.
- Setup: text input + Save calls `githubActions.setClientId` with `{ clientId }`
  through `/api`, then re-reads `githubActions.status`.

## 5. Seams and fakes (no real I/O)

- Pure modules run with no seams (they are pure).
- `device-flow`: injected `post`, `now`, `store` (`read`/`write`/`clear`),
  `fetchUser`. Tests also pass `clientId`, `scopes`, and a `config` object
  because the flow must know the OAuth app identity (see ambiguity A4).
- Host: `createHandlers({ config, credentials, workspaces, editor, gitRun,
  githubFetch, now })`. The credentials fake satisfies both plausible shapes
  (store-style and `readRecord`/`modifyRecord`/`deleteRecord`) and is observed
  through its final state, not a method name. `githubFetch` is a fake returning
  `{ ok, status, headers.get/has/entries, json(), text() }`.
- Host workspace fixtures are real temporary directories **with or without a
  `.git` directory** because §9.6 defines `no-checkout` in filesystem terms;
  `gitRun` is still a pure fake and responds to `git remote -v` / `git rev-parse`
  / upstream probes. No subprocess is spawned. `mkdtemp` directories are removed
  after each test.
- Client: real `src/client.js` executed in `vm.runInNewContext` with
  `window.__ModuleLoader__`; React is a deterministic stub covering the common
  hooks (`useState`, `useRef`, `useEffect`, `useLayoutEffect`, `useMemo`,
  `useCallback`, `useReducer`, `useSyncExternalStore`, …); timers, `document`
  visibility, `window.open`, `localStorage`, `history`, and `matchMedia` are
  fakes.
- `test/host.test.js` guards `globalThis.fetch` during route/apply tests so the
  real network can never be reached.

## 6. Contract decisions on ambiguities (Lead: please confirm/relay)

These are places where the frozen texts do not fully determine a testable
convention. Each choice below is the most conservative literal reading; the
tests assert the choice. **If the Lead decides differently, that requires an
approved contract revision and a fresh RED/freeze cycle.**

- **A1 — `workflowUrl` (§4 Run).** Read as the GitHub *file* page:
  `${repo.webBase}/blob/${head_branch}/${path}`, and `null` when `path`/branch is
  missing. The competing reading is `/actions/workflows/{workflow_id}`. Tests
  freeze the blob reading (`test/runs.test.js`, `test/host.test.js`).
- **A2 — stale warning channel (§4).** The text requires "`details.warning` on a
  successful response", but the documented success envelope is only
  `{ ok: true, value }`. Tests accept a warning string at
  `result.details.warning`, `result.warning`, or `value.warning` (in that
  order), and require it to be non-empty. Pinning one location would contradict
  the documented envelope; please confirm the intended location.
- **A3 — `createHandlers` return convention.** ARCHITECTURE.md fixes the function
  but not whether handlers return the value `T` or a result envelope, nor
  whether the table is keyed by `status` or `githubActions.status`. The host
  tests tolerate both (short or full key; value or `{ok,value}` /
  `{ok:false,error}` with thrown errors carrying `code`). Implement one style
  consistently.
- **A4 — `createDeviceFlow` deps.** ARCHITECTURE.md lists
  `{ post, now, store, fetchUser }`, which cannot send `client_id`/`scope`.
  Tests pass `clientId`, `scopes`, and `config: { clientId, scopes }` in
  addition; the flow may read either spelling.
- **A5 — poll timing semantics.** Tests freeze non-blocking behavior: a poll
  before the interval returns `{ state: 'pending', interval }` without an HTTP
  request; `slow_down` adds 5 s and the new interval gates the next request; the
  local `expires_in` window returns `{ state: 'expired' }` without another
  request; a poll after `authorized` returns `{ state: 'authorized', auth }`
  without another GitHub request.
- **A6 — hard device-flow failures.** The `poll` value union has no error
  member, so `invalid_grant`/`incorrect_client_credentials`/
  `unsupported_grant_type`/HTTP/network failures make `flow.poll()` reject (no
  retry); the host converts that to an RPC failure.
- **A7 — `parseRemoteLines`.** One entry per line of `git remote -v` (fetch and
  push both preserved, `kind` distinguishes them); not deduped. Selection order
  is still preserved.
- **A8 — checkout detection.** Tests pass both a real `.git` fixture and a fake
  `gitRun` that succeeds/fails the usual `rev-parse` probes, so an
  fs-only or git-only detector both satisfy them; the observed state is the
  contract.
- **A9 — timestamps.** `fetchedAt` must be an ISO 8601 UTC string (not pinned to
  the injected `now`); `obtainedAt` must be present in the grant payload but its
  representation is not pinned. This avoids inventing a representation the
  requirements never state.
- **A10 — client page environment.** Tests mount the registered `main`
  component with `t` from `ctx.locale.bind('github-actions')`, the `inject()`
  props, and root hooks `useWorkspaces`, `useSessions`, `usePanelInfo`,
  `useWorkspaceAccess` backed by fake snapshots. The page must fetch through
  `ctx.connection.rpc.call('/api', 'githubActions.<method>', payload)` and use
  the documented `pollMs` default of 5000; the tests pass the parsed config as
  the second `apply` argument.
- **A11 — extra fields.** `AuthStatus`, `Snapshot.workspace`, `Snapshot.repo`,
  and mapped `Run` are compared with exact deep equality, so they are expected
  to contain exactly the documented fields. Extra top-level `Snapshot`/`AuthStatus`
  fields are not exercised.
- **A12 — `describeState(null)`.** Interpreted as the client `error` state
  (`ARCHITECTURE.md` lists `error` in the union although §5 does not); `titleKey`
  must exist in both dictionaries.

## 7. Not covered / unverified (honest gaps)

- The post-repair gate is GREEN (57/57, exit 0; see §3b). The original RED was
  module absence; no fresh behavioral RED exists because implementation
  happened in between. The repaired tests were first observed failing for the
  two helper-defect reasons recorded in §3b.
- `pollMs` clamping to `>= refreshMs` (§7) is not tested; it is unclear whether
  the clamp belongs to `Config` or the Client, and the client's config plumbing
  is not specified.
- Refresh-button behavior, in-flight list retention, and the poll-failure
  Retry banner (§5.3) are not tested (not listed in the acceptance criteria
  §9.1–§9.6); the body-state machine and polling lifecycle are.
- Styling token usage (`--dsw-alias-*`) and the `gha-` class prefix (§5.5) are
  not asserted (styling-only requirement with no behavioral acceptance hook).
- `source: 'manual'` repository mode (§4 Snapshot) is not tested; no v1 method
  creates a manual repo.
- Custom `host`/`apiBaseUrl` behavior beyond URL parsing and Config defaults is
  not exercised end-to-end.
- Real GitHub OAuth/API behavior is out of scope by requirement; every network
  and process seam is faked.

## 8. Frozen hashes

Machine-readable baseline: [`frozen-tests.json`](frozen-tests.json).

```text
9d9cac19cde432d5e3fa067845fc2c8a46e3fb010f2ee2ae77bd2334c6757d3b  scripts/run-tests.mjs
c4085cfb8d47d0b4c36fd7db7d3d2c347044f8460f690ab97e382e77875270ce  test/client.test.js
30c4942dda24f64833b89c1664f2c491a4872a89e507d6e1a33bb883a4d62ae8  test/device-flow.test.js
a22afff10a9fbefcc6f07c9259af60aedb2924569dc4fbb26afba65578184d29  test/host.test.js
160274f697fc385a5e07b1bcaf3ee8c5235c839d8d253e8ff13b1cb402f39fc0  test/remotes.test.js
d6bc7c4139e150d11af2e5c9852d7eb56c2fff16b6d65d48758cdfe136fb7517  test/runs.test.js
```

Verify integrity with:

```sh
shasum -a 256 scripts/run-tests.mjs test/*.test.js
```

## 9. Implementer instructions

1. Read `REQUIREMENTS.md` and `docs/ARCHITECTURE.md`; implement `src/` without
   touching anything listed in §8.
2. Run `node scripts/run-tests.mjs all`. Every one of the 57 tests is part of
   the acceptance gate; a targeted pass is not sufficient.
3. If a test looks wrong, **stop** and escalate with the frozen path/line, the
   reproducible command, the expected behavior and requirement source. Do not
   edit the test. Only explicit user approval reopens this phase.
4. Re-run the integrity check in §8 after implementation; a changed hash means
   the protected baseline was violated.

---

## v1.1 increment pointer

Historical runs (Running + Recent) are covered by the new `test/history.test.js`
suite and documented in [`TEST-HANDOFF-V1.1.md`](TEST-HANDOFF-V1.1.md). The v1
history above is unchanged. The only v1-file change for v1.1 is the approved
Config-default assertion in `test/host.test.js`, plus the user-approved minimal
revision of four frozen v1 assertions that encoded the v1 single-read /
no-`completedAt` contract (see the v1.1 handoff §6–§7). The v1.1 freeze is
final.

## v1.2 increment pointer

The v1.2 layout + scrolling acceptance suite is `test/layout.test.js`, documented
in [`TEST-HANDOFF-V1.2.md`](TEST-HANDOFF-V1.2.md). It is a NEW suite with no
revision to any existing assertion: the frozen v1/v1.1 tests, fixtures, and
`scripts/run-tests.mjs` are unchanged. The GREEN gate is 80/80.
