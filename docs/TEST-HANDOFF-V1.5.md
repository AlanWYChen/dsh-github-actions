# v1.5 test handoff — cache lifetime and response ordering

**Status: FINAL.** New suite `test/ux3.test.js` authored, RED-validated against
the current (v1.4) implementation, satisfiability-checked, and frozen. No
existing test file, fixture, `scripts/run-tests.mjs`, or `src/` file was edited.

- Contract: [`REQUIREMENTS.md`](../REQUIREMENTS.md) "v1.5 increment — cache
  lifetime and response ordering" (§25 cache survives panel unmount/remount,
  §26 same-workspace response ordering, §27 acceptance criteria).
- Test author: `test-author` (does not implement)
- Verifier observations (2026-11-14): (1) the v1.4 snapshot cache lived in the
  page component's `useRef`, so leaving the panel and returning refetched;
  (2) concurrent reads for the same workspace could complete out of order, and an
  older failure could banner over a newer success.

## 1. Artifacts

| Path | Kind | Tests |
| --- | --- | --- |
| `test/ux3.test.js` | NEW v1.5 acceptance suite (imports the frozen client harness read-only and drives it with deferred RPC promises) | 2 |
| all other `test/*.test.js`, `test/fixtures/*`, `scripts/run-tests.mjs` | untouched | 93 existing |

Suite size: **95 tests** (93 frozen v1–v1.4 + 2 v1.5). The runner globs
`test/*.test.js`; the gate is `all`.

## 2. Commands

```sh
node scripts/run-tests.mjs all     # gate (RED evidence below)
node --test test/ux3.test.js       # v1.5 suite only
```

## 3. RED evidence (against the current v1.4 implementation, 2026-11-14)

```text
$ node scripts/run-tests.mjs all
Running all tests (10 files).
ℹ tests 95
ℹ pass 93
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Both new tests fail for the verifier's findings; no import/syntax/harness errors;
all 93 existing tests pass:

| New test | Observed RED failure |
| --- | --- |
| the module-scope cache survives unmount/remount, stays bounded across mounts, and is dropped by a fresh module (reload) | `cached rows survive remount` fails: the cache is page-component-scoped, so the remount shows loading instead of A's rows |
| out-of-order same-workspace reads: the newer token wins in state and cache, and an older failure cannot banner over it | `the newer response stays rendered` fails: the older response (resolved later) overwrites the newer one |

**Satisfiability validation.** Both tests pass **2/2** against a throwaway v1.5
reference stub outside the workspace (`/tmp`, deleted): the cache was moved to
module scope and per-workspace request tokens were added. The full stub gate was
**95/95**, confirming the new suite is satisfiable and the 93 frozen tests stay
green under the v1.5 changes. No production file was changed in this workspace.

## 4. Coverage map (§25–§27)

| Requirement | Test |
| --- | --- |
| §25/§27.1 cache lives for the loaded client module, not the component: mount A → settle → unmount the page → remount in the same module instance renders cached rows immediately with zero loading, and a background snapshot read still runs without `refresh:true` | `the module-scope cache survives unmount/remount, stays bounded across mounts, and is dropped by a fresh module (reload)` |
| §25/§27.1 bound still ≤ 20 entries across mounts (fill past 20, remount, oldest entry shows loading) | same test |
| §25 cache is dropped by a page reload (simulated by a fresh module instance/harness: loading again, no old rows) | same test |
| §26/§27.2 two concurrent same-workspace reads; newer resolves first; older resolves later and must not win in render or in the cache | `out-of-order same-workspace reads: the newer token wins in state and cache, and an older failure cannot banner over it` |
| §26/§27.2 an older failing read cannot clear the newer success or surface the error banner | same test |

## 5. Seams and observability

- Rendering uses the frozen `test/fixtures/client-harness.mjs` **read-only**.
  `createHarness({ rpc })` supplies a deferred fake: `status` resolves
  immediately and each `githubActions.snapshot` call is a controllable promise in
  a per-workspace queue, so the test can resolve reads out of order.
- **Unmount/remount simulation.** A real React unmount discards the page
  component's hook state (`useState`/`useRef`/`useMemo`/effects) while the loaded
  client module and its module-scope cache survive. The frozen harness keeps hook
  slots in its instance table, so after `harness.unmount()` the test clears the
  page instance's hook slots (`renderer.instanceFor('page')`) and then calls
  `mountPage()` again — exactly a fresh component instance in the same module.
  This is what distinguishes a component-scoped `useRef` cache (lost → loading,
  RED) from a module-scope `Map` (kept → cached rows).
- **Page reload simulation.** A new `createHarness()` evaluates `src/client.js` in
  a fresh `vm` context, i.e. a fresh module factory invocation, which must start
  with no cache.
- Concurrency for the ordering test is produced through the normal component
  behavior: leave A (read 1 pending), return to A (no cache yet → read 2 issued),
  then settle read 2 before read 1. Later, a cache-hit return issues a background
  read, and leaving/returning again issues another concurrent read.
- No network, no real DOM.

## 6. Interpretations and not-covered / limitations

- "Module-scope" is observed through the required behavior: the cache survives a
  page component unmount/remount and is dropped by a fresh module instance. The
  test does not inspect a variable name or distinguish factory scope from an
  `apply`-closure map; both survive a panel remount and drop on reload.
- "Monotonically increasing per-workspace token" is not inspected directly; the
  observable contract is tested (older success/failure cannot win after a newer
  read). Any equivalent token/generation scheme passes.
- The bound test drives 21 workspaces after a remount and asserts the oldest entry
  is gone; insertion-order eviction and LRU both evict that entry here.
- Persistence-off is tested only via a fresh module instance; the frozen harness
  storage is a no-op, so disk writes are not observable.
- Pending reads for workspaces the user left are not settled at the end of the
  ordering test; they are inert and the page is unmounted.

## 7. Frozen hashes (FINAL)

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
e58eac813315559567fe9ede7363d81a70c340128c518e0c91736d38ed549f12  test/ux3.test.js   (NEW v1.5 suite)
9551b7cee180a9718da1eb994d459a506af7c6c28b20cce561188db7fe0965d0  test/fixtures/client-harness.mjs
c8423365add720284a884920b38e831ac7c5886f9812da84e05e6c6e732396be  test/fixtures/host-harness.mjs
```

Machine-readable: [`frozen-tests.json`](frozen-tests.json) (`v15Freeze`,
`v15Red`, `freezeStatus: final`).

## 8. Implementer instructions

1. Move the snapshot cache to client-module (factory) scope — one `Map` for the
   module lifetime, session-only, never persisted, still ≤ 20 entries — and keep
   the cached snapshot render on (re)mount without a loading flash.
2. Add per-workspace request tokens: a read applies only if its token is the
   latest issued for that workspace; older successes and older failures are
   ignored (no state/cache overwrite, no banner).
3. Do **not** edit anything under `test/` or `scripts/run-tests.mjs`.
4. Run `node scripts/run-tests.mjs all`; the GREEN gate is **95/95**.
5. If a v1.5 test looks wrong, stop and escalate with path/line, command,
   expected behavior, and requirement source.
