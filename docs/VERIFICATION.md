# Independent verification — GitHub Actions for DSH (v1 + v1.1 + v1.2 + v1.3 + v1.4 + v1.5)

- Verifier: `verifier` (independent reviewer; read-only except this report)
- v1.5 final pass: 2026-11-14 (America/Toronto), after the v1.5 implementation was installed
- Workspace: `/Users/alanchen/Local Documents/Dev/dsh-github-actions`
- Installed profile: `web`, `DSH_PROFILE_DIR=~/.dsh/profiles/web`, DSH Web GUI `http://127.0.0.1:3080`
- Installed package: `~/.dsh/profiles/web/node_modules/@local/dsh-github-actions` → symlink to the workspace; installed and workspace `src/` hashes are identical
- Installed v1.5 source hashes: `src/client.js` `fc5018cfb274d4645e74b065e74e2915be66b9d6b11425b9b951ea43d82759cf`, `src/index.js` `9b7f3aebd36dd859dd5d2098e7f808da98d80e27d809a14393d49fa347bdba75` (unchanged since v1.2), `src/runs.js` `ce6a6252611e273d2cc5f4f04c8767ef51f18e854bf207efd4605a349e8e85b7`, `src/remotes.js` `82e4a6f6ac6b0e37bc2284c1c623fe30a741a6afb95392bacbf0e5275fd18d05` (all in the appendix); earlier pass hashes are historical.
- Freeze state: `docs/frozen-tests.json` `freezeStatus: "final"`, `testsOnceImplemented: 95`, thirteen frozen files (v1.5 adds `test/ux3.test.js`), four documented `approvedContractRevisions` (v1.5 needed none); `docs/TEST-HANDOFF-V1.5.md` is marked finalized. The verifier made no test or source edits.
- Scope note: shell/host verification only. No browser session or cookie was available; client registration and rendering remain user-verified after a page refresh.

## Final verdict (v1 + v1.1 + v1.2 + v1.3 + v1.4 + v1.5)

**PASS (definitive over v1–v1.5)** — v1.5 gate/freeze, module-scope cache lifetime, remount behavior, same-workspace response ordering, left-workspace stale guard, and the v1.4/v1.3/v1.1/v1 baseline all verify. The v1.5 checks were driven through the client harness with deferred per-workspace RPC (5/5 v1.5 checks; v1.4 drive retained at 9/9). Only **LOW-2 (carried `value.warning` vs `details.warning`) + NIT-2 (carried scoped `<style>`)** remain. Browser visual confirmation is still user-only.

- Gate: `node scripts/run-tests.mjs all` → **95/95 pass, 0 fail, exit 0**; targeted `node --test test/ux3.test.js` → **2/2**, `test/ux2.test.js` → **7/7**, `test/ux.test.js` → **6/6**.
- Frozen integrity: **13/13** hashes match `docs/frozen-tests.json`.
- v1.5 cache lifetime: cache is module/factory-scope; unmount/remount in the same module renders rows immediately with no loading and still issues a background read (no `refresh:true`); a fresh module instance (reload) shows loading; the 20-entry bound/eviction still holds (retained 21-workspace drive).
- v1.5 ordering: newer same-workspace token wins in rendered state and cache; an older late success cannot overwrite it; an older failure cannot banner over the newer success; the left-workspace stale guard still holds.
- Retained v1.4: cache A→B→A, loading state, failed-refresh rows+banner, toolbar, spacing; locale **76/76 exact**, theme **16/16 defined**, 0 literal colors.
- v1.3/v1.2/v1.1: previous gates 86/80/74; v1.1 host drive 31/31 + 7/7 retained below.
- Security: unchanged v1.1 checks (no token in snapshot/history/error/`historyWarning`; validated/encoded history URL).

## v1.5 — cache lifetime and response ordering (this pass)

### Contract and freeze

- Requirements: `REQUIREMENTS.md` §25 (cache lifetime), §26 (same-workspace response ordering), §27 (acceptance criteria).
- Frozen suite: new `test/ux3.test.js` (2 tests, `e58eac…`); no existing test, fixture, runner or `src/` file was edited by the test author. `freezeStatus: final`; v1.5 needed no approved contract revision.
- Final RED: `v15Red` in `docs/frozen-tests.json` — 95 tests / 93 pass / 2 fail; both failures behavioral for the old component-ref cache and missing request tokens; all 93 existing stayed green.
- Config row live: `include:github-actions`, `status: "schema"`. `src/index.js` unchanged from v1.2 (`9b7f3aeb…`); v1.5 changes `src/client.js` only.

