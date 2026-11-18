# v1.6 test handoff — manual refresh cold reload + animated refresh control

**Status: FINAL.** New suite `test/ux4.test.js` authored, RED-validated against
the current (v1.5) implementation, satisfiability-checked, and frozen. No
existing test file, fixture, `scripts/run-tests.mjs`, locale, or `src/` file was
edited.

- Contract: [`REQUIREMENTS.md`](../REQUIREMENTS.md) "v1.6 increment — manual
  refresh reload (user feedback 2026-11-17)" (§28 manual refresh is a cold
  reload, §29 animated refresh control, §30 acceptance criteria).
- Test author: `test-author` (does not implement)
- Pre-change observation: the toolbar **Refresh** control calls
  `loadSnapshot({ refresh: true })` while keeping the previous rows rendered —
  no loading state, no cache drop, no poll suppression, no busy/animated
  control.

## 1. Artifacts

| Path | Kind | Tests |
| --- | --- | --- |
| `test/ux4.test.js` | NEW v1.6 acceptance suite (imports the frozen client harness read-only and drives it with deferred per-workspace RPC promises + fake timers) | 6 |
| all other `test/*.test.js`, `test/fixtures/*`, `scripts/run-tests.mjs`, `locale/*` | untouched | 95 existing |

Suite size: **101 tests** (95 frozen v1–v1.5 + 6 v1.6). The runner globs
`test/*.test.js`; the gate is `all`.

New test names (all six are behavioral RED against v1.5):

1. `pressing the toolbar Refresh is a cold reload: the rows become the loading state and exactly one refresh:true read is issued (§30.1)`
2. `the forced value replaces the module cache and the superseded rows never reappear, including after remount (§30.2)`
3. `a failed forced reload ends in the error surface + banner and neither restores nor caches the old rows (§30.3)`
4. `the forced reload suppresses scheduled polling, keeps the loading state, and polling resumes at pollMs when it settles (§30.4)`
5. `every refresh control renders the inline glyph and busy animation state, and the stylesheet defines gha-spin with a reduced-motion override (§29, §30.5)`
6. `changing the workspace resets the refresh control to idle, an abandoned reload cannot overwrite it, and no active workspace is a no-op (§28)`

## 2. Commands

```sh
node scripts/run-tests.mjs all     # gate (RED evidence below)
node --test test/ux4.test.js       # v1.6 suite only
```

## 3. RED evidence (against the current v1.5 implementation, 2026-11-17)

```text
$ node scripts/run-tests.mjs all
Running all tests (11 files).
ℹ tests 101
ℹ pass 95
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit code: 1
```

All six new tests fail for the missing behaviors; no import/syntax/harness
errors; all 95 existing tests pass unchanged:

| New test | Observed RED failure |
| --- | --- |
| §30.1 toolbar cold reload | `AssertionError: after pressing Refresh: exactly one localized loading status` (0 !== 1) — the old rows stay rendered |
| §30.2 cache replacement | `AssertionError: during the forced reload: exactly one localized loading status` (0 !== 1) |
| §30.3 failed forced reload | `AssertionError: during the forced reload: exactly one localized loading status` (0 !== 1) |
| §30.4 poll suppression | `AssertionError: during the forced reload: exactly one localized loading status` (0 !== 1) |
| §29/§30.5 animated control | `AssertionError: toolbar: renders an inline svg.gha-refresh-icon` (undefined) — no glyph, busy attributes, or `gha-spin` CSS |
| §28 workspace reset / no-op | `AssertionError: during A's forced reload: exactly one localized loading status` (0 !== 1) |

**Satisfiability validation.** All 6 ux4 tests pass (**6/6**) against a throwaway
v1.6 reference stub outside the workspace (`/tmp/gha-v16-stub`, deleted): CSS
glyph/keyframes/reduced-motion, a page-level refreshing flag, a cold
`handleRefresh` (drop cache → loading → `refresh:true`), poll suppression while
the forced read is in flight, idle reset on workspace change, and an early
return with no active workspace. The full stub gate is **101/101**, confirming
the new suite is satisfiable and the 95 frozen tests stay green under the v1.6
changes. No production file was changed in this workspace.

## 4. Coverage map (§28–§30)

