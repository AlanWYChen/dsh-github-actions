# v1.2 test handoff — list alignment and scrolling

**Status: FINAL.** New suite `test/layout.test.js` authored, RED-validated against
the current (v1.1) implementation, and frozen. No existing test file, fixture,
`scripts/run-tests.mjs`, or `src/` file was edited. No `approvedContractRevisions`
was needed: v1.2 is a NEW increment whose contract adds no change to any v1/v1.1
frozen assertion.

- Contract: [`REQUIREMENTS.md`](../REQUIREMENTS.md) "v1.2 increment — list
  alignment and scrolling" (§14 layout contract, §15 acceptance criteria).
- Test author: `test-author` (does not implement)
- User feedback (2026-11-11): success/failed pills have different widths; the
  workflow column shifts with branch length; a long Recent list grows the page.
  v1.2 adds the header rows (Name / Workflow / Branch / Event / Status, plus
  Completed for Recent).

## 1. Artifacts

| Path | Kind | Tests |
| --- | --- | --- |
| `test/layout.test.js` | NEW v1.2 acceptance suite | 6 |
| `test/fixtures/client-harness.mjs` | frozen v1.1 harness, imported **read-only** | — |
| all other `test/*.test.js`, `scripts/run-tests.mjs` | untouched | 74 existing |

Suite size: **80 tests** (74 v1/v1.1 + 6 v1.2). The runner globs
`test/*.test.js`, so no runner change was needed; `layout.test.js` appears under
the `unit` group label because the integration list is byte-frozen. The
acceptance gate is `all`.

## 2. Commands

```sh
node scripts/run-tests.mjs all      # gate (RED evidence below)
node --test test/layout.test.js     # v1.2 suite only
```

## 3. RED evidence (against the current v1.1 implementation, 2026-11-11)