### Checks and evidence

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Gate | **PASS** | `node scripts/run-tests.mjs all` → `tests 95 / pass 95 / fail 0`, exit `0`; targeted `test/ux3.test.js` 2/2, v1.4 drive retained 9/9. |
| 2 | 13 frozen hashes | **PASS** | `scripts/run-tests.mjs`, ten `test/*.test.js` and both fixtures match `docs/frozen-tests.json`; new `test/ux3.test.js` `e58eac…`. |
| 3 | Syntax | **PASS** | `node --check` all six `src/*.js` → OK. |
| 4 | Module-scope cache remount | **PASS** (deferred-RPC drive) | Populate A, unmount the page component, mount again in the same harness/module: cached rows render immediately with **0** loading nodes and no blank; a background `githubActions.snapshot` read is issued with `refresh` not true. A fresh module instance (simulated reload) shows loading and an empty row list. |
| 5 | Cache bound ≤20 | **PASS** | `cacheSnapshot` evicts oldest while size >20; the retained 21-workspace drive (same module cache) still returns to the oldest with a loading state and a new read; the v1.5 frozen test asserts the bound across mounts. |
| 6 | Same-workspace ordering | **PASS** | Two concurrent reads for A: resolving the newer token first gives its row in state/cache; a late older success does not overwrite (id stays the newer one, including after remount from cache); a late older failure does not render a banner over the newer success. Source: `nextSnapshotRequestToken`/`latestRequestTokens`, checks before state/cache/banner (`src/client.js:519-543, 616-651`). |
| 7 | Left-workspace stale guard | **PASS** | A response for A resolving while B is active is still ignored; B stays rendered. The existing v1.4 drive also retains this check. |
| 8 | No host/locale regression | **PASS** | `src/index.js` hash unchanged (`9b7f3aeb…`); 95/95 gate includes all host/security tests; inline/files locale **76/76 exact**; theme **16/16 defined**; 0 literal colors. |
| 9 | Client module/registration | **PASS**; rendering user-only | Module-loader load still exports `inject = ["slots","locale","connection"]`; registrations unchanged; no browser/CSSOM for visual geometry. |

### Findings (v1.5)

No open v1.5-specific findings. The only remaining findings are the carried ones:

- **LOW-2 (carried from v1) — stale active warning is on `value.warning`, not `details.warning`.** `src/index.js:812`; `REQUIREMENTS.md:155`; frozen handoff A2 accepts alternative locations (`docs/TEST-HANDOFF.md:378-383`). Smallest fix: add `details.warning` to the success envelope or record A2 as the accepted contract.
- **NIT-2 (carried) — scoped stylesheet injection is a DOM write outside the component (strict reading).** `src/client.js:368-414` via `ctx.effect` at `:1332`; intentional, idempotent (`getElementById`) and disposed with the plugin.

Minor source observation, not scored: `latestRequestTokens` keeps one entry per workspace seen and is not bounded like the cache; negligible for realistic workspace counts. The previous v1.4 observations (same-workspace ordering and component-ref cache lifetime) are resolved by v1.5.

### User-verifiable checks (v1.5 additions)

1. Switch to another sidebar panel and back: the GitHub Actions rows should appear immediately from the module cache with no loading line; a background refresh may update them.
2. Reload the whole page: the cache is dropped and the panel shows "Loading runs…" for an uncached workspace.
3. Rapidly switch A→B→A and refresh several times: the newest response should remain; no old failure banner should replace a newer success (hard to force manually, source/tests cover it).
4. Cache bound/eviction: after visiting many workspaces in one page session, returning to the oldest should load again.
5. Retained v1.4 checks: loading line, failed-refresh rows + banner, toolbar title/link/width, 16px section gap, centered empty line, no host regressions.
6. Visual rendering/scroll/registration remains user-only after refresh.

## v1.4 — cache, loading, toolbar (v1.4 pass, retained)

### Contract and freeze