| Requirement | Test |
| --- | --- |
| §28/§30.1 activation removes the active workspace cache entry and the body immediately renders the §21 loading state: exactly one centered `role="status"` / `aria-live="polite"` node with the localized `loading` text, and no run rows, section headers, empty lines, section wrappers, or state cards; the toolbar stays | test 1 |
| §28/§30.1 the forced `githubActions.snapshot` read is issued for the active workspace with `refresh: true`, exactly once, with payload exactly `{ workspaceId, refresh: true }` | test 1 (toolbar trigger); test 5 (repo-issue trigger) |
| §28/§30.1 on success the forced rows render and the loading state disappears | test 1 |
| §28/§30.2 the refreshed value replaces the module cache: leave/return and a page remount render the refreshed value, never the superseded one; superseded rows never reappear during or after the reload | test 2 |
| §28/§30.3 a failed forced read ends the loading state with the existing error surface + error banner and does not restore the old rows; the failed read is never cached (remount shows loading, not old rows) | test 3 |
| §28/§30.4 while the forced read is pending, elapsed `pollMs` intervals issue no snapshot read and keep the loading state; after it settles, normal `pollMs` polling resumes (exactly one non-forced read per interval, none immediately on settle) | test 4 |
| §28/§30.5 while pending the refresh control is `disabled`, `aria-busy="true"`, carries `gha-refreshing` and a `gha-refresh-icon`; it returns to idle after success | test 1 |
| §28/§30.5 it also returns to idle after the forced read **fails** | test 3 |
| §29 every refresh control (toolbar and repo-issue) renders the inline glyph before its localized label: `svg.gha-refresh-icon`, `aria-hidden="true"`, `focusable="false"`, `currentColor` stroke, 16px, `display:block` | test 5 |
| §29 stylesheet defines `@keyframes gha-spin` rotating 360°, the `.gha-refreshing .gha-refresh-icon { animation: gha-spin 1s linear infinite }` wiring, a `prefers-reduced-motion: reduce` override that disables it while keeping the glyph visible, and no literal colors in refresh CSS | test 5 |
| §28 the repo-issue **Refresh** control is also a cold reload (loading replaces the repo-issue card + forced read) | test 5 |
| §28 the error-surface **Retry** keeps cold reload semantics (`refresh:true` + loading); the **banner** Retry stays a warm retry (no `refresh:true`) | test 3 |
| §28 changing the workspace resets the refresh control to idle; an abandoned response for the workspace left must not clear or overwrite the new workspace's loading state; with no active workspace the control is a no-op (no read, no transition) | test 6 |
| §30.6 all 95 existing frozen tests stay green unchanged | full gate: `pass 95 / fail 6` (the 6 are the new suite) |

## 5. Seams and observability

- Rendering uses the frozen `test/fixtures/client-harness.mjs` **read-only**.
  `createHarness({ rpc })` supplies a deferred fake: `status` resolves
  immediately and every `githubActions.snapshot` call is a controllable promise
  in a per-workspace queue, addressed by explicit queue index so the forced read
  can be resolved or failed at any time with a success value or an
  `{ ok: false, error: { code, message, details } }` envelope.
- **Activation** is a real rendered control: a `<button>` inside `.gha-toolbar`
  (or inside the repo-issue `.gha-state` card) whose text is the localized
  `Refresh` label; the test invokes `props.onClick(eventStub())`. "Immediately"
  is observed without resolving the network: the click is followed only by
  `harness.settle()` while the snapshot promise is still pending, then the body
  is asserted to be the cold loading state.
- **Polling** uses the frozen fake clock: `harness.advance(ms)` fires due
  `setTimeout`/`setInterval` callbacks and settles the renderer; the test
  advances `3 × pollMs` with the forced read pending and asserts the snapshot
  call count is unchanged, then `pollMs` after it settles for exactly one
  resumed non-forced read.
- **Page reload/remount** follows the frozen v1.5 approach: `harness.unmount()`,
  clear the page instance's hook slots (`renderer.instanceFor('page')`), then
  `mountPage()` — a fresh component instance in the same loaded client module,
  so the module-scope cache is the only thing that survives.
- **Animated-control CSS** is read from the emitted stylesheet text exactly like
  `test/ux2.test.js` / `test/layout.test.js`: extract the template-literal
  block(s) containing `.gha-page` from `src/client.js`, parse rules (media
  conditions kept as text for the reduced-motion block), and inspect the
  `gha-spin` keyframes block plus the refresh-icon rules.
