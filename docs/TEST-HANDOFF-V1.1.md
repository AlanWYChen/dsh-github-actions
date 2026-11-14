# v1.1 test handoff — historical runs (Running + Recent)

**Status: v1.1 test suite authored, RED-validated, and FINALIZED.** The user
approved the minimal frozen-v1 revision proposed for v1.1 (relayed by the Lead),
and it is applied exactly as approved (see §6–§7). Final RED is captured below;
hashes in §9 and `frozen-tests.json` are non-provisional. No `src/` file was
edited by the test author.

- Contract: [`REQUIREMENTS.md`](../REQUIREMENTS.md) "v1.1 increment — historical
  runs" (§11 Host history read, §12 Client Recent section, §13 acceptance
  criteria). The rest of the v1 contract is unchanged.
- Test author: `test-author` (does not implement)
- Approval source: v1.1 increment is marked **user-approved 2026-11-11** in
  `REQUIREMENTS.md`; the Config-assertion revision was explicitly authorized by
  the Lead in the v1.1 assignment. The further v1 revisions in §7 are **not yet
  approved**.

## 1. Artifacts

| Path | Kind | Tests |
| --- | --- | --- |
| `test/history.test.js` | NEW v1.1 acceptance suite | 17 |
| `test/fixtures/host-harness.mjs` | NEW copied host fakes (from frozen `test/host.test.js`) | — |
| `test/fixtures/client-harness.mjs` | NEW copied client `vm`/React harness (from frozen `test/client.test.js`) | — |
| `test/host.test.js` | frozen v1 file, **one approved assertion change only** (Config defaults) | 23 (unchanged count) |
| `scripts/run-tests.mjs` | unchanged; globs the new suite automatically | — |

Suite size: 74 tests (57 v1 + 17 v1.1). `scripts/run-tests.mjs` is byte-identical
and was not edited; `test/history.test.js` is picked up by the `test/*.test.js`
glob. Because the runner's integration set is byte-frozen, `history.test.js`
appears under the `unit` group label; the acceptance gate is `all`.

## 2. Commands

```sh
node scripts/run-tests.mjs all          # gate (RED evidence below)
node scripts/run-tests.mjs unit
node scripts/run-tests.mjs integration
node --test test/history.test.js        # v1.1 suite only
```

## 3. RED evidence (against the current v1 implementation, 2026-11-11)

```text
$ node scripts/run-tests.mjs all
Running all tests (6 files).
ℹ tests 74
ℹ pass 56
ℹ fail 18
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All failures are behavioral/expected-value failures for missing v1.1 behavior;
there are no module-import, syntax, or harness errors. Failure classes:

1. **17 new v1.1 tests fail for missing behavior** (one per `test/history.test.js`
   test):
   - `mapWorkflowRun` has no `conclusion`/`completedAt` mapping (`undefined` where
     `null`/strings are required).
   - `src/runs.js` does not export `historyRuns` — deliberate namespace import so
     the file still executes; the test asserts
     `typeof historyRuns === 'function'` with the §13.2 citation. (This is the
     documented "module-export-absent RED" and it is labeled as such; no other
     test fails for an import reason.)
   - `snapshot` makes only the v1 active request (1 call, not the required 2),
     returns no `history`, and never downgrades history failures to
     `historyWarning`.
   - signed-out snapshots omit `history: []`; `historyLimit` is ignored.
   - the client renders no Running/Recent sections, no conclusion pills, no
     Recent rows, no history warning line, and the new locale keys are absent.
2. **1 approved Config assertion fails**: the v1.1 defaults
   `historyLimit: 20` and `historyRefreshMs: 15000` are not in `Config` yet
   (`test/host.test.js` "Config exposes the §7 defaults and accepts overrides").

**Satisfiability check.** The 17 new tests were also run against a throwaway
v1.1 reference stub **outside the workspace** (`/tmp`, deleted afterwards): all
17 passed. That run also demonstrated the v1 contract conflict in §7 (70/74 pass
with exactly the four v1 failures). No production file was changed in this
workspace.

### 3b. Final RED after the approved v1 revision (current implementation is v1)

Applied the approved four-item revision (§7) and re-ran the gate against the
current v1 implementation. As expected, the revised v1 assertions now also fail
against the current code (one read, no `completedAt`); that is valid RED for the
new contract, not a regression:

```text
$ node scripts/run-tests.mjs all
Running all tests (6 files).
ℹ tests 74
ℹ pass 52
ℹ fail 22
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

