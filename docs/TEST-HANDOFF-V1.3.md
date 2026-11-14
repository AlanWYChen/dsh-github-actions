# v1.3 test handoff — panel UX

**Status: FINAL (one user-approved revision applied 2026-11-14).** New suite
`test/ux.test.js` authored, RED-validated against the then-current (v1.2)
implementation, and frozen. A single user-approved revision to the §18 header
padding expectation followed (see §3b and the manifest
`approvedContractRevisions`). No existing test file, fixture,
`scripts/run-tests.mjs`, or `src/` file was edited; the increment itself changed
no frozen assertion.

- Contract: [`REQUIREMENTS.md`](../REQUIREMENTS.md) "v1.3 increment — panel UX"
  (§16 workspace memory, §17 repo-labelled header, §18 vertical layout + empty
  state, §19 acceptance criteria).
- Test author: `test-author` (does not implement)
- User feedback (screenshot, 2026-11-13): no workspace memory; header should
  identify the project by repo slug with a GitHub icon; Recent should fill the
  remaining panel height instead of a fixed `52vh`; empty-state spacing is wrong.

## 1. Artifacts

| Path | Kind | Tests |
| --- | --- | --- |
| `test/ux.test.js` | NEW v1.3 acceptance suite (self-contained: frozen client harness copied below with a `options.storage` seam) | 6 |
| all other `test/*.test.js`, `test/fixtures/*`, `scripts/run-tests.mjs` | untouched | 80 existing |

Suite size: **86 tests** (80 v1/v1.1/v1.2 + 6 v1.3). The runner globs
`test/*.test.js`, so no runner change was needed; the gate is `all`.

## 2. Commands

```sh
node scripts/run-tests.mjs all     # gate (RED evidence below)
node --test test/ux.test.js        # v1.3 suite only
```

## 3. RED evidence (against the current v1.2 implementation, 2026-11-13)

```text
$ node scripts/run-tests.mjs all
Running all tests (8 files).
ℹ tests 86
ℹ pass 80
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All six new tests fail for missing v1.3 behavior; no import, syntax, or harness
errors; all 80 existing tests still pass:

| New test | Observed RED failure |
| --- | --- |
| workspace memory restores a stored id… | first snapshot uses `'ws-a'` instead of the stored `'ws-b'` (no storage restore) |
| changing the workspace writes the new id exactly once… | `setItem` was never called: `storage.calls.set` is `[]` (no persistence) |
| the header has ONE select labelled with the repo slug… | selected option label is `'Alpha'` instead of `'octo/hello'` (workspace select, no repo label/icon) |
| without a repo the select shows the workspace title… | the old separate `Workspace` label still renders |
| the panel fills its height… | `.gha-page` has no `height:100%` (empty value), and the full-height/flex/40vh/`max-height:none`/14px padding chain is absent |
| a11y.openRepo exists in both inline dictionaries… | `runtimeEn['a11y.openRepo']` is `undefined` |

### 3b. Post-revision RED (approved §18 header padding, 2026-11-14)

User-approved revision: `.gha-header` horizontal padding must be **28px** (not
14px). The header row sits outside `.gha-list`, so its content box only aligns
with a data row when it absorbs the list's 14px plus the row's 14px. The
verifier measured header Name x=14 vs row x=28 (Workflow x=320 vs 306) at
W=1000 with the old value.

```text
$ node scripts/run-tests.mjs all
ℹ tests 86
ℹ pass 85
ℹ fail 1

✖ the panel fills its height: Recent flex-fills, Running caps at 40vh, and empty/list padding is row-aligned (§18)
  AssertionError [ERR_ASSERTION]: .gha-header padding is 28px
