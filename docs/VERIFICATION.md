# Independent verification — GitHub Actions for DSH (v1 + v1.1 + v1.2)

- Verifier: `verifier` (independent reviewer; read-only except this report)
- v1.2 final pass: 2026-11-11 (America/Toronto), after the v1.2 implementation was installed
- Workspace: `/Users/alanchen/Local Documents/Dev/dsh-github-intergration`
- Installed profile: `web`, `DSH_PROFILE_DIR=~/.dsh/profiles/web`, DSH Web GUI `http://127.0.0.1:3080`
- Installed package: `~/.dsh/profiles/web/node_modules/@local/dsh-github-actions` → symlink to the workspace; installed and workspace `src/` hashes are identical
- Installed v1.2 source hashes: `src/client.js` `6a3e9b2e0ed6a0a741896594292f153fab8665da72acb2c9eb88a76989f8df35`, `src/index.js` `9b7f3aebd36dd859dd5d2098e7f808da98d80e27d809a14393d49fa347bdba75`, `src/runs.js` `ce6a6252611e273d2cc5f4f04c8767ef51f18e854bf207efd4605a349e8e85b7`, `src/remotes.js` `82e4a6f6ac6b0e37bc2284c1c623fe30a741a6afb95392bacbf0e5275fd18d05` (all in the appendix); the v1.1 pass hashes are historical and the current installed files are shown below.
- Freeze state: `docs/frozen-tests.json` `freezeStatus: "final"`, `testsOnceImplemented: 80`, ten frozen files (v1.2 adds `test/layout.test.js`), two documented `approvedContractRevisions`; `docs/TEST-HANDOFF-V1.2.md` is marked finalized. The verifier made no test or source edits.
- Scope note: shell/host verification only. No browser session or cookie was available; client registration and rendering remain user-verified after a page refresh.

## Final verdict (v1 + v1.1 + v1.2)

**PASS** — v1.2 layout/scroll contract, gate and freeze integrity verify; the v1.1 host/history contract and the v1 baseline remain green. No HIGH or MEDIUM findings. Remaining items are non-blocking: **1 LOW (stale-warning channel, carried from v1) + 3 NIT** (one new responsive pill-width risk, one template-duplication maintainability nit, one carried scoped-style nit). Client registration and visual rendering are user-verified after a page refresh (not claimed as observed).

- Gate: `node scripts/run-tests.mjs all` → **80/80 pass, 0 fail, exit 0**; targeted `node --test test/layout.test.js` → **6/6**.
- Frozen integrity: **10/10** hashes match `docs/frozen-tests.json`.
- v1.2 layout source: **13/13** independent checks pass — one shared six-column template, fixed workflow/branch/event/status columns (no `max-content`), six cells always rendered, shared centered fixed-width pill, bounded themed scroll containers with `tabIndex`/`aria-label`, sticky headings, per-list header rows, responsive shared rule.
- v1.1: previous pass gate 74/74; host drive **31/31** scenario checks + **7/7** edge probes (retained below).
- Client source: `inject = ["slots","locale","connection"]`; locale inline/files **74/74 exact** (8 new header/a11y keys); theme tokens **16 used / 0 missing**; zero literal hex/rgb/hsl colors.
- Security: no token in any snapshot/history/error/`historyWarning`; history URL validated/encoded; hostile remote → `not-github` with zero reads.

## v1.2 — layout and scrolling (this pass)

### Contract and freeze

- Requirements: `REQUIREMENTS.md` §14 (layout contract) and §15 (acceptance criteria): the three user-reported defects (pill widths, workflow-column x-position, bounded scrolling) plus header rows and the ≤720px responsive rule.
- Frozen suite: new `test/layout.test.js` (6 tests, `315ce4fb…`); no existing test file, fixture, `scripts/run-tests.mjs`, or `src/` file was edited by the test author. `freezeStatus: final`; no new `approvedContractRevisions` were needed for v1.2.
- Final RED evidence: `v12Red` in `docs/frozen-tests.json` — 80 tests / 74 pass / 6 fail, all six failures behavioral for missing v1.2 layout/scroll/locale behavior; existing 74 stayed green.
- Installed Config row: `include:github-actions`, `status: "schema"`. (The installed `src/index.js` also differs from v1.1: it adds the `clearCredentialOnce` guard and updates the config comment to nine fields — the two prior NIT fixes. This is not a v1.2 layout surface; the 80/80 gate and a direct double-401 probe confirm no host regression. `LOW-1` below remains.)