- No network, no real DOM.

## 6. Interpretations and not-covered / limitations

- "Immediately" is observed as "before the deferred network read resolves": the
  test waits only for render settling while the forced snapshot promise is still
  pending. It does not require a synchronous DOM paint.
- §28 "The toolbar (and any banner) stays": the toolbar staying mounted during
  the loading state is asserted. Preserving a **pre-existing error banner**
  across a cold reload is not exercised: it requires a loading flag layered
  above the error body and is not in the §30.1–§30.6 list. Implementer note:
  render the loading state inside the body only and leave the toolbar and any
  existing banner mounted.
- §29 busy state is observed on the toolbar control only. By contract the
  loading body contains no state cards, so the repo-issue card (and its Refresh
  control) is unmounted for the duration; its idle glyph and its cold-reload
  trigger are covered, its simultaneous busy attributes are not observable.
- §29 "the button remains named Refresh (existing `refresh` locale key; no new
  locale key)" is covered as a label-identity assertion (idle and busy control
  text). The frozen §21 test already requires the inline dictionaries and both
  locale JSON files to keep identical key sets, so a stray extra key would fail
  a frozen test; no new key is required to pass v1.6.
- "With no active workspace the control is a no-op (no loading state, no
  read)": with an empty workspace list the page already renders the §21 loading
  line on mount (snapshot null, no read). The test therefore asserts the
  activation adds **no read** and **no transition** (loading count unchanged, no
  rows/state cards, control idle) rather than asserting zero loading lines.
- No assertion inspects cache internals, request-token names, suppression flags,
  state hooks, or DOM structure beyond the named classes/labels/attributes;
  any scheme producing the required observable behavior passes. The reference
  stub used a simple boolean suppression flag and a plain `Set`-like cache
  delete, so alternates (per-workspace reload tracking, timer clearing, etc.)
  are equally acceptable.
- Poll-resumption strictness: the test requires no read immediately when the
  forced read settles and exactly one non-forced read within the next `pollMs`
  (normal cadence). A resume-at-next-grid-boundary implementation also passes
  when it schedules within `pollMs` of settling.
- All deferred reads are settled by the end of each test (or the harness is
  unmounted), so no dangling promise/timer state leaks between tests.

## 7. Frozen hashes (FINAL)

Verified byte-identical to `docs/TEST-HANDOFF-V1.5.md` / `docs/frozen-tests.json`
for all pre-existing artifacts; only `test/ux4.test.js` is new.

### 7.1 New v1.6 suite

```text
a212ba61cb0ba9ea6cdbb62a0650059851db65a8a23473108d5cb0124920ca1d  test/ux4.test.js   (NEW v1.6 suite)
```

### 7.2 Frozen test artifacts (all unchanged)

```text
9d9cac19cde432d5e3fa067845fc2c8a46e3fb010f2ee2ae77bd2334c6757d3b  scripts/run-tests.mjs
c4085cfb8d47d0b4c36fd7db7d3d2c347044f8460f690ab97e382e77875270ce  test/client.test.js
30c4942dda24f64833b89c1664f2c491a4872a89e507d6e1a33bb883a4d62ae8  test/device-flow.test.js
899337632c9951eba138b6077918a35e400b82034d3651f8d3383fe59499e294  test/history.test.js
d95492db2d36525bfe7b9b386a293617fe26f4aa30d2a6d77796fef4fca2f285  test/host.test.js
315ce4fb03eaac278e9acdecc6e494ffd8d504bad37dccdea71564a95f607517  test/layout.test.js
160274f697fc385a5e07b1bcaf3ee8c5235c839d8d253e8ff13b1cb402f39fc0  test/remotes.test.js
44cd8a8586ee024a61d824545c320e6584ea7ab0aa7386b9bc82018ba3c97f2b  test/runs.test.js
a72867f4a82e74c2e8a78418319feda319df635a980599d6ec7a9f58f469d685  test/ux.test.js
5b940df91dc74da0c04a32534b1d93563b6f89c8d4b4c4a8f3660b2e1ee7a7f3  test/ux2.test.js
e58eac813315559567fe9ede7363d81a70c340128c518e0c91736d38ed549f12  test/ux3.test.js
9551b7cee180a9718da1eb994d459a506af7c6c28b20cce561188db7fe0965d0  test/fixtures/client-harness.mjs
c8423365add720284a884920b38e831ac7c5886f9812da84e05e6c6e732396be  test/fixtures/host-harness.mjs
```