```text
$ node scripts/run-tests.mjs all
Running all tests (7 files).
ℹ tests 80
ℹ pass 74
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All six new tests fail for missing v1.2 behavior; there are no import, syntax, or
harness errors, and all 74 existing v1/v1.1 tests still pass unchanged:

| New test | RED failure (observed) |
| --- | --- |
| both row kinds share one fixed six-column template… | two different row templates: `…max-content max-content max-content` (Running, 5 cols) vs `…max-content max-content max-content max-content` (Recent, 6 cols) — `2 !== 1` |
| every status pill uses the same fixed-width centered class… | no shared pill class declares a fixed `min-width` |
| both lists are bounded, keyboard-accessible scroll containers… | the stylesheet defines no `overflow-y:auto` + `max-height:min(52vh,640px)` scroll rule |
| section headings are sticky in the scroll container… | no `position:sticky; top:0` rule for the section-heading class |
| each list renders a non-interactive localized header row… | the Running list has no header row |
| new header labels exist in both dictionaries and locale files… | the inline en dictionary has no `Name` header label |

**Satisfiability validation.** The suite was also run against a throwaway v1.2
reference stub **outside the workspace** (`/tmp`, deleted afterwards): 6/6 layout
tests passed and the full stub gate was **80/80**, confirming the new assertions
are satisfiable and that the v1.2 layout changes keep the 74 frozen tests green.
No production file was changed in this workspace.

## 4. Coverage map (§14–§15)

| Requirement | Test |
| --- | --- |
| §14/§15.1 shared six-column template for both row kinds, fixed workflow/branch/event columns (not `max-content`), fixed status column, no per-row inline override, `.gha-run` + workflow cell on every row | `both row kinds share one fixed six-column template and no row uses max-content for the workflow/branch/event columns` |
| §14/§15.2 one fixed-width pill class for all conclusions and for running/queued, centered (`justify-self:center`), `min-width`, no wrapping, Success/Failed identical width class, localized labels (8 conclusions + Unknown), theme-token-only colors | `every status pill uses the same fixed-width centered class, and success/failure are identical` |
| §14/§15.3 both lists have a bounded scroll container (`overflow-y:auto`, `max-height:min(52vh, 640px)`), `tabIndex=0`, accessible label, themed thin scrollbar | `both lists are bounded, keyboard-accessible scroll containers with themed thin scrollbars` |
| §14 sticky section headings (`position:sticky; top:0`, themed background) inside the scroll container; Recent warning scrolls with the rows | `section headings are sticky in the scroll container and the Recent warning scrolls with the rows` |
| §14 one header row per list with localized Name / Workflow / Branch / Event / Status (+Completed for Recent), in order, non-interactive, `aria-hidden`/`role=presentation`, same column template as data rows | `each list renders a non-interactive localized header row on the shared column template` |
| §14 header-label keys in inline `en`/`zh` dictionaries and `locale/en.json`/`locale/zh.json` with identical key sets | `new header labels exist in both inline dictionaries and both locale JSON files with identical key sets` |

## 5. Seams and observability

- **Rendering:** the real `src/client.js` is loaded through the frozen v1.1
  `vm` + `window.__ModuleLoader__` harness (imported read-only from
  `test/fixtures/client-harness.mjs`). The page is mounted with a v1.1-shaped
  snapshot carrying active runs and history entries.
- **CSS:** the harness has no CSS engine, so the tests extract the stylesheet
  template literal(s) from `src/client.js`, parse the rules (including nested
  `@media`, which are excluded from the "one template" comparison), and tie every
  assertion back to class names that actually occur in the rendered tree. This is
  the only way to observe `overflow-y`, `max-height`, sticky positioning,
  `min-width`, `justify-self`, and the mobile/desktop rule split without a real
  browser.
- **Layout equality:** "same template / same width class" is asserted by
  comparing the parsed declarations for the rendered row/pill/header classes —
  not by hard-coding selector names beyond the v1 classes (`gha-run`, `gha-pill`,
  `gha-run-workflow`).
- **No real I/O:** no network, no process. Locale JSON is read from disk.
- The harness's document stub is not a CSSOM; no layout geometry is computed.

## 6. Interpretations and not-covered / limitations

- Section heading wording is not pinned: the tests require a sticky heading
  element before each list and locale-dictionary values, not exact text.
- The exact position of the Recent `Completed` header is not pinned; the five
  documented headers are required in order (Name, Workflow, Branch, Event,
  Status) and `Completed` must be present for Recent only. This reflects §14,
  which appends "(and Completed for Recent)" without stating its column.
- The suite accepts either a shared CSS template class **or** an identical inline
  `gridTemplateColumns` on every row (the task allows inline/CSS class), but a
  per-row inline override of a CSS template is rejected.
- `max-content` is rejected where §14/§15.1 forbids it (workflow, branch, event,
  status); the name and time columns are intentionally unconstrained.
- Actual scrolling, sticky paint behavior, and scrollbar appearance are browser
  CSS behavior; the suite asserts the declared CSS contract and accessibility
  attributes, not rendered geometry.
- The "no new hard-coded pixel font sizes" clause (§14) is not asserted (no
  stable baseline for the existing scale in the frozen v1 CSS).
- A literal-color scan covers hex/rgb/hsl and color-bearing declarations; it
  cannot detect colors hidden in non-standard properties/`url()` assets.

## 7. Frozen hashes (FINAL)

```text
9d9cac19cde432d5e3fa067845fc2c8a46e3fb010f2ee2ae77bd2334c6757d3b  scripts/run-tests.mjs        (unchanged)
c4085cfb8d47d0b4c36fd7db7d3d2c347044f8460f690ab97e382e77875270ce  test/client.test.js          (unchanged)
30c4942dda24f64833b89c1664f2c491a4872a89e507d6e1a33bb883a4d62ae8  test/device-flow.test.js     (unchanged)
899337632c9951eba138b6077918a35e400b82034d3651f8d3383fe59499e294  test/history.test.js         (unchanged)
315ce4fb03eaac278e9acdecc6e494ffd8d504bad37dccdea71564a95f607517  test/layout.test.js          (NEW v1.2 suite)
d95492db2d36525bfe7b9b386a293617fe26f4aa30d2a6d77796fef4fca2f285  test/host.test.js            (unchanged since v1.1 final)
160274f697fc385a5e07b1bcaf3ee8c5235c839d8d253e8ff13b1cb402f39fc0  test/remotes.test.js         (unchanged)
44cd8a8586ee024a61d824545c320e6584ea7ab0aa7386b9bc82018ba3c97f2b  test/runs.test.js            (unchanged since v1.1 final)
9551b7cee180a9718da1eb994d459a506af7c6c28b20cce561188db7fe0965d0  test/fixtures/client-harness.mjs (unchanged, read-only)
c8423365add720284a884920b38e831ac7c5886f9812da84e05e6c6e732396be  test/fixtures/host-harness.mjs   (unchanged)
```

Machine-readable: [`frozen-tests.json`](frozen-tests.json) (`v12Freeze`,
`v12Red`, `freezeStatus: final`).

## 8. Implementer instructions

1. Implement §14–§15 in `src/client.js` and add the header-label keys to the
   inline dictionaries and both `locale/*.json` files. Do **not** edit anything
   under `test/` or `scripts/run-tests.mjs`.
2. Run `node scripts/run-tests.mjs all`; the GREEN gate is **80/80** (74 frozen
   v1/v1.1 + 6 v1.2).
3. If a v1.2 test looks wrong, stop and escalate with the path/line, command,
   expected behavior, and requirement source. Only an approved test-author phase
   may change frozen tests.