### Checks and evidence

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Gate | **PASS** | `node scripts/run-tests.mjs all` → `tests 80 / pass 80 / fail 0`, exit `0`. |
| 2 | 10 frozen hashes | **PASS** | `scripts/run-tests.mjs`, seven `test/*.test.js` and both fixtures match `docs/frozen-tests.json`, including new `test/layout.test.js`. |
| 3 | Syntax | **PASS** | `node --check` on all six `src/*.js` → OK. |
| 4 | One shared six-column template | **PASS** | `.gha-run` and `.gha-header` both declare `grid-template-columns:minmax(0,1fr) 140px 140px 110px 96px 132px` (identical 6 tracks); every data row carries `.gha-run`; no inline `gridTemplateColumns` or per-row override. |
| 5 | Fixed workflow/branch/event columns | **PASS** | Workflow/branch = `140px`, event = `110px`, time = `96px`, status = `132px`; no `max-content` in the row template. The only `max-content` in the file is the unrelated config-form `.gha-fields`. |
| 6 | All six cells always rendered | **PASS** | Both `renderRunRow` and `renderHistoryRow` render exactly six `h('span')` cells; branch/event render `run.branch ?? ''` / `run.event ?? ''` instead of conditional omission. |
| 7 | Shared fixed-width centered pill | **PASS** | `.gha-pill` has `min-width:112px`, `justify-content:center`, `justify-self:center`, `white-space:nowrap`; all active and conclusion pills use `.gha-pill`; tone classes only set border/background/color, no width/centering override. |
| 8 | Bounded scroll container | **PASS** | `.gha-scroll` has `overflow-y:auto`, `max-height:min(52vh, 640px)`, `scrollbar-width:thin`, tokenized `scrollbar-color`, plus `::-webkit-scrollbar` width/thumb/track rules; each section renders one `.gha-scroll`. |
| 9 | Keyboard/ARIA scrolling | **PASS** | The scroll container renders `tabIndex: 0` and `aria-label` from `a11y.runningList` / `a11y.recentList`. |
| 10 | Sticky headings + warning placement | **PASS** | `.gha-section-title` is `position:sticky; top:0; z-index:1` with a token background; it is inside `.gha-scroll`; `historyWarning` is also inside the scroll container before the Recent header/rows. |
| 11 | Header rows | **PASS** | `renderHeader` is called once per list inside the scroll container; six cells; `role="presentation"`, `aria-hidden="true"`, no click handler; Running uses an empty fifth (time) cell, Recent shows `header.completed` there. |
| 12 | ≤720px responsive rule | **PASS** | `.gha-run,.gha-header` both switch to `minmax(0,1fr) 120px 96px 120px`; `.gha-run-branch/.gha-run-event/.gha-header-branch/.gha-header-event` are `display:none` — shared template preserved. |
| 13 | Locale parity | **PASS** | Inline `en`/`zh` 74 keys each; `locale/en.json`/`locale/zh.json` 74 each; identical key sets and zero value differences; all 8 new keys (`header.name/workflow/branch/event/status/completed`, `a11y.runningList/recentList`) present in all four dictionaries. |
| 14 | Theme tokens / no literal colors | **PASS** | All 16 `var(--dsw-alias-*)` used in `src/client.js` exist in the running theme; CSS scan for hex/rgb/rgba/hsl/hsla = 0 hits. |
| 15 | Client module contract | **PASS** | Loading through the module-loader contract returns `inject = ["slots", "locale", "connection"]`; existing registrations unchanged. |
| 16 | Client rendering / registration | **NOT VERIFIED from shell** | The frozen `vm` layout tests (6/6) parse the real rendered tree and stylesheet, but no browser/CSSOM/layout engine is available; no page-level visual claim is made. |

### User-reported defects at source level

- **(a) Success/Failed pills different widths** — addressed: every pill carries the same `.gha-pill` class with a fixed `min-width:112px` and centered content; tone classes (`gha-pill-success`, `gha-pill-failure`, `gha-pill-neutral`, running/queued) only change colors. Success and Failed therefore have identical width class and geometry.
- **(b) Middle "CI" workflow column not aligned** — addressed: both row kinds share the `.gha-run` six-column fixed template (workflow track `140px`), all six cells are always emitted (branch/event empty strings instead of omission), and there is no `max-content`/inline per-row override. The workflow cell starts at the same track on every row.
- **(c) Recent list not scrollable** — addressed: each section is a `.gha-scroll` with `overflow-y:auto` and `max-height:min(52vh, 640px)`, themed thin scrollbar, `tabIndex=0` and a localized aria-label; the heading is sticky inside the scroller and the Recent warning scrolls with the rows.