- Requirements: `REQUIREMENTS.md` §20 (in-memory snapshot cache), §21 (loading state), §22 (toolbar), §23 (spacing/empty state), §24 (acceptance criteria).
- Frozen suite: new `test/ux2.test.js` (7 tests, `5b940d…`); `test/ux.test.js` was revised under explicit user approval only for the two v1.3 dropdown-label assertions (`fb9579…` -> `a72867…`, now expecting the workspace title); no fixture/runner/`src/` file was edited by the test author. `freezeStatus: final`.
- Final RED: `v14Red` in `docs/frozen-tests.json` — 93 tests / 85 pass / 8 fail (7 new v1.4 behavior-missing + the expected pre-implementation v1.3 label failure); all behavioral, no import/harness errors.
- Config row live: `include:github-actions`, `status: "schema"`. `src/index.js` unchanged from v1.2 (`9b7f3aeb…`); v1.4 changes `src/client.js` + locale files.

### Checks and evidence

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Gate | **PASS** | `node scripts/run-tests.mjs all` → `tests 93 / pass 93 / fail 0`, exit `0`; targeted `test/ux2.test.js` 7/7 and `test/ux.test.js` 6/6. |
| 2 | 12 frozen hashes | **PASS** | `scripts/run-tests.mjs`, nine `test/*.test.js` and both fixtures match `docs/frozen-tests.json`; `test/ux.test.js` `a72867…` carries the approved label revision, `test/ux2.test.js` `5b940d…` is new. |
| 3 | Syntax | **PASS** | `node --check` on all six `src/*.js` → OK. |
| 4 | Cache hit A→B→A | **PASS** (deferred-RPC drive) | After A and B resolve, returning to A renders A's cached rows immediately with 0 loading nodes and 0 blank; the background `githubActions.snapshot` call is issued without `refresh:true`, and resolving it updates the row/cache. |
| 5 | Failed background refresh | **PASS** | Rejecting A's background read keeps the cached rows, renders `gha-banner`, and has no loading state; the cache entry remains. A failed read on an uncached workspace shows the error surface and is not cached (later selection shows loading again). |
| 6 | Cache bound ≤20 | **PASS** | Driving 21 workspaces and returning to the oldest shows the loading state and issues a new read (oldest insertion evicted); source uses a `Map` and evicts `keys().next()` while size > 20. |
| 7 | Stale left-workspace response | **PASS** | A success/error resolving after switching to another workspace is ignored (`activeWorkspaceIdRef` guard) and does not update that workspace's cache; returning to it shows the earlier cached snapshot, not the late response. |
| 8 | Loading state | **PASS** (rendered tree) | No cache + pending read → exactly one node with `role="status"` + `aria-live="polite"`, text `Loading runs…`; zero `role=list`, `gha-header`, `gha-empty-line`, `gha-run`; toolbar remains; `describeState(null)` still `error`; failure transitions to the error surface. |
| 9 | Toolbar | **PASS** (rendered tree + CSS) | Selected option label is `Alpha`/workspace title even with `octo/hello`; options are titles; `.gha-repo-link` after the select shows `octo/hello` + inline `currentColor` SVG with correct href/target/rel/aria-label; no repo → no link; select `min-width:240px;max-width:360px;width:auto;text-overflow:ellipsis;height:32px`; link `inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border;border-radius:8px;white-space:nowrap`; icon `display:block;flex:none;line-height:1`; toolbar/main `align-items:center`. |
| 10 | Spacing/empty | **PASS** | `.gha-runs{gap:16px}`; `.gha-empty-line{text-align:center;padding:14px;margin:0}`. |
| 11 | Locale/theme | **PASS** | Inline en/zh 76/76, locale files 76/76, identical key sets/values, including `loading` = "Loading runs…" (zh non-empty); 16/16 theme tokens defined; 0 literal hex/rgb/hsl. |
| 12 | Client module/registration | **PASS**; rendering user-only | Module-loader load still exports `inject = ["slots","locale","connection"]`; registrations unchanged. No browser/CSSOM available for actual visual geometry. |

### Findings (v1.4)

No open v1.4-specific findings. The only remaining findings are the carried ones:

- **LOW-2 (carried from v1) — stale active warning is on `value.warning`, not `details.warning`.** `src/index.js:812`; `REQUIREMENTS.md:155`; frozen handoff A2 accepts alternative locations (`docs/TEST-HANDOFF.md:378-383`). Smallest fix: add `details.warning` to the success envelope or record A2 as the accepted contract.
- **NIT-2 (carried) — scoped stylesheet injection is a DOM write outside the component (strict reading).** `src/client.js:368-414` via `ctx.effect` at `:1332`; intentional, idempotent (`getElementById`) and disposed with the plugin.

