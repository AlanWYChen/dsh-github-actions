# v1.4 test handoff — perceived latency + toolbar polish

**Status: FINAL.** v1.4 suite authored, RED-validated, satisfiability-checked,
and frozen. One USER-APPROVED revision to two frozen v1.3 dropdown-label
assertions was applied (explicit user direction in the v1.4 feedback, relayed by
the Lead; see §7). The new suite is `test/ux2.test.js`; no fixture,
`scripts/run-tests.mjs`, or `src/` file was edited.

- Contract: [`REQUIREMENTS.md`](../REQUIREMENTS.md) "v1.4 increment — perceived
  latency and toolbar polish" (§20 in-memory cache, §21 loading state, §22
  toolbar, §23 spacing/empty, §24 criteria).
- Test author: `test-author` (does not implement)
- User issues: switching repo re-fetches with no cache/loading; dropdown too
  narrow; Running/Recent too close; empty line not centered; dropdown label
  switches to repo slug; go control too small/high.

## 1. Artifacts

| Path | Kind | Tests |
| --- | --- | --- |
| `test/ux2.test.js` | NEW v1.4 acceptance suite (imports the frozen client harness read-only and drives it with deferred RPC promises) | 7 |
| `test/ux.test.js` | frozen v1.3 suite, **approved v1.4 dropdown-label revision only** (two expected values, see §7) | 6 (unchanged count) |
| all other `test/*.test.js`, `test/fixtures/*`, `scripts/run-tests.mjs` | untouched | 80 existing |

Suite size: **93 tests** (86 frozen v1/v1.1/v1.2/v1.3 + 7 v1.4). The runner globs
`test/*.test.js`; the gate is `all`.

## 2. Commands

```sh
node scripts/run-tests.mjs all     # gate (RED evidence below)
node --test test/ux2.test.js       # v1.4 suite only
```

## 3. RED evidence

### 3a. Initial v1.4 RED (before the approved v1.3 label revision)

```text
$ node scripts/run-tests.mjs all
ℹ tests 93
ℹ pass 86
ℹ fail 7
```

All seven new ux2 tests failed for missing v1.4 behavior (no cache hit, failed
refresh lost rows, no 20-entry bound, no loading state, dropdown selected label
was `octo/hello` instead of `Alpha`, no `.gha-runs` gap, missing loading locale
key). No import/syntax/harness errors; the 86 pre-existing tests passed.

### 3b. Final RED after the approved v1.3 label revision