### Findings (v1.2)

- **LOW-1 (carried from v1) — stale active warning is on `value.warning`, not `details.warning`.** `src/index.js:812`; `REQUIREMENTS.md:155`; frozen handoff A2 accepts alternative locations (`docs/TEST-HANDOFF.md:378-383`). The client reads `snapshot.stale`, so behavior is correct today. Smallest fix: add `details.warning` to the success envelope (or record A2 as the accepted contract).
- **NIT-1 (new, responsive) — `.gha-pill` can exceed the ≤720px status track under content-box sizing.** `src/client.js:337`: `min-width:112px` is a content width, and with `padding:2px 9px` + `1px` borders the total is ~132px; the ≤720px rule (`src/client.js:358`) gives the status column `120px`. The plugin sets no `box-sizing`, and no global `* { box-sizing:border-box }` reset was found in the installed app packages, so the pill may overflow/overlap at narrow widths. Smallest fix: add `box-sizing:border-box` to `.gha-pill` (total then 112px, fits 120px) or widen the mobile status track to 132px. Browser confirmation is user-only.
- **NIT-2 (maintainability) — the six-column template literal is duplicated in `.gha-run` and `.gha-header`.** `src/client.js:333` and `src/client.js:349`; values are identical today, so the current alignment is correct, but the "one shared constant" intent is only met for data rows via the shared `.gha-run` class. Smallest fix: define one CSS custom property or one shared class/JS constant and use it for both rules.
- **NIT-3 (carried) — scoped stylesheet injection is a DOM write outside the component (strict reading).** `src/client.js:361-407` via `ctx.effect` at `:1246`; intentional, idempotent (`getElementById`) and disposed with the plugin.

### User-verifiable checks (v1.2 additions)

1. Refresh `http://127.0.0.1:3080` and open the GitHub Actions panel.
2. Confirm Success and Failed (and every other conclusion) pills render at the same width in one right-aligned column; no text wrapping.
3. Confirm the workflow column ("CI") starts at the same x-position on every Running and Recent row, regardless of branch/event lengths.
4. Grow either list; confirm it scrolls inside a bounded area, the section heading stays pinned while rows scroll, and the Recent warning scrolls with the rows.
5. Confirm the header row above each list shows the localized Name / Workflow / Branch / Event / Status labels (plus Completed for Recent), is not clickable, and aligns with the data columns.
6. Narrow the browser below 720px and confirm branch/event columns disappear, the remaining columns stay aligned, and the conclusion pill does not visibly overflow (this is where NIT-1 would show).
7. Confirm both scroll areas are keyboard-focusable and announced with their localized list labels; confirm client registration/icon/render still correct after the refresh.



## v1.1 — historical runs (v1.1 pass, retained)

### Contract and freeze

- Requirements: `REQUIREMENTS.md` §11 (Host history read), §12 (Client Recent section), §13 (acceptance criteria).
- Frozen suite: `test/history.test.js` (17 new tests) + the approved revisions in `test/runs.test.js` / `test/host.test.js`; `freezeStatus: final`. The final RED evidence is recorded in `docs/frozen-tests.json` (`v11RedAfterApprovedRevision`: 74 tests / 52 pass / 22 fail, all behavioral/expected-value).
- Approved revisions verified by manifest hash, not re-edited: `test/host.test.js` `d95492db…` (Config defaults + two-read/cache assertions), `test/runs.test.js` `44cd8a85…` (completedAt), new `test/history.test.js` `89933763…`, new fixtures `c8423365…` / `9551b7ce…`.
- Config row live: `include:github-actions`, `status: "schema"`; startup import gives `Config[Symbol.for('schemastery')] === true` with defaults `historyLimit: 20`, `historyRefreshMs: 15000` and all nine fields.