Source observations from v1.4 (now resolved by v1.5): same-workspace in-flight requests were not sequenced, and the cache was a page-component `useRef`. v1.5 adds per-workspace request tokens and moves the cache to module/factory scope; it remains non-persistent.

### User-verifiable checks (v1.4 additions)

1. With A and B cached, switch A→B→A: A's rows should appear immediately with no loading line/blank; a background refresh may update them.
2. On a workspace with no cache, the panel should show one centered "Loading runs…" status and no lists/headers/empty lines; then rows or the error surface.
3. Make a background refresh fail (e.g. offline) after a cache hit: rows stay and the error banner appears; no blanking.
4. Toolbar: dropdown always shows the project title (not `owner/name`); it is ~240–360px wide with ellipsis; the GitHub control after it shows `owner/name` + icon, is button-sized/centered on the same line; it disappears without a repo.
5. Running/Recent have a 16px gap; the empty line is horizontally centered with its inset.
6. Switch through enough projects to exercise the cache bound; returning to the oldest should load again. Browser refresh should drop the cache (not persisted).
7. Client registration/icon/render after refresh; keyboard/ARIA behavior unchanged. Visual geometry/scroll remains user-only.

## v1.3 — panel UX (v1.3 pass, retained)

### Contract and freeze

- Requirements: `REQUIREMENTS.md` §16 (workspace memory), §17 (repo-labelled header), §18 (vertical layout + empty state), §19 (acceptance criteria).
- Frozen suite: new `test/ux.test.js` (6 tests; authored at `fb957969…`, later revised to `a72867…` by the user-approved v1.4 dropdown-label revision); no existing test, fixture, runner or `src/` file was edited by the test author. `freezeStatus: final`; the v1.3 header-padding revision is documented in `approvedContractRevisions`.
- Final RED: `v13Red` in `docs/frozen-tests.json` — 86 tests / 80 pass / 6 fail; all six are behavioral for the missing v1.3 UX. Existing 80 stayed green.
- Config row live: `include:github-actions`, `status: "schema"`. `src/index.js` is unchanged from v1.2 (`9b7f3aeb…`); v1.3 changes `src/client.js` + locale files only.