```text
$ node scripts/run-tests.mjs all
Running all tests (9 files).
ℹ tests 93
ℹ pass 85
ℹ fail 8
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

The honest post-revision RED is the same 7 new ux2 behavior-missing failures plus
**one expected failure** in `test/ux.test.js` "the header has ONE select labelled
with the repo slug…" at the revised assertion:

```text
AssertionError [ERR_ASSERTION]: the closed control shows the workspace title
+ 'octo/hello'
- 'Alpha'
```

The current implementation still shows the repo slug in the closed dropdown;
after the implementer lands §22 the gate is 93/93.

**Satisfiability validation.** The 7 ux2 tests pass **7/7** against a throwaway
v1.4 reference stub outside the workspace (`/tmp`, deleted). With the two approved
label revisions applied in that sandbox, the full stub gate is **93/93** and every
other frozen test stays green. No production file was changed in this workspace.

## 4. Coverage map (§20–§24)

| Requirement | Test |
| --- | --- |
| §20/§24.1 in-memory per-workspace cache: A→B→A cache hit renders immediately, no loading/blank, background read still runs (no `refresh:true`) and replaces the entry on success | `switching workspaces renders cached snapshots immediately while a background refresh runs` |
| §20/§24.1 failed background refresh keeps cached rows + banner; failed reads never cached (a later selection shows loading again, not a cached error) | `a failed background refresh keeps the cached rows + banner, and failures are never cached` |
| §20/§24.1 cache bound ≤ 20 entries (insertion-order eviction observable via the oldest entry showing loading after 21 workspaces) | `the snapshot cache is bounded to 20 workspace entries` |
| §21/§24.2 loading: no cache + pending read → exactly one `role="status"`, `aria-live="polite"`, localized `"Loading runs…"`, no lists/empty lines/column headers; transient; `describeState(null)` stays `error` | `a cache miss with a pending read renders exactly one localized loading status and no lists/headers/empty lines` |
| §22/§24.3 dropdown label always the workspace title (repo slug not used); options = titles; repo control after the select shows slug text + icon and is button-like (inline-flex, centered, height 32px, padding, border, radius, nowrap; icon block/flex:none/line-height:1); toolbar + left group `align-items:center`; select `min-width:240px`/`max-width:360px`/`width:auto`/ellipsis/height | `the dropdown always shows the workspace title and the repo control shows slug + icon on the shared center line` |
| §23/§24.4 `.gha-runs` gap 16px; `.gha-empty-line` `text-align:center` with padding 14px/margin 0 | `Running/Recent are separated by 16px and the empty line is centered while keeping its inset` |
| §21/§24.2 loading key in inline en/zh and both locale files with identical key sets | `the loading locale key exists in both inline dictionaries and both locale files with identical key sets` |

## 5. Seams and observability

- Rendering uses the frozen `test/fixtures/client-harness.mjs` **read-only**.
  `createHarness({ rpc })` replaces the RPC call; `ux2.test.js` supplies a
  deferred fake: `githubActions.status` resolves immediately, each
  `githubActions.snapshot` call returns a controllable promise recorded per
  workspace, so cache hits/loading/failure/cache-bound behavior is observed
  against real component state.
- Cache bound is tested by driving 21 distinct workspaces and settling each read,
  then returning to the oldest: a cache hit would render immediately (no loading)
  while an evicted entry shows the loading state and issues a new read.
- CSS is observed by reading the emitted stylesheet template literal from
  `src/client.js` and tying declarations to the class names on the rendered
  select/repo control/icon/toolbar (same approach as the frozen layout/ux suites;
  no CSS engine in the harness).
- Locale JSON files are read from disk.
- No network, no real DOM.

## 6. Interpretations and not-covered / limitations

- The "loading" visible text is pinned to the exact English **"Loading runs…"**
  (with U+2026), per §21; the zh value only needs to be a non-empty translation
  with identical keys.
- The loading state is asserted while a snapshot promise is pending after the
  initial status resolves; the toolbar remains mounted (only list/empty/header
  surfaces are forbidden by §21).
- "No blank" on a cache hit is observed as the cached run rows being present with
  no loading status; the exact background timing is not pinned beyond "a second
  snapshot read was issued without `refresh: true`".
- Cache is required to be in-memory/session-lifetime and NOT persisted, but the
  frozen harness's localStorage is a no-op and the suite does not inspect disk or
  a reload; persistence is not directly testable in this harness and is left as a
  code-review/contract property.
- The dropdown height is accepted as an explicit `height`/`min-height` in px
  (the requirement says "same height as the toolbar buttons" without a number);
  the repo control height is pinned to 32px as §22 states explicitly.
- The cache bound is observed through eviction order (oldest insertion). A valid
  alternative policy (e.g. LRU) also evicts the oldest here because the oldest
  entry is the least recently used at that point.

## 7. Approved revision: two frozen v1.3 dropdown-label assertions

`test/ux.test.js` (frozen v1.3 header test) pinned the closed dropdown control to
the repo slug in two places. v1.4 §22 requires the dropdown label to be **always
the workspace/project title** (repo identity moves to the separate control), so
those two assertions were superseded.

- **User approval:** explicit user direction in the v1.4 feedback — "the
  dropdown always be the project name" (2026-11-14), relayed by the Lead.
- **Applied exactly (two lines, nothing else):**

```diff
- assert.equal(text(selected).trim(), REPO.slug, 'the closed control shows the repo slug');
+ assert.equal(text(selected).trim(), 'Alpha', 'the closed control shows the workspace title');
...
- assert.equal(text(soleSelected).trim(), REPO.slug);
+ assert.equal(text(soleSelected).trim(), 'Alpha');
```

- **Integrity proof:** reverting exactly those two lines restores the previous
  `test/ux.test.js` hash
  `fb9579695c8b1699d0fa803a2db39e1983fcee017cd853a61810a76874306ed7`;
  no other line in the file changed.
- **Evidence:** with both revisions, the v1.4 reference stub passes the full gate
  93/93; the v1.4 repo control (slug text + icon) still satisfies the remaining
  v1.3 assertions (the old test only failed on the two selected-label values).

## 8. Frozen hashes (FINAL)

```text
5b940df91dc74da0c04a32534b1d93563b6f89c8d4b4c4a8f3660b2e1ee7a7f3  test/ux2.test.js   (NEW v1.4 suite)
```

The 10 untouched artifacts are byte-identical to the v1.3 final manifest; only
`test/ux.test.js` carries the approved v1.4 label revision (verify via
[`frozen-tests.json`](frozen-tests.json)):

```text
9d9cac19cde432d5e3fa067845fc2c8a46e3fb010f2ee2ae77bd2334c6757d3b  scripts/run-tests.mjs
c4085cfb8d47d0b4c36fd7db7d3d2c347044f8460f690ab97e382e77875270ce  test/client.test.js
30c4942dda24f64833b89c1664f2c491a4872a89e507d6e1a33bb883a4d62ae8  test/device-flow.test.js
899337632c9951eba138b6077918a35e400b82034d3651f8d3383fe59499e294  test/history.test.js
d95492db2d36525bfe7b9b386a293617fe26f4aa30d2a6d77796fef4fca2f285  test/host.test.js
315ce4fb03eaac278e9acdecc6e494ffd8d504bad37dccdea71564a95f607517  test/layout.test.js
160274f697fc385a5e07b1bcaf3ee8c5235c839d8d253e8ff13b1cb402f39fc0  test/remotes.test.js
44cd8a8586ee024a61d824545c320e6584ea7ab0aa7386b9bc82018ba3c97f2b  test/runs.test.js
a72867f4a82e74c2e8a78418319feda319df635a980599d6ec7a9f58f469d685  test/ux.test.js              (approved v1.4 label revision)
9551b7cee180a9718da1eb994d459a506af7c6c28b20cce561188db7fe0965d0  test/fixtures/client-harness.mjs
c8423365add720284a884920b38e831ac7c5886f9812da84e05e6c6e732396be  test/fixtures/host-harness.mjs
```

## 9. Implementer instructions

1. Implement §20–§23 in `src/client.js` and `locale/*.json`. Do **not** edit
   anything under `test/` or `scripts/run-tests.mjs`.
2. The GREEN gate is **93/93** (the two v1.3 label assertions were revised under
   explicit user approval; §7). The implementation is proven satisfiable by a
   reference stub.
3. If a v1.4 test looks wrong, stop and escalate with path/line, command,
   expected behavior, and requirement source.