### Checks and evidence

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Gate | **PASS** | `node scripts/run-tests.mjs all` → `tests 74 / pass 74 / fail 0`, exit `0`. |
| 2 | 9 frozen hashes | **PASS** | `shasum -a 256` of `scripts/run-tests.mjs`, `test/*.test.js`, `test/fixtures/*.mjs` matches every manifest entry, including the two approved revisions. |
| 3 | Syntax | **PASS** | `node --check` on all six `src/*.js` → OK. |
| 4 | Host surface | **PASS** | Config row `schema`; profile bundle list contains the package; startup import resolves the module and the native Config graph. |
| 5 | Exactly two reads | **PASS** | Signed-in GitHub checkout: exactly `2` fetches — active `GET https://api.github.com/repos/octo/hello/actions/runs?per_page=50`, history `GET …/actions/runs?status=completed&per_page=20`; both carry `Authorization: Bearer …`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. |
| 6 | History mapping/order/cap | **PASS** | Completed only; newest `completedAt` first; `historyLimit` caps both `per_page` and the returned list; `updated_at` used with `created_at` fallback; missing conclusion → `null`; active runs keep `conclusion: null` / `completedAt: null`. |
| 7 | Independent caches | **PASS** | First call 1 active/1 history; warm call 0/0; past `refreshMs` but inside `historyRefreshMs` → active-only re-read with history preserved; past `historyRefreshMs` → history re-read; reverse TTLs tested (history stale, active fresh) → history-only re-read. |
| 8 | `refresh: true` | **PASS** | Bypasses both caches, including when both are fresh; a subsequent call reuses the refreshed caches. |
| 9 | History failure | **PASS** | With a previous history: `ok:true`, previous history preserved, non-empty `historyWarning`. First history failure: `history: []` + warning. Unreadable history JSON: same downgrade. Active list still returned. |
| 10 | Rate-limit asymmetry | **PASS** | History 403/429 with `x-ratelimit-remaining: 0` → `ok:true` + `historyWarning`; active 403/429 with the same headers → `rate-limited` error with `details.reset`. |
| 11 | 401 on history | **PASS** | `auth-required`, credential deleted (`deleteRecord` observed), snapshot fails; no token in the error. |
| 12 | Active v1 semantics | **PASS** | Active failure without cache → `github-unreachable`; active failure with cache → `stale:true` + warning; active rate-limit remains an error. |
| 13 | Signed out | **PASS** | `history: []`, `runs: []`, `fetchedAt: null`; zero GitHub calls (the fake throws if called). |
| 14 | Config defaults/clamps | **PASS** | `Config()` → `historyLimit: 20`, `historyRefreshMs: 15000`; runtime `historyLimit` 0/500/2.7 → `per_page` 1/100/2; default TTL observed via a mutable clock (active re-read at 3.1 s, history re-read at 15.1 s). |
| 15 | Token secrecy | **PASS** | `gho_host_secret` absent from every snapshot, history, `historyWarning` and RPC error JSON; token only in the two Authorization headers and the credential record. |
| 16 | Injection/URL safety | **PASS** | History URL percent-encodes hostile segments (`repoApiHistoryUrl`, direct test); a lookalike remote (`github.com.evil.io`) yields `not-github` and zero reads; owner/name are `isSafeSegment`-checked before both URLs; `historyLimit` is clamped to an integer 1..100 before interpolation. |
| 17 | Client sections | **PASS** (source review) | In the ready panel, Running is rendered above Recent; both sections are unconditional with their own empty line (`empty`, `empty.history`); `historyWarning` is rendered inside Recent above the rows/empty line (src/client.js:1111-1165). |
| 18 | Conclusion pills/theme | **PASS** | Map covers success/failure/cancelled/skipped/neutral/timed_out/action_required/unknown; all pill classes use existing theme tokens; independent token scan: **16 used, 0 missing**; 0 literal hex/rgb/hsl colors. |
| 19 | Recent row activation | **PASS** (source review) | Recent rows have `role=listitem`, `tabIndex: 0`, `title=htmlUrl`, `onClick` and `onKeyDown` (Enter/Space/Spacebar) → `openInNewTab` (src/client.js:887-899, 936-967). |
| 20 | Locale parity | **PASS** | Inline `en` 66 / `zh` 66, identical key sets; `locale/en.json` 66 / `locale/zh.json` 66, identical sets and **zero value differences**; all new keys (`section.*`, `empty.history`, `conclusion.*`) exist in all four dictionaries; strings match §12. |
| 21 | Client module `inject` | **PASS** | Loading `src/client.js` through the module-loader contract returns `inject = ["slots", "locale", "connection"]` (src/client.js:21, 1250). |
| 22 | Client registration/rendering | **NOT VERIFIED from shell** | Slots/`main` registration and visual rendering cannot be observed without the browser; the frozen `vm` client tests pass in the 74/74 gate, but no page-level claim is made. |

### Host drive detail (harness-style fakes, no real network/subprocess)