### Checks and evidence

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Gate | **PASS** | `node scripts/run-tests.mjs all` → `tests 86 / pass 86 / fail 0`, exit `0`; targeted `node --test test/ux.test.js` → 6/6. |
| 2 | 11 frozen hashes | **PASS** | `scripts/run-tests.mjs`, eight `test/*.test.js` and both fixtures match `docs/frozen-tests.json`, including new `test/ux.test.js`. |
| 3 | Syntax | **PASS** | `node --check` on all six `src/*.js` → OK. |
| 4 | Workspace memory — stored id | **PASS** | Module-loader harness + stubbed storage: stored `ws-b` is used for the first `githubActions.snapshot` payload; exactly one `getItem('github-actions.workspace')`; zero writes. |
| 5 | Workspace memory — fallback/unknown | **PASS** | No stored id → first workspace `ws-a`; unknown `ws-gone` → `ws-a`, stored value remains `ws-gone`, zero writes (no clobber). |
| 6 | Workspace memory — write-on-change | **PASS** | Selecting `ws-c` produces exactly `[['github-actions.workspace','ws-c']]`; subsequent snapshot uses `ws-c`. |
| 7 | Workspace memory — storage failure | **PASS** | A storage whose `getItem`/`setItem` both throw still mounts, renders one select, attempts the guarded read and write, and follows the new selection. |
| 8 | Header — one repo-labelled select | **PASS** (rendered tree) | Exactly one `<select>` in the toolbar and in the whole tree; 3 options covering all workspaces; selected option text `octo/hello`; other options show `Alpha`/`Beta`/`Gamma`. |
| 9 | Header — GitHub link | **PASS** (rendered tree) | `a.href=https://github.com/octo/hello`, `target=_blank`, `rel` contains `noreferrer` + `noopener`, `aria-label="Open repository on GitHub"`, inline `<svg>` with `currentColor`. |
| 10 | Header — no repo / one workspace / old control | **PASS** | Repo `null` → selected option text `Alpha`, no GitHub link; one-workspace list still renders the select; toolbar text no longer contains the old visible "Workspace" label. |
| 11 | Full-height chain + Recent fill | **PASS** (declarations) | `.gha-page` `display:flex;flex-direction:column;height:100%;min-height:0`; `.gha-body`/`.gha-runs` `flex:1;min-height:0`; `.gha-recent` `flex:1;min-height:0`; `.gha-recent .gha-scroll` `flex:1;min-height:0;max-height:none`; `.gha-running .gha-scroll` `max-height:40vh`; base `.gha-scroll` `max-height:min(52vh,640px)` retained. |
| 12 | Declared padding contract | **PASS** (declarations) | `.gha-scroll` `padding:0 0 10px` (no horizontal); `.gha-section-title` `8px 14px`; `.gha-header` `6px 28px` (approved §18 revision); `.gha-list` `10px 14px 14px`; `.gha-empty-wrap` `10px 14px 14px`; `.gha-empty-line` `14px`, `margin:0`; `.gha-history-warning` `0 28px`. |
| 13 | Empty state inset | **PASS (resolved)** | `.gha-empty-wrap` 14px + `.gha-empty-line` 14px = **28px**, equal to data-card text inset `.gha-list` 14px + `.gha-run` 14px = **28px**; empty text now aligns with the data Name column. |
| 14 | Header/data alignment | **PASS (resolved)** | Header padding is now `6px 28px`, so header content box `W−56` = data-row content box `W−56`; the shared template now yields identical positions. W=1000: both Name x=28, Workflow x=306, status right=972; deltas are 0. Empty state 28px also matches data text. |
| 15 | Page/scroll height box model | **PASS (resolved)** | `.gha-page` and `.gha-scroll` now declare `box-sizing:border-box`; the page's 100% height includes its 20px padding and the scroll's border/padding are inside its box, so the height chain no longer exceeds the host by padding. See LOW-1. |
| 16 | Sticky/keyboard scroll preserved | **PASS** | `.gha-section-title` still `position:sticky;top:0`; `.gha-scroll` still renders `tabIndex: 0` and localized `a11y.runningList`/`a11y.recentList` labels; header/warning remain inside the scroll container. |
| 17 | Locale parity | **PASS** | Inline `en`/`zh` 75/75, `locale/en.json`/`locale/zh.json` 75/75, identical key sets and zero value differences; `a11y.openRepo` = "Open repository on GitHub" in en (zh non-empty identical across sources). |
| 18 | Theme tokens / literal colors | **PASS** | 16 `var(--dsw-alias-*)` usages, all defined in the running theme; CSS scan for hex/rgb/rgba/hsl/hsla = 0. |
| 19 | Client module contract | **PASS** | Module-loader load still exports `inject = ["slots", "locale", "connection"]`; existing sidebar/main registrations unchanged. |
| 20 | Client rendering/registration | **NOT VERIFIED from shell** | The frozen `vm` tests and my rendered-tree drive cover the component output, but no browser/CSSOM/layout engine exists here; visual geometry is user-only. |

### Findings (v1.3)

No open v1.3-specific findings. All three follow-ups are resolved:

- **MEDIUM-1 — RESOLVED (empty + header).** `.gha-empty-wrap` (`src/client.js:358`; `10px 14px 14px`) + `.gha-empty-line` (`:359`; `14px`) = **28px**, matching data text `.gha-list` 14px + `.gha-run` 14px = **28px**. `.gha-header` is now `6px 28px` (`:356`), so its content box `W−56` equals a row's `W−56`; W=1000 gives both Name x=28, Workflow x=306, status right=972 (deltas 0). `.gha-history-warning` mirrors the 28px inset (`:360`).
- **LOW-1 — RESOLVED.** `.gha-page` (`:303`) and `.gha-scroll` (`:348`) use `box-sizing:border-box`; the 100% height includes page padding and the scroll border/padding are inside its box, so the chain cannot exceed the host by padding.
- **NIT-1 — RESOLVED.** `.gha-history-warning` (`:360`) now uses `padding:0 28px`.

Remaining carried findings (unchanged, non-blocking):

- **LOW-2 (carried from v1) — stale active warning is on `value.warning`, not `details.warning`.** `src/index.js:812`; `REQUIREMENTS.md:155`; frozen handoff A2 accepts alternative locations (`docs/TEST-HANDOFF.md:378-383`). Smallest fix: add `details.warning` to the success envelope or record A2 as the accepted contract.
- **NIT-2 (carried) — scoped stylesheet injection is a DOM write outside the component (strict reading).** `src/client.js:368-414` via `ctx.effect` at `:1332`; intentional, idempotent (`getElementById`) and disposed with the plugin.