22 failures = the same 17 new v1.1 behavior-missing failures + 5 expected v1
failures:
- `test/host.test.js` "Config exposes the §7 defaults…" — `historyLimit` /
  `historyRefreshMs` absent (approved Config revision, §6).
- `test/runs.test.js` "mapWorkflowRun maps every Run field…" and "…tolerates
  missing optional fields" — `completedAt` absent from mapped runs.
- `test/host.test.js` "snapshot maps a GitHub checkout and its active runs" —
  `snapshot.runs[].completedAt` absent (and two reads required).
- `test/host.test.js` "snapshot caches per repository within refreshMs…" — the
  first snapshot makes 0 history reads (needs 1).

Every failure is behavioral/expected-value; there are no import, syntax, or
harness errors. Once `src/` implements §11–§13, all 74 must pass.

## 4. Coverage map (REQUIREMENTS §11–§13)

| Requirement | Test(s) in `test/history.test.js` |
| --- | --- |
| §13.1 / §11 `mapWorkflowRun` conclusion + completedAt; updated_at→created_at fallback; active keeps nulls | `mapWorkflowRun maps conclusion and completedAt…`; `mapWorkflowRun falls back to created_at…`; `active mapping keeps conclusion and completedAt null` |
| §13.2 `historyRuns(raw, host, limit)`: completed only, completedAt desc, cap, missing conclusion/dates | `historyRuns keeps completed runs, sorts by completedAt desc, and caps the limit` |
| §13.3 two documented requests, history newest-first, same auth headers | `snapshot returns active runs plus newest-first history from exactly two documented requests` |
| §13.3 independent `historyRefreshMs` cache | `history is cached for historyRefreshMs independently of the active refreshMs` |
| §13.3 `refresh: true` bypasses both caches | `refresh: true bypasses the active and history caches` |
| §13.4 history failure downgraded; previous history preserved or `[]`; `historyWarning` | `a failed history read keeps the previous history and adds historyWarning` |
| §13.4 rate-limited history downgraded; rate-limited active stays `rate-limited` | `a rate-limited history read degrades, while a rate-limited active read still fails` |
| §13.5 401 deletes credential, `auth-required` (history read) | `a 401 on the history read deletes the credential and returns auth-required` |
| §13.3 signed-out: `history: []`, no GitHub read | `signed-out snapshots return empty history without a GitHub read` |
| §13.3 `historyLimit` drives request size and cap | `historyLimit drives the history request size and the returned cap` |
| §12/§13.6 two sections, Running above Recent, localized headings | `the panel renders a localized Running section above a localized Recent section` |
| §12/§13.6 Recent rows: fields, conclusion pills (all eight labels + Unknown), time since completedAt, click/Enter/Space opens htmlUrl | `Recent rows show fields, conclusion pills, and open htmlUrl on click/Enter/Space` |
| §12 both sections always present with the specified empty lines | `both sections are always present with their specified empty lines` |
| §12 historyWarning line above the Recent rows without hiding them | `historyWarning renders above the Recent rows without hiding them` |
| §12 locale: en/zh dictionaries + `locale/en.json`/`locale/zh.json` identical key sets, specified English strings | `locale dictionaries and files share identical key sets and contain the v1.1 strings` |

The test file also includes the §13.6 `describeState` regression assertion
(`kind === 'ready'` for a snapshot that carries history/historyWarning) inside
the two-section test, so that assertion is exercised by a failing RED test rather
than passing trivially.

## 5. Seams and fakes

`test/fixtures/host-harness.mjs` and `test/fixtures/client-harness.mjs` are
**copies** of the frozen v1 harness helpers (the v1 test files were not edited or
imported-for-side-effects). They are frozen artifacts too.