- Scenario checks (31/31): A1-A5 exactly two documented requests/URLs/headers; A6 active-only nulls; A7-A8 history order/cap/fallback/null conclusion; A11 `historyLimit` request/cap; B1-B5 cache cadence and `refresh:true`; C1-C8 failure/401/rate-limit/signed-out/active semantics/hostile remote; D1-D4 defaults/clamps; E1 URL encoding.
- Additional edge probes (7/7): history-only re-read when active TTL is longer; `refresh:true` with both caches fresh; history failure while active served from cache (preserved + warning, `stale:false`); active failure with cached active (`stale:true`, history preserved); both-read 401; unreadable history body; observed both-401 delete count (2; idempotent in the fake, see NIT).
- Cache/refresh matrix observed: first 1 active/1 history; warm 1/1; at +3.1 s 2/1 (history preserved); at +15.1 s 2/2; `refresh:true` 3/2; immediate reuse 3/2.
- Both reads are launched concurrently before `Promise.all` (src/index.js:650-714); each request inherits the `timeoutMs` bound in the real `apply` path via `createTimedFetch` (src/index.js:1028).

### Findings (v1.1 pass; current status reflected in the v1.2 section)

No HIGH or MEDIUM findings. The v1.1 contract was implemented and independently exercised.

- **LOW-1 (carried from v1) — stale active warning is on `value.warning`, not `details.warning`.** Current source location `src/index.js:812`; requirement `REQUIREMENTS.md:155`; the frozen handoff accepts alternative locations (`docs/TEST-HANDOFF.md:378-383`, A2). The client reads `snapshot.stale`, so behavior is correct today. Smallest fix: add `details.warning` to the success envelope (or record A2 as the accepted contract). **Still open.**
- **NIT-1 — simultaneous 401s deleted the credential twice.** **RESOLVED in the v1.2-era `src/index.js`:** a per-snapshot `clearCredentialOnce` guard now exists (`src/index.js:666-674`), and a direct double-401 probe records `deleteRecord` exactly once while still returning `auth-required`.
- **NIT-2 — scoped stylesheet injection is a DOM write outside the component (strict reading).** `src/client.js:361-407`, called from `ctx.effect` at `:1246`; intentional, idempotent (`getElementById`), and disposed with the plugin. **Still open (carried).**
- **NIT-3 — stale code comment.** **RESOLVED in the v1.2-era `src/index.js`:** the comment now says "§7 + §11 config ... nine documented fields" (`src/index.js:124-127`).

Resolved since the v1.1 report: the v1 HIGH theme-token defect (16/16 defined), the LOW locale drift (74/74 exact as of v1.2), the initial hidden-tab fetch (`src/client.js:555`), and the README dependency wording (`README.md:222`). The earlier v1 findings (editor fallback, raw error code, missing HTTP timeout) remain resolved.

### User-verifiable checks (v1.1 additions)

1. Refresh `http://127.0.0.1:3080`; open the GitHub Actions panel.
2. In the ready state, confirm **Running** above **Recent**, each with its own empty line ("No runs are currently running." / "No finished runs yet.").
3. With finished runs, confirm conclusion pills map Success / Failed / Cancelled / Skipped / Neutral / Timed out / Action required / Unknown, the recent rows show name/workflow/branch/event/time-since-completion, and click/Enter/Space opens the run in a new tab.
4. Confirm a `historyWarning` line appears above the Recent rows when the Host reports one, without hiding the rows.
5. Confirm the new sections and pills render with the theme tokens (visual check), and that polling still pauses when the tab is hidden.
6. Optional: confirm the bundle entry `include:github-actions` is enabled in the plugin manager; the shell `plugin_manager` call is rejected in this session.

## v1.0 baseline (previous final pass, for context)

- v1.0 gate was 57/57; v1.0 security findings (token secrecy, no shell, 401/rate-limit, payload validation) and live device-flow `begin` were verified in the previous pass. The v1.1 host edits are additive: `src/device-flow.js` and `src/git.js` hashes are unchanged; `src/index.js`/`remotes.js`/`runs.js` gained only the history paths and mapping fields.
- v1.0 findings resolved in/after that pass: editor-fallback corruption (now exact-row match only, `src/index.js:471-487`), raw `ENOTFOUND` leaking as an RPC code (`asHostError` whitelist, `src/index.js:851-900`), missing GitHub HTTP timeout (`createTimedFetch`, `src/index.js:289-346` + `apply`), theme-token HIGH (16/16 defined), locale drift, initial hidden fetch, README dependency wording.
- v1.0 LOW-1 (stale warning channel) is the only finding carried into v1.1.

## Honest limitations