Also resolved earlier in v1.3: v1.2 NIT-1 mobile pill overflow (`.gha-pill` `box-sizing:border-box`, `:341`) and v1.2 NIT-2 template duplication (shared `.gha-run,.gha-header` rule, `:336`).

### User-verifiable checks (v1.3 additions)

1. Refresh `http://127.0.0.1:3080`; select workspace B, reload the page: the panel should start on B. Select C, reload: C. A stale/deleted stored id should fall back to the first workspace.
2. Header: exactly one dropdown; closed label shows the repo `owner/name` when a repo exists, otherwise the workspace title; the GitHub icon opens the repo in a new tab and is absent when no repo is connected; the old separate "Workspace" label is gone; the control exists with one workspace.
3. Panel height: the panel fills the host; Recent fills the remaining height and scrolls internally; Running is capped at 40vh; headings stay sticky.
4. Empty state: with no runs, "No runs are currently running." should align with the data Name column (28px inset). Confirm visually.
5. Header/data alignment: compare the header Name/Workflow/Branch/Event/Status labels against the data cells; the source math now gives identical x positions (both 28px inset), so confirm visually.
6. Host height: no unexpected outer page scrollbar or clipped Recent bottom (LOW-1 fixed by border-box; confirm).
7. Narrow width (<720px) still hides branch/event, keeps the columns aligned, and does not overflow.
8. Client registration/icon/render after refresh; keyboard focus on scroll containers still works.

## v1.2 — layout and scrolling (v1.2 pass, retained)

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
| 19 | Client module contract | **PASS** | Loading through the module-loader contract returns `inject = ["slots", "locale", "connection"]`; existing registrations unchanged. |
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

Status in v1.3: **NIT-1 is resolved** (`.gha-pill` now has `box-sizing:border-box`, `src/client.js:341`) and **NIT-2 is resolved** (`.gha-run,.gha-header` now share one rule, `src/client.js:336`). LOW-1 and NIT-3 remain and are re-listed as v1.3 LOW-2 / NIT-2; the v1.2 alignment geometry is revisited and resolved in the v1.3 MEDIUM-1 follow-up (header padding 28px, empty inset 28px). v1.4 later revised two dropdown-label assertions in this suite under explicit user approval (repo slug -> workspace title), changing its hash to a72867…; the v1.3 behavior itself is otherwise unchanged.

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
| 17 | Locale parity | **PASS** | Inline `en` 66 / `zh` 66, identical key sets; `locale/en.json` 66 / `locale/zh.json` 66, identical sets and **zero value differences**; all new keys (`section.*`, `empty.history`, `conclusion.*`) exist in all four dictionaries; strings match §12. |
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

- No browser, DOM, CSSOM, or screenshot access: client slot registration and visual rendering are **not** claimed. v1.4 evidence adds a deferred per-workspace RPC drive through the frozen client harness (cache/loading/toolbar, 9/9), plus source review and CSS parsing; v1.3 evidence remains the rendered-tree storage/header drive, CSS box-model arithmetic and the frozen ux tests. Actual layout geometry, scrolling, sticky paint, and storage quota/cross-tab behavior require browser confirmation (user-only); the empty/header 28px geometry and LOW-1 box-sizing fix are source-verified.
- Workspace-memory drive: the harness passes a static workspace list at mount, matching the frozen §16 tests. Dynamic list changes after mount (e.g. deleting the selected workspace while the panel is open) are not reconciled by a separate effect and were not exercised; this is untested rather than claimed correct.
- No real end-to-end sign-in was repeated for v1.3: the device-flow code is unchanged and was exercised live (`begin`/`cancel`, no token) in the v1 pass. No access token was stored; the verifier did not modify the profile or `~/.dsh`.
- No real-token snapshot: the host history drive used injected fakes and a real temp checkout; no token was written to the credential store.
- `plugin_manager list_plugins` could not run (auto-rejected `danger-full-access`); bundle-enabled evidence is the live Config row, profile bundle list and workspace patch.
- Theme-token existence was checked against the running `@deepseek-ai/dsh-client-ui-theme` 0.2.2-rc.1 definitions, not rendered.
- `src/index.js` is unchanged from v1.2 (`9b7f3aeb…`) and remains covered by the 93/93 gate; v1.4 is client/locale-only.
- Cache observations not covered by §20 tests: the stale guard is active-workspace-based (same-workspace out-of-order requests are not sequenced), and the cache is a page-component `useRef` (a full panel unmount/remount drops it; it is never persisted).