- Host tests call `createHandlers` directly with fake `credentials`, `workspaces`,
  `gitRun`, `githubFetch`, `editor`, `now`. Checkout state uses real temp
  directories plus the fake git process, exactly like v1. GitHub responses route
  by URL: `?status=completed` ⇒ the history read, otherwise the active read, so
  the two-request contract is observable.
- The client harness loads the real `src/client.js` in `vm` via
  `window.__ModuleLoader__`, with the same deterministic React/timer/visibility
  fakes as v1; all client tests read the real rendered tree.
- No test performs network I/O or spawns a process. The new suite never touches
  `globalThis.fetch`; only injected fakes are used.
- Git fixture temp directories are removed after each host test.

## 6. Approved contract revisions

`test/host.test.js` "Config exposes the §7 defaults and accepts overrides" — the
expected parsed config gains the two approved v1.1 fields (exact diff):

```diff
       refreshMs: 3000,
       pollMs: 5000,
       timeoutMs: 10000,
+      historyLimit: 20,
+      historyRefreshMs: 15000,
     },
   );
```

Verified mechanically: removing exactly those two lines restores the frozen
repaired v1 file hash `a22afff10a9fbefcc6f07c9259af60aedb2924569dc4fbb26afba65578184d29`;
nothing else in `test/host.test.js` changed. User approval source: v1.1 is marked
user-approved in `REQUIREMENTS.md`, and the Lead explicitly authorized this one
assertion change.

**Second revision — frozen-v1 assertions contradicted by the approved v1.1
shape (user approval obtained via the Lead, 2026-11-11).** Applied exactly as
approved; itemized in §7. It changes only expected values, call counts, and the
cache test's GitHub fake shape — no TTL/refresh/cache semantics and no
new-behavior assertion were weakened. Diffstat: `test/runs.test.js` +1 line;
`test/host.test.js` +50/−17 (the three items below).

## 7. Approved and applied: frozen v1 revisions for v1.1

**Status: RESOLVED.** The four v1 assertions that encoded the v1 single-read /
no-`completedAt` contract were revised after explicit user approval (relayed by
the Lead, 2026-11-11). Requirement sources:

- §11: "`Run` gains `completedAt: string | null`. For active runs it is `null`."
- §11/§13.3: "`snapshot` issues exactly the two documented requests for a
  signed-in GitHub repo" (active + history).
- §13.7's "all v1 frozen tests keep passing unchanged" was impossible while
  those two points hold; this revision is the minimal correction.

### Itemized changes (exactly four items; nothing else)

1. **`test/runs.test.js` (+1 line).** `mappedRun()` gains `completedAt: null`.
   Fixes the two deepEqual tests ("mapWorkflowRun maps every Run field…",
   "…tolerates missing optional fields").
2. **`test/host.test.js` (+1 line).** Its `mappedRun()` gains `completedAt: null`.
   Fixes the `snapshot.runs` deepEqual in "snapshot maps a GitHub checkout and
   its active runs".
3. **`test/host.test.js` (+4/−2 lines, count/URL lookup).** After the first
   snapshot, `github.calls.length` is now `2` (active + history read, §13.3), and
   the asserted active request is located by URL (`calls.find(...)`) rather than
   by array position, because the two reads may be issued concurrently. The URL
   and header assertions are unchanged.
4. **`test/host.test.js` cache test rewrite (+45/−15 lines).** The test now uses
   a URL-routed GitHub fake (`?status=completed` ⇒ history, otherwise active) and
   tracks `activeReads` / `historyReads` independently. Observed two-read
   cadence: first snapshot 1/1; warm caches 1/1; past `refreshMs` but inside
   `historyRefreshMs` 2/1 with history preserved; `refresh: true` 3/2 with both
   payloads refreshed; a subsequent call reuses both caches (3/2, total calls
   2/2/3/5/5). TTL/refresh/caching semantics and all value assertions are
   unchanged — only the single-read FIFO response queue was replaced by the
   two-read URL router.