### 7.3 Locale files the suites read (unchanged, not to be edited for v1.6)

```text
80143da772f51ffe39ac80e2c2e9009762bb59184d1fb6f159b437ef270d9abf  locale/en.json
b241a25dc3d1e8611424d70fd8c6673a2aa0193f20170b84f513ecf336b04752  locale/zh.json
```

### 7.4 Pre-implementation source baseline (reference only; implementer will change `src/`)

```text
fc5018cfb274d4645e74b065e74e2915be66b9d6b11425b9b951ea43d82759cf  src/client.js
9b7f3aebd36dd859dd5d2098e7f808da98d80e27d809a14393d49fa347bdba75  src/index.js
```

Machine-readable: [`frozen-tests.json`](frozen-tests.json) (`v16Red`,
`v16Freeze`, `testsOnceImplemented: 101`, `freezeStatus: final`).

## 8. Implementer instructions

1. Make manual refresh a **cold reload** (§28): on activation from the toolbar
   **Refresh**, the repo-issue **Refresh**, and the error-surface **Retry** —
   remove the active workspace's snapshot cache entry, immediately render the
   §21 loading state in the body (drop the previous rows/headers/empty
   lines/state cards), then issue `githubActions.snapshot` for the active
   workspace with `refresh: true` (payload exactly `{ workspaceId, refresh:
   true }`). Keep the toolbar (and any existing banner) mounted.
2. Track the in-flight manual reload with a page-level flag that is independent
   of the error surface, so loading can be shown while an error banner is still
   present; disable the refresh control (and guard the handler) while the forced
   read is pending, and clear the flag in a `finally` so the control returns to
   idle on success **and** failure.
3. While the forced read is in flight, scheduled background polling must not
   issue or apply a snapshot read and must not replace the loading state; after
   the forced read settles, polling resumes at its normal `pollMs` cadence (no
   immediate extra read on settle).
4. On success render the forced snapshot as usual and **replace** the module
   cache entry with it. On failure show the error surface + existing error
   banner (banner Retry stays a warm retry, unchanged), do not restore the old
   rows, and never cache the failed/superseded read.
5. On a workspace change, reset the refresh control to idle and let the new
   workspace's normal loading/read take over; a response for the workspace the
   user left must not clear or overwrite the new workspace's loading state
   (existing §26 active-workspace/token rules). With no active workspace the
   refresh control is a no-op (no read, no state transition).
6. Animated control (§29): every refresh control renders an inline
   `svg.gha-refresh-icon` before its localized `Refresh` label (`aria-hidden`,
   `focusable="false"`, `currentColor` stroke, 16px, `display:block`). While the
   manual reload is in flight add `aria-busy="true"`, the `disabled` attribute,
   and the `gha-refreshing` class. CSS must define
   `@keyframes gha-spin { to { transform: rotate(360deg) } }`,
   `.gha-refreshing .gha-refresh-icon { animation: gha-spin 1s linear infinite }`,
   and a `prefers-reduced-motion: reduce` override that disables that animation
   while keeping the glyph visible; no literal colors (host theme tokens /
   `currentColor` only). Keep the existing `refresh` locale key; no new locale
   key is needed.
7. Do **not** edit anything under `test/` (including `test/ux4.test.js` and
   `test/fixtures/`), `scripts/run-tests.mjs`, `locale/*`, or `REQUIREMENTS.md`.
   The frozen v1.6 suite is the acceptance contract; do not change assertions,
   fixtures, expected values, or the runner to manufacture a pass.
8. Run `node scripts/run-tests.mjs all`. The **GREEN gate is 101/101** (95 frozen
   v1–v1.5 + 6 v1.6). A v1.6-only green run is not sufficient.
9. If a v1.6 test looks wrong or a requirement seems contradictory, STOP and
   escalate with the test path/line, the reproducible command, expected
   behavior, requirement source, and current behavior. Do not edit frozen tests.