## Appendix — final artifacts

Protected (all match `docs/frozen-tests.json`):

```text
9d9cac19cde432d5e3fa067845fc2c8a46e3fb010f2ee2ae77bd2334c6757d3b  scripts/run-tests.mjs
c4085cfb8d47d0b4c36fd7db7d3d2c347044f8460f690ab97e382e77875270ce  test/client.test.js
30c4942dda24f64833b89c1664f2c491a4872a89e507d6e1a33bb883a4d62ae8  test/device-flow.test.js
899337632c9951eba138b6077918a35e400b82034d3651f8d3383fe59499e294  test/history.test.js
d95492db2d36525bfe7b9b386a293617fe26f4aa30d2a6d77796fef4fca2f285  test/host.test.js
315ce4fb03eaac278e9acdecc6e494ffd8d504bad37dccdea71564a95f607517  test/layout.test.js
a72867f4a82e74c2e8a78418319feda319df635a980599d6ec7a9f58f469d685  test/ux.test.js
5b940df91dc74da0c04a32534b1d93563b6f89c8d4b4c4a8f3660b2e1ee7a7f3  test/ux2.test.js
e58eac813315559567fe9ede7363d81a70c340128c518e0c91736d38ed549f12  test/ux3.test.js
160274f697fc385a5e07b1bcaf3ee8c5235c839d8d253e8ff13b1cb402f39fc0  test/remotes.test.js
44cd8a8586ee024a61d824545c320e6584ea7ab0aa7386b9bc82018ba3c97f2b  test/runs.test.js
9551b7cee180a9718da1eb994d459a506af7c6c28b20cce561188db7fe0965d0  test/fixtures/client-harness.mjs
c8423365add720284a884920b38e831ac7c5886f9812da84e05e6c6e732396be  test/fixtures/host-harness.mjs
```

Source snapshot (workspace and installed profile symlink are byte-identical):

```text
fc5018cfb274d4645e74b065e74e2915be66b9d6b11425b9b951ea43d82759cf  src/client.js
7a52ba87107dd2e5788fff5a68325eda8b1e5d1fc2eaec421820d552f2b6c5b2  src/device-flow.js
83a7beeadd4f488878b2926a0c5f848885714c5bedd95d0ec435528de666a105  src/git.js
9b7f3aebd36dd859dd5d2098e7f808da98d80e27d809a14393d49fa347bdba75  src/index.js
82e4a6f6ac6b0e37bc2284c1c623fe30a741a6afb95392bacbf0e5275fd18d05  src/remotes.js
ce6a6252611e273d2cc5f4f04c8767ef51f18e854bf207efd4605a349e8e85b7  src/runs.js
```

Commands used for this pass (v1.1 scripts retained for history evidence):

```sh
node scripts/run-tests.mjs all
node --test test/ux3.test.js
node --test test/ux2.test.js
node --test test/ux.test.js
node --test test/layout.test.js
shasum -a 256 scripts/run-tests.mjs test/*.test.js test/fixtures/*.mjs
for f in src/*.js; do node --check "$f"; done
node /tmp/gha-v15-drive.mjs     # 5/5 module-cache remount + same-workspace token-ordering checks
node /tmp/gha-v14-drive.mjs     # retained 9/9 cache/loading/toolbar checks with deferred per-workspace RPC
node /tmp/gha-v13-recheck.mjs   # retained v1.3 follow-up: empty inset, box-sizing, header math
node /tmp/gha-v13-drive.mjs     # 8/8 storage/header checks through the client harness
node /tmp/gha-v13-layout.mjs    # full-height/Recent/40vh/52vh/padding + box-model arithmetic
node /tmp/gha-v13-client.mjs    # inject, 75/75 locale parity, 16/16 theme tokens, a11y.openRepo
node /tmp/gha-v12-layout.mjs    # retained v1.2 source-level layout checks
node /tmp/gha-v11-host.mjs      # retained v1.1 host scenarios (31/31)
node /tmp/gha-v11-edge.mjs      # retained v1.1 edge probes (7/7)
cd ~/.dsh/profiles/web && node --input-type=module -e "import('@local/dsh-github-actions')…"
```

Throwaway scripts lived only in `/tmp`; no production file, test, fixture, or frozen artifact was modified by the verifier. The only file changed by this pass is `docs/VERIFICATION.md`.