### Verification

- Reconstruction diff versus the pre-revision files: `test/runs.test.js` 1 file
  changed, 1 insertion; `test/host.test.js` 1 file changed, 50 insertions,
  17 deletions — exactly the items above, no other lines.
- The 17 new v1.1 tests were validated against a throwaway v1.1 stub before this
  revision (17/17 pass); the cache-test rewrite preserves the same TTL/refresh
  semantics and is expected to pass on any correct two-read implementation.
- Final RED against the current v1 implementation (§3b): 74 tests, 52 pass,
  22 fail — 17 new behavior-missing + 5 expected v1 failures, including the four
  revised assertions.
- Frozen-v1 test files other than the approved changes are byte-identical; see
  the hash list in §9.

## 8. Not covered / limitations

- `historyLimit` "clamped to 1..100" (§11) is not asserted. It is ambiguous
  whether "clamped" means schema coercion or validation rejection; §13 does not
  list it. The default (`20`) and the request/cap use are covered.
- Two-read concurrency and the per-request `timeoutMs` budget (§11 last bullet)
  are not asserted (timing/concurrency is not deterministically observable with
  the injected fakes; each request already inherits the v1 timeout seam).
- The `historyWarning` exact wording is not pinned; tests require a non-empty
  string rendered verbatim and above the rows (the Host chooses the words).
- Section heading wording is not pinned; tests require two distinct localized
  headings in the documented order, each taken from the dictionaries, plus the
  exact specified empty lines.
- Conclusion pills for `stale`/`startup_failure` are expected to map to
  `Unknown`; only `stale` is tested. `null` conclusion maps to `Unknown` and is
  tested.
- Styles/theme tokens for conclusion pills (§12 last bullet) are not asserted
  (no behavioral hook beyond the `gha-` classes in v1; styling remains
  manual/visual verification).

## 9. Frozen hashes (FINAL)

```text
9d9cac19cde432d5e3fa067845fc2c8a46e3fb010f2ee2ae77bd2334c6757d3b  scripts/run-tests.mjs        (unchanged)
c4085cfb8d47d0b4c36fd7db7d3d2c347044f8460f690ab97e382e77875270ce  test/client.test.js          (unchanged)
30c4942dda24f64833b89c1664f2c491a4872a89e507d6e1a33bb883a4d62ae8  test/device-flow.test.js     (unchanged)
899337632c9951eba138b6077918a35e400b82034d3651f8d3383fe59499e294  test/history.test.js         (NEW v1.1 suite)
d95492db2d36525bfe7b9b386a293617fe26f4aa30d2a6d77796fef4fca2f285  test/host.test.js            (Config + approved v1 revisions)
160274f697fc385a5e07b1bcaf3ee8c5235c839d8d253e8ff13b1cb402f39fc0  test/remotes.test.js         (unchanged)
44cd8a8586ee024a61d824545c320e6584ea7ab0aa7386b9bc82018ba3c97f2b  test/runs.test.js            (approved completedAt revision)
9551b7cee180a9718da1eb994d459a506af7c6c28b20cce561188db7fe0965d0  test/fixtures/client-harness.mjs (NEW)
c8423365add720284a884920b38e831ac7c5886f9812da84e05e6c6e732396be  test/fixtures/host-harness.mjs   (NEW)
```

Machine-readable: [`frozen-tests.json`](frozen-tests.json) (`freezeStatus: final`).

## 10. Implementer instructions

1. Implement §11–§13 in `src/` (and `locale/en.json`, `locale/zh.json`); do not
   edit any file under `test/` or `scripts/run-tests.mjs`.
2. Run `node scripts/run-tests.mjs all`. The 17 new tests are the v1.1
   acceptance gate.
3. The four v1 conflicts in §7 were approved and revised; all 74 tests are now
   the GREEN gate. Do not edit the tests yourself.
4. If a v1.1 test looks wrong, stop and escalate with the path/line, command,
   expected behavior and requirement source. Only an approved test-author phase
   may change frozen tests.