```

This is the expected RED for the approved revision: the current implementation
still renders `.gha-header` with 14px horizontal padding. `.gha-section-title`
stays 14px and all other assertions are unchanged. After the implementer sets the
header padding to 28px the gate is **86/86**.

**Satisfiability validation (pre-revision).** The suite was run against a throwaway v1.3
reference stub **outside the workspace** (`/tmp`, deleted afterwards): 6/6 ux
tests passed and the full stub gate was **86/86**, confirming the new assertions
are satisfiable and the 80 frozen tests stay green under the v1.3 changes. No
production file was changed in this workspace.

## 4. Coverage map (§16–§19)

| Requirement | Test |
| --- | --- |
| §16/§19.1 guarded `localStorage` key `github-actions.workspace`; restore a stored id present in the list; fallback to the first workspace; unknown id ignored without clobbering; read never writes | `workspace memory restores a stored id, falls back to the first workspace, and never clobbers on read` |
| §16/§19.1 selection change writes exactly once; storage whose `getItem`/`setItem` throw is non-fatal (mount and change still render; guarded access attempted); snapshots follow the new id | `changing the workspace writes the new id exactly once, and a throwing storage is non-fatal` |
| §17/§19.2 exactly one select in the header; selected option label = `repo.slug`; options cover every workspace; selected option keeps the repo label; GitHub `<a href=repo.webUrl target=_blank rel="noreferrer noopener" aria-label=a11y.openRepo>` with inline currentColor SVG; no leftover `Workspace` label; control renders for one workspace | `the header has ONE select labelled with the repo slug and a GitHub icon link` |
| §17/§19.2 without a repo: selected label = current workspace title; no GitHub link (absent, not disabled) | `without a repo the select shows the workspace title and the GitHub link is absent` |
| §18/§19.3 full-height chain (`.gha-page` height/min-height/flex column; `.gha-body`/`.gha-runs` flex-fill + min-height:0; `.gha-recent` flex-fill; Recent scroll `max-height:none` + flex; Running scroll cap `40vh`; `.gha-scroll` no horizontal padding; section-title/header 14px horizontal; list `10px 14px 14px`; empty line `14px` padding + `margin:0`); no literal colors; every theme token in the running theme | `the panel fills its height: Recent flex-fills, Running caps at 40vh, and empty/list padding is row-aligned` |
| §17/§19.2 `a11y.openRepo` in inline en/zh and both locale files, identical key sets | `a11y.openRepo exists in both inline dictionaries and both locale JSON files with identical key sets` |

## 5. Seams and observability

- **Rendering:** the frozen v1.2 client harness is copied **into**
  `test/ux.test.js` (the lead-approved "copy helpers" option) with one extra
  seam: `createHarness({ storage })` becomes `window.localStorage` and the bare
  `localStorage` global. The frozen fixture itself is untouched (it has a fixed
  no-op storage and no seam). No network, no real DOM.
- **Workspace memory:** tests supply an in-memory fake recording `getItem`/
  `setItem` keys and values, plus a throwing fake that records attempts. They
  assert the first `githubActions.snapshot` RPC payload (workspace id), exact
  storage key, write count, and non-clobber reads.
- **Header:** asserted from the rendered tree: exactly one `select`, its
  `value`, option values/labels, selected-option label, absence of the old
  `Workspace` label, and the `<a>`/SVG attributes.
- **CSS:** no CSS engine in the harness, so the stylesheet template literal is
  read from `src/client.js`, parsed into rules (media rules excluded), and the
  declarations are tied to the class names the plugin uses. Shorthand padding is
  parsed to its horizontal component.
- **Theme tokens:** the alias token set defined by the running DSH Web theme
  (`dsh-client-ui-theme`) was frozen into `THEME_ALIAS_TOKENS` in the test; every
  `var(--dsw-alias-*)` the plugin references must be in that set. A future theme
  token rename would require a test-author contract revision.
- **No real I/O:** locale JSON is read from disk; everything else is the copied
  harness.

## 6. Interpretations and not-covered / limitations

- **`52vh` vs §18.** The protected v1.2 suite still requires a `.gha-scroll`
  rule with `max-height:min(52vh,640px)` (the bounded-scroll contract). v1.3
  satisfies "no 52vh cap on Recent" with more specific overrides
  (`.gha-recent .gha-scroll{max-height:none}` and
  `.gha-running .gha-scroll{max-height:40vh}`), so the v1.3 suite asserts the
  Recent/Running effective declarations and deliberately does **not** assert
  that `52vh` is absent from the stylesheet text. Implementers must keep the
  v1.2 base rule for the frozen layout tests to stay green.
- The selected workspace option is required to carry the repo label; non-selected
  options show workspace titles. Option order is not pinned (the contract only
  requires every workspace).
- The harness passes `props.workspaceId` = first workspace; §16 still requires a
  stored id to win on mount, and the tests freeze that. Reading is required to be
  attempted through the guarded storage (a throwing storage must record the
  attempted `getItem`), so "never touches storage" does not satisfy §16.
- `a11y.openRepo` is pinned to the exact English text "Open repository on
  GitHub" (from §17); zh content is only required to be a non-empty translation
  with identical keys.
- Actual browser layout/scrolling/geometry, focus rings, storage quota events,
  and cross-tab `storage` events are not tested (no real browser). The
  "no new hard-coded pixel font sizes" clause is not asserted (no stable scale
  baseline).
- The icon is asserted to be an inline `<svg>` containing `currentColor`; its
  exact artwork is not pinned.
- **Approved revision (2026-11-14):** the §18 alignment check now requires
  `.gha-header` horizontal padding **28px** (`.gha-section-title` remains 14px).
  This supersedes the original 14px expectation; approval came from the user via
  the Lead. Only that expectation changed — reverting the header tuple to 14px
  restores the previous `test/ux.test.js` hash
  `12a935faf5bccf77428252b959131f87a8ea5d1d79cbabde23c358515ba51d15`.

## 7. Frozen hashes (FINAL)

```text
9d9cac19cde432d5e3fa067845fc2c8a46e3fb010f2ee2ae77bd2334c6757d3b  scripts/run-tests.mjs        (unchanged)
c4085cfb8d47d0b4c36fd7db7d3d2c347044f8460f690ab97e382e77875270ce  test/client.test.js          (unchanged)
30c4942dda24f64833b89c1664f2c491a4872a89e507d6e1a33bb883a4d62ae8  test/device-flow.test.js     (unchanged)
899337632c9951eba138b6077918a35e400b82034d3651f8d3383fe59499e294  test/history.test.js         (unchanged)
d95492db2d36525bfe7b9b386a293617fe26f4aa30d2a6d77796fef4fca2f285  test/host.test.js            (unchanged)
315ce4fb03eaac278e9acdecc6e494ffd8d504bad37dccdea71564a95f607517  test/layout.test.js          (unchanged)
160274f697fc385a5e07b1bcaf3ee8c5235c839d8d253e8ff13b1cb402f39fc0  test/remotes.test.js         (unchanged)
44cd8a8586ee024a61d824545c320e6584ea7ab0aa7386b9bc82018ba3c97f2b  test/runs.test.js            (unchanged)
fb9579695c8b1699d0fa803a2db39e1983fcee017cd853a61810a76874306ed7  test/ux.test.js              (NEW v1.3 suite; approved §18 header-padding revision)
9551b7cee180a9718da1eb994d459a506af7c6c28b20cce561188db7fe0965d0  test/fixtures/client-harness.mjs (unchanged, read-only)
c8423365add720284a884920b38e831ac7c5886f9812da84e05e6c6e732396be  test/fixtures/host-harness.mjs   (unchanged)
```

Machine-readable: [`frozen-tests.json`](frozen-tests.json) (`v13Freeze`,
`v13Red`, `freezeStatus: final`).

## 8. Implementer instructions

1. Implement §16–§18 in `src/client.js` and add `a11y.openRepo` to the inline
   dictionaries and both `locale/*.json` files. Do **not** edit anything under
   `test/` or `scripts/run-tests.mjs`. Keep the v1.2 `.gha-scroll` base rule and
   override it per section. The approved revision requires
   `.gha-header { padding: … 28px … }` (horizontal), while
   `.gha-section-title` keeps 14px.
2. Run `node scripts/run-tests.mjs all`; the GREEN gate is **86/86** (80 frozen
   v1/v1.1/v1.2 + 6 v1.3).
3. If a v1.3 test looks wrong, stop and escalate with the path/line, command,
   expected behavior, and requirement source. Only an approved test-author phase
   may change frozen tests.