- No browser, DOM, CSSOM, or screenshot access: client slot registration and visual rendering are **not** claimed. v1.2 layout evidence is source/CSS parsing plus the frozen `vm` layout tests (6/6) in the 80/80 gate; actual scrolling, sticky paint, scrollbar appearance, and the mobile pill fit require browser confirmation (user-only).
- No real end-to-end sign-in was repeated for v1.2: the device-flow code is unchanged and was exercised live (`begin`/`cancel`, no token) in the v1 pass. No access token was stored; the verifier did not modify the profile or `~/.dsh`.
- No real-token snapshot: the host history drive used injected fakes and a real temp checkout; no token was written to the credential store.
- `plugin_manager list_plugins` could not run (auto-rejected `danger-full-access`); bundle-enabled evidence is the live Config row, profile bundle list and workspace patch.
- Theme-token existence was checked against the running `@deepseek-ai/dsh-client-ui-theme` 0.2.2-rc.1 definitions, not rendered.
- The installed `src/index.js` changed during the v1.2 round even though v1.2 is a client-only increment; the visible changes are the two prior NIT fixes (`clearCredentialOnce`, nine-field comment). The full 80/80 gate and a direct double-401 probe show no host regression.

## Appendix — final artifacts

Protected (all match `docs/frozen-tests.json`):

```text
9d9cac19cde432d5e3fa067845fc2c8a46e3fb010f2ee2ae77bd2334c6757d3b  scripts/run-tests.mjs
c4085cfb8d47d0b4c36fd7db7d3d2c347044f8460f690ab97e382e77875270ce  test/client.test.js
30c4942dda24f64833b89c1664f2c491a4872a89e507d6e1a33bb883a4d62ae8  test/device-flow.test.js
899337632c9951eba138b6077918a35e400b82034d3651f8d3383fe59499e294  test/history.test.js
d95492db2d36525bfe7b9b386a293617fe26f4aa30d2a6d77796fef4fca2f285  test/host.test.js
315ce4fb03eaac278e9acdecc6e494ffd8d504bad37dccdea71564a95f607517  test/layout.test.js
160274f697fc385a5e07b1bcaf3ee8c5235c839d8d253e8ff13b1cb402f39fc0  test/remotes.test.js
44cd8a8586ee024a61d824545c320e6584ea7ab0aa7386b9bc82018ba3c97f2b  test/runs.test.js
9551b7cee180a9718da1eb994d459a506af7c6c28b20cce561188db7fe0965d0  test/fixtures/client-harness.mjs
c8423365add720284a884920b38e831ac7c5886f9812da84e05e6c6e732396be  test/fixtures/host-harness.mjs
```

Source snapshot (workspace and installed profile symlink are byte-identical):

```text
6a3e9b2e0ed6a0a741896594292f153fab8665da72acb2c9eb88a76989f8df35  src/client.js
7a52ba87107dd2e5788fff5a68325eda8b1e5d1fc2eaec421820d552f2b6c5b2  src/device-flow.js
83a7beeadd4f488878b2926a0c5f848885714c5bedd95d0ec435528de666a105  src/git.js
9b7f3aebd36dd859dd5d2098e7f808da98d80e27d809a14393d49fa347bdba75  src/index.js
82e4a6f6ac6b0e37bc2284c1c623fe30a741a6afb95392bacbf0e5275fd18d05  src/remotes.js
ce6a6252611e273d2cc5f4f04c8767ef51f18e854bf207efd4605a349e8e85b7  src/runs.js
```

Commands used for this pass (v1.1 scripts retained for history evidence):

```sh
node scripts/run-tests.mjs all
node --test test/layout.test.js
shasum -a 256 scripts/run-tests.mjs test/*.test.js test/fixtures/*.mjs
for f in src/*.js; do node --check "$f"; done
node /tmp/gha-v12-layout.mjs    # 13/13 source-level layout checks + box-model arithmetic
node /tmp/gha-v12-client.mjs    # inject, 74/74 locale parity, 16/16 theme tokens
node /tmp/gha-v11-host.mjs      # retained v1.1 host scenarios (31/31)
node /tmp/gha-v11-edge.mjs      # retained v1.1 edge probes (7/7; F5b delete count now 1)
cd ~/.dsh/profiles/web && node --input-type=module -e "import('@local/dsh-github-actions')…"
```

Throwaway scripts lived only in `/tmp`; no production file, test, fixture, or frozen artifact was modified by the verifier. The only file changed by this pass is `docs/VERIFICATION.md`.
