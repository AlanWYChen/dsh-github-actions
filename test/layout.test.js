/**
 * v1.2 layout + scrolling acceptance tests.
 *
 * Contract: REQUIREMENTS.md "v1.2 increment — list alignment and scrolling"
 * (§14 layout contract, §15 acceptance criteria). NEW suite; the existing
 * v1/v1.1 tests, fixtures, and scripts/run-tests.mjs are untouched (read-only
 * import of the frozen client harness).
 *
 * What is observable here:
 *   - the rendered DOM/component tree from the real src/client.js in the vm
 *     module-loader harness (row kinds, cells, pills, lists, headers, a11y
 *     attributes, warning/heading nesting);
 *   - the stylesheet text emitted by src/client.js (there is no CSS engine in
 *     the harness, so CSS rules are read from the source's template literal and
 *     tied back to class names that actually occur in the rendered tree);
 *   - the inline en/zh dictionaries and locale/*.json files.
 *
 * No network, no real DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createHarness,
  visit,
  text,
  run as v1Run,
  snapshot as v1Snapshot,
} from './fixtures/client-harness.mjs';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const CLIENTS = [
  ['success', 'Success'],
  ['failure', 'Failed'],
  ['cancelled', 'Cancelled'],
  ['skipped', 'Skipped'],
  ['neutral', 'Neutral'],
  ['timed_out', 'Timed out'],
  ['action_required', 'Action required'],
  [null, 'Unknown'],
];

function historyEntry(overrides = {}) {
  return {
    ...v1Run(),
    id: 2001,
    name: 'Deploy release',
    workflowName: 'Deploy',
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    branch: 'release',
    actor: 'octocat',
    number: 12,
    createdAt: '2026-01-02T03:50:00Z',
    startedAt: '2026-01-02T03:50:10Z',
    completedAt: '2026-01-02T04:00:00Z',
    htmlUrl: 'https://github.com/octo/hello/actions/runs/2001',
    workflowUrl: 'https://github.com/octo/hello/blob/release/.github/workflows/deploy.yml',
    ...overrides,
  };
}

function activeRuns() {
  return [
    v1Run(),
    v1Run({
      id: 102,
      name: 'Docs preview',
      workflowName: 'Docs',
      status: 'queued',
      event: 'pull_request',
      branch: 'docs',
      actor: 'hubot',
      number: 3,
      createdAt: '2026-01-02T03:02:00Z',
      startedAt: null,
      htmlUrl: 'https://github.com/octo/hello/actions/runs/102',
      workflowUrl: 'https://github.com/octo/hello/blob/docs/.github/workflows/docs.yml',
    }),
  ];
}

function historyRuns() {
  return [
    historyEntry(),
    historyEntry({
      id: 2002,
      name: 'Nightly build',
      workflowName: 'Nightly',
      conclusion: 'failure',
      branch: 'main',
      event: 'schedule',
      completedAt: '2026-01-02T05:00:00Z',
      htmlUrl: 'https://github.com/octo/hello/actions/runs/2002',
    }),
  ];
}

function layoutSnapshot(overrides = {}) {
  return {
    ...v1Snapshot(),
    runs: activeRuns(),
    history: historyRuns(),
    ...overrides,
  };
}

function pillSnapshot() {
  return layoutSnapshot({
    history: CLIENTS.map(([conclusion], index) =>
      historyEntry({
        id: 2100 + index,
        name: `History ${conclusion === null ? 'missing' : conclusion}`,
        conclusion,
        branch: 'main',
        event: 'push',
        completedAt: '2026-01-02T04:00:00Z',
        htmlUrl: `https://github.com/octo/hello/actions/runs/${2100 + index}`,
      }),
    ),
  });
}

/* ------------------------------------------------------------------ */
/* Tree + CSS helpers                                                  */
/* ------------------------------------------------------------------ */

const HEADING_TYPES = ['h2', 'h3', 'h4', 'h5'];
const COLOR_PROPS = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
]);

function flattenNodes(node, result = []) {
  if (node === null || node === undefined) return result;
  if (Array.isArray(node)) {
    for (const child of node) flattenNodes(child, result);

    return result;
  }
  if (typeof node !== 'object') return result;

  result.push(node);
  if (node.children !== undefined) flattenNodes(node.children, result);

  return result;
}

function classTokens(node) {
  const className = node !== null && typeof node === 'object' ? node.props?.className : undefined;

  if (typeof className !== 'string') return [];

  return className.split(/\s+/).filter((token) => token.length > 0);
}

function hasClass(node, token) {
  return classTokens(node).includes(token);
}

function pathTo(node, predicate, trail = []) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = pathTo(child, predicate, trail);

      if (found !== undefined) return found;
    }

    return undefined;
  }

  const next = [...trail, node];

  if (predicate(node)) return next;
  if (node.children !== undefined) return pathTo(node.children, predicate, next);

  return undefined;
}

function commonAncestors(pathA, pathB) {
  const ids = new Set(pathB);

  return pathA.filter((node) => ids.has(node));
}

function readStylesheet() {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const blocks = [...source.matchAll(/`([\s\S]*?)`/g)]
    .map((match) => match[1])
    .filter((block) => block.includes('.gha-run'));

  assert.ok(blocks.length > 0, 'src/client.js must emit a stylesheet containing .gha-run rules');

  return blocks.join('\n');
}

function parseDeclarations(body) {
  return body
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0)
    .map((declaration) => {
      const colon = declaration.indexOf(':');

      if (colon === -1) return [declaration.toLowerCase(), ''];

      return [declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim()];
    });
}

function parseRules(css) {
  const rules = [];
  const walk = (text, media) => {
    let index = 0;

    while (index < text.length) {
      while (index < text.length && /[\s;}]/.test(text[index])) index += 1;
      if (index >= text.length) break;

      const open = text.indexOf('{', index);

      if (open === -1) break;

      const selector = text.slice(index, open).trim();
      let depth = 1;
      let cursor = open + 1;

      while (cursor < text.length && depth > 0) {
        if (text[cursor] === '{') depth += 1;
        else if (text[cursor] === '}') depth -= 1;
        cursor += 1;
      }

      const body = text.slice(open + 1, cursor - 1);

      if (selector.startsWith('@')) {
        if (selector.startsWith('@media') || selector.startsWith('@supports')) {
          walk(body, true);
        }
      } else {
        rules.push({ selector, media, declarations: parseDeclarations(body) });
      }

      index = cursor;
    }
  };

  walk(css, false);

  return rules;
}

function selectorClasses(selector) {
  return [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
}

function declaration(rule, property) {
  const found = rule.declarations.find(([name]) => name === property);

  return found === undefined ? undefined : found[1];
}

function normalizeTemplate(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function splitColumns(template) {
  const columns = [];
  let depth = 0;
  let current = '';

  for (const char of template) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;

    if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current.trim().length > 0) columns.push(current.trim());

      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim().length > 0) columns.push(current.trim());

  return columns;
}

function rulesTouching(rules, classes) {
  return rules.filter((rule) => selectorClasses(rule.selector).some((name) => classes.has(name)));
}

function rowNodes(tree) {
  return flattenNodes(tree).filter(
    (node) =>
      hasClass(node, 'gha-run') &&
      (node.props?.role === 'listitem' || node.props?.['data-gha-run-id'] !== undefined),
  );
}

function listNodes(tree) {
  return flattenNodes(tree).filter((node) => node.props?.role === 'list');
}

function pillNodesIn(row) {
  return visit(row, (node) => hasClass(node, 'gha-pill'));
}

function findRowByText(tree, label) {
  return visit(
    tree,
    (node) =>
      hasClass(node, 'gha-run') &&
      node.props?.role === 'listitem' &&
      text(node).includes(label),
  ).find((node) => node.props?.['data-gha-run-id'] !== undefined);
}

function scrollContract() {
  const css = readStylesheet();
  const rules = parseRules(css);
  const scrollRules = rules.filter((rule) => {
    if (rule.media) return false;

    const overflow = declaration(rule, 'overflow-y');
    const maxHeight = declaration(rule, 'max-height');

    if (typeof overflow !== 'string' || overflow.trim() !== 'auto') return false;
    if (typeof maxHeight !== 'string') return false;

    return normalizeTemplate(maxHeight).replace(/\s+/g, '') === 'min(52vh,640px)';
  });

  return { css, rules, scrollRules };
}

/* ------------------------------------------------------------------ */
/* §14 / §15.1 — one shared fixed column template for both row kinds   */
/* ------------------------------------------------------------------ */

test('both row kinds share one fixed six-column template and no row uses max-content for the workflow/branch/event columns (§14, §15.1)', async () => {
  const harness = await createHarness({ snapshot: layoutSnapshot() });
  const tree = await harness.mountPage();
  const rows = rowNodes(tree);

  assert.equal(rows.length, activeRuns().length + historyRuns().length);

  const rowClasses = new Set(rows.flatMap((row) => classTokens(row)));

  assert.ok(rowClasses.has('gha-run'), 'every row carries gha-run');

  for (const row of rows) {
    assert.ok(
      visit(row, (node) => hasClass(node, 'gha-run-workflow')).length > 0,
      'every row carries the workflow cell class',
    );
  }

  const { rules } = scrollContract();
  const templateRules = rules.filter(
    (rule) =>
      !rule.media &&
      declaration(rule, 'grid-template-columns') !== undefined &&
      selectorClasses(rule.selector).some((name) => rowClasses.has(name)),
  );

  const inlineTemplates = new Set(
    rows
      .map((row) => row.props?.style?.gridTemplateColumns ?? row.props?.style?.['grid-template-columns'])
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .map((value) => normalizeTemplate(value)),
  );
  const cssTemplates = new Set(
    templateRules.map((rule) => normalizeTemplate(declaration(rule, 'grid-template-columns'))),
  );

  let templates;

  if (cssTemplates.size > 0) {
    assert.equal(inlineTemplates.size, 0, 'a CSS row template must not be overridden inline per row');
    templates = cssTemplates;
  } else {
    assert.ok(inlineTemplates.size > 0, 'the rows must be assigned the shared column template');
    templates = inlineTemplates;
  }

  assert.equal(
    templates.size,
    1,
    `Running and Recent rows must share one template; found: ${[...templates].join(' | ')}`,
  );

  const template = [...templates][0];
  const columns = splitColumns(template);

  assert.equal(columns.length, 6, `the row template must have six columns: ${template}`);
  // name, workflow, branch, event, time, status
  assert.doesNotMatch(columns[1], /max-content/, 'the workflow column must not be max-content');
  assert.doesNotMatch(columns[2], /max-content/, 'the branch column must not be max-content');
  assert.doesNotMatch(columns[3], /max-content/, 'the event column must not be max-content');
  assert.match(columns[5], /\d(?:px|rem|em|ch)/, 'the status column must be a fixed width');
  assert.doesNotMatch(columns[5], /max-content|auto|\dfr\b/, 'the status column must not be content-sized');

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §14 / §15.2 — fixed-width centered pills, localized labels          */
/* ------------------------------------------------------------------ */

test('every status pill uses the same fixed-width centered class, and success/failure are identical (§14, §15.2)', async () => {
  const harness = await createHarness({ snapshot: pillSnapshot() });
  const tree = await harness.mountPage();
  const rows = rowNodes(tree);

  assert.equal(rows.length, activeRuns().length + CLIENTS.length);

  const pills = rows.flatMap((row) => pillNodesIn(row));

  assert.equal(pills.length, rows.length, 'every row has exactly one status pill');

  const allTokens = new Set(pills.flatMap((pill) => classTokens(pill)));
  const commonTokens = [...allTokens].filter((token) =>
    pills.every((pill) => hasClass(pill, token)),
  );

  assert.ok(commonTokens.includes('gha-pill'), 'every pill carries the shared pill class');

  const { css, rules } = scrollContract();
  const pillRules = rulesTouching(rules, allTokens);
  const fixedRules = pillRules.filter((rule) => {
    const minWidth = declaration(rule, 'min-width');

    return typeof minWidth === 'string' && /\d(?:px|rem|em|ch)/.test(minWidth);
  });
  const fixedTokens = new Set(
    fixedRules.flatMap((rule) =>
      selectorClasses(rule.selector).filter((name) => allTokens.has(name)),
    ),
  );

  assert.ok(
    fixedTokens.size > 0,
    'a shared pill class must declare a fixed min-width (§14 fixed-width pill column)',
  );
  for (const pill of pills) {
    assert.ok(
      classTokens(pill).some((token) => fixedTokens.has(token)),
      'every pill must carry the fixed-width class',
    );
  }

  const successPill = pillNodesIn(findRowByText(tree, 'History success'))[0];
  const failurePill = pillNodesIn(findRowByText(tree, 'History failure'))[0];
  const widthTokensOf = (pill) => classTokens(pill).filter((token) => fixedTokens.has(token)).sort();

  assert.deepEqual(
    widthTokensOf(successPill),
    widthTokensOf(failurePill),
    'Success and Failed must render the same width class',
  );

  assert.ok(
    fixedRules.some((rule) => declaration(rule, 'justify-self') === 'center'),
    'the pill must be centered in its column (§14 justify-self:center)',
  );
  assert.ok(
    pillRules.some((rule) => /nowrap/.test(declaration(rule, 'white-space') ?? '')),
    'pill text must not wrap',
  );

  // Localized pill labels, including Unknown for a missing conclusion.
  const en = harness.dictionaries.en;

  for (const [conclusion, label] of CLIENTS) {
    const row = findRowByText(tree, `History ${conclusion === null ? 'missing' : conclusion}`);
    const pill = pillNodesIn(row)[0];

    assert.ok(pill, `a pill exists for ${conclusion === null ? 'null' : conclusion}`);
    assert.equal(text(pill).trim(), label);
    assert.ok(Object.values(en).includes(label), `the en dictionary localizes ${label}`);
  }

  const activePills = [pillNodesIn(findRowByText(tree, 'Build and test'))[0], pillNodesIn(findRowByText(tree, 'Docs preview'))[0]];

  assert.ok(activePills.every((pill) => classTokens(pill).includes('gha-pill')));
  assert.ok(activePills.every((pill) => classTokens(pill).some((token) => fixedTokens.has(token))));

  const activeLabels = activePills.map((pill) => text(pill).trim()).sort();

  assert.deepEqual(activeLabels, ['Queued', 'Running']);

  // No literal colors anywhere; color declarations use theme tokens only.
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no literal hex colors');
  assert.doesNotMatch(css, /\b(?:rgb|rgba|hsl|hsla)\(/, 'no literal rgb/hsl colors');

  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (!COLOR_PROPS.has(property)) continue;
      if (/^(?:transparent|currentcolor|inherit|initial|unset|none)$/i.test(value)) continue;

      assert.match(value, /var\(--dsw-alias-/, `${property}: ${value} must use a theme token`);
    }
  }

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §14 / §15.3 — bounded scroll containers, sticky headings, header    */
/* ------------------------------------------------------------------ */

test('both lists are bounded, keyboard-accessible scroll containers with themed thin scrollbars (§14, §15.3)', async () => {
  const harness = await createHarness({ snapshot: layoutSnapshot() });
  const tree = await harness.mountPage();
  const lists = listNodes(tree);
  const { css, rules, scrollRules } = scrollContract();

  assert.equal(lists.length, 2, 'both Running and Recent render a list');

  assert.ok(scrollRules.length > 0, 'the stylesheet must define a bounded scroll container');

  const scrollClasses = new Set(scrollRules.flatMap((rule) => selectorClasses(rule.selector)));
  const scrollNodes = flattenNodes(tree).filter((node) =>
    classTokens(node).some((token) => scrollClasses.has(token)),
  );

  assert.ok(scrollNodes.length >= 2, 'each list needs its own scroll container');

  for (const scroll of scrollNodes) {
    const tabIndex = scroll.props?.tabIndex;
    const label = scroll.props?.['aria-label'];

    assert.ok(
      tabIndex === 0 || String(tabIndex) === '0',
      'the scroll container must be keyboard focusable (tabIndex 0)',
    );
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0, 'the scroll container needs an accessible label');
  }

  for (const list of lists) {
    const path = pathTo(tree, (node) => node === list);

    assert.ok(path, 'the list is part of the rendered tree');

    const scroll = [...path]
      .reverse()
      .find((node) => classTokens(node).some((token) => scrollClasses.has(token)));

    assert.ok(scroll, 'the list must live inside a bounded scroll container');

    const scrollRule = scrollRules.find((rule) =>
      selectorClasses(rule.selector).some((token) => classTokens(scroll).includes(token)),
    );

    assert.ok(scrollRule, 'the scroll container class must carry the scroll contract');

    const thinScrollbar =
      /thin/.test(declaration(scrollRule, 'scrollbar-width') ?? '') &&
      /var\(--dsw-alias-/.test(declaration(scrollRule, 'scrollbar-color') ?? '');
    const webkitScrollbar = rules.some(
      (rule) =>
        rule.selector.includes('::-webkit-scrollbar') &&
        rule.declarations.some(([, value]) => /var\(--dsw-alias-/.test(value)),
    );

    assert.ok(thinScrollbar || webkitScrollbar, 'the scroll container needs a themed thin scrollbar');
  }

  assert.ok(css.length > 0);
  harness.unmount();
});

test('section headings are sticky in the scroll container and the Recent warning scrolls with the rows (§14)', async () => {
  const warning = 'History could not be refreshed; showing the last finished runs.';
  const harness = await createHarness({
    snapshot: layoutSnapshot({ historyWarning: warning }),
  });
  const tree = await harness.mountPage();
  const nodes = flattenNodes(tree);
  const lists = listNodes(tree);
  const { rules, scrollRules } = scrollContract();
  const scrollClasses = new Set(scrollRules.flatMap((rule) => selectorClasses(rule.selector)));

  const headingsFor = (list) => {
    const listIndex = nodes.indexOf(list);

    for (let index = listIndex - 1; index >= 0; index -= 1) {
      if (HEADING_TYPES.includes(nodes[index].type)) return nodes[index];
    }

    return undefined;
  };

  const headings = lists.map(headingsFor);

  assert.ok(headings.every(Boolean), 'each list has a section heading');

  const headingClasses = new Set(headings.flatMap((heading) => classTokens(heading)));
  const stickyRules = rules.filter(
    (rule) =>
      !rule.media &&
      declaration(rule, 'position') === 'sticky' &&
      /^0(?:px)?$/.test(declaration(rule, 'top') ?? '') &&
      selectorClasses(rule.selector).some((name) => headingClasses.has(name)),
  );

  assert.ok(stickyRules.length > 0, 'the section heading class must be position:sticky; top:0');
  assert.ok(
    stickyRules.some((rule) =>
      /var\(--dsw-alias-/.test(
        `${declaration(rule, 'background') ?? ''} ${declaration(rule, 'background-color') ?? ''}`,
      ),
    ),
    'the sticky heading needs a themed background',
  );

  for (const heading of headings) {
    const path = pathTo(tree, (node) => node === heading);
    const scroll = path.find((node) =>
      classTokens(node).some((token) => scrollClasses.has(token)),
    );

    assert.ok(scroll, 'the sticky heading must be inside the scroll container');
  }

  // The Recent warning scrolls with the rows: same scroll container as the first row.
  const warningNode = nodes.find((node) => text(node).trim() === warning);
  const firstRecent = findRowByText(tree, 'Deploy release');

  assert.ok(warningNode, 'the history warning line renders');
  assert.ok(firstRecent, 'the first Recent row renders');

  const shared = commonAncestors(
    pathTo(tree, (node) => node === warningNode),
    pathTo(tree, (node) => node === firstRecent),
  );
  const warningScroll = shared.find((node) =>
    classTokens(node).some((token) => scrollClasses.has(token)),
  );

  assert.ok(warningScroll, 'the warning must scroll with the Recent rows');
  assert.ok(nodes.indexOf(warningNode) < nodes.indexOf(firstRecent));

  harness.unmount();
});

test('each list renders a non-interactive localized header row on the shared column template (§14)', async () => {
  const harness = await createHarness({ snapshot: layoutSnapshot() });
  const tree = await harness.mountPage();
  const nodes = flattenNodes(tree);
  const lists = listNodes(tree);

  assert.equal(lists.length, 2);

  const runningLabels = ['Name', 'Workflow', 'Branch', 'Event', 'Status'];
  const recentLabels = ['Name', 'Workflow', 'Branch', 'Event', 'Status', 'Completed'];
  const orderedLabels = ['Name', 'Workflow', 'Branch', 'Event', 'Status'];
  const headers = [];

  for (const [index, list] of lists.entries()) {
    const path = pathTo(tree, (node) => node === list);
    const section = [...path].reverse().find((node) => node.type === 'section');

    assert.ok(section, 'each list belongs to a section');

    const labels = index === 0 ? runningLabels : recentLabels;
    const candidates = flattenNodes(section).filter((node) => {
      if (node === section || node === list) return false;
      const candidateText = text(node);

      return labels.every((label) => candidateText.includes(label));
    });

    candidates.sort((left, right) => text(left).length - text(right).length);

    const header = candidates[0];

    assert.ok(header, `the ${index === 0 ? 'Running' : 'Recent'} list needs a header row`);
    headers.push(header);

    let lastIndex = -1;

    for (const label of orderedLabels) {
      const position = text(header).indexOf(label);

      assert.ok(position > lastIndex, `header labels are in order (${label})`);
      lastIndex = position;
    }

    if (index === 1) {
      assert.ok(text(header).includes('Completed'), 'Recent has a Completed header');
    }

    if (index === 0) {
      assert.equal(text(header).includes('Completed'), false, 'Running has no Completed column');
    }

    assert.equal(
      visit(
        header,
        (node) =>
          typeof node.props?.onClick === 'function' ||
          typeof node.props?.onKeyDown === 'function',
      ).length,
      0,
      'header rows must not intercept clicks',
    );

    const ariaHidden = header.props?.['aria-hidden'];
    const role = header.props?.role;

    assert.ok(
      ariaHidden === true || ariaHidden === 'true' || role === 'presentation',
      'header row must be aria-hidden or role=presentation',
    );

    assert.ok(nodes.indexOf(header) < nodes.indexOf(list), 'the header is above its list');
  }

  assert.equal(headers[0] === headers[1], false);

  // The header row uses the same fixed grid template as the rows.
  const rows = rowNodes(tree);
  const rowClasses = new Set(rows.flatMap((row) => classTokens(row)));
  const { rules } = scrollContract();
  const rowTemplate = rules.find(
    (rule) =>
      !rule.media &&
      declaration(rule, 'grid-template-columns') !== undefined &&
      selectorClasses(rule.selector).some((name) => rowClasses.has(name)),
  );

  assert.ok(rowTemplate, 'the row template rule exists');
  const expectedTemplate = normalizeTemplate(declaration(rowTemplate, 'grid-template-columns'));

  for (const header of headers) {
    const headerClasses = new Set(classTokens(header));
    const headerRule = rules.find(
      (rule) =>
        !rule.media &&
        declaration(rule, 'grid-template-columns') !== undefined &&
        selectorClasses(rule.selector).some((name) => headerClasses.has(name)),
    );
    const inline = header.props?.style?.gridTemplateColumns;

    assert.ok(
      (headerRule !== undefined &&
        normalizeTemplate(declaration(headerRule, 'grid-template-columns')) === expectedTemplate) ||
        normalizeTemplate(inline ?? '') === expectedTemplate,
      'header rows must use the same column template as the data rows',
    );
  }

  harness.unmount();
});

/* ------------------------------------------------------------------ */
/* §14 — locale parity for the new header labels                       */
/* ------------------------------------------------------------------ */

test('new header labels exist in both inline dictionaries and both locale JSON files with identical key sets (§14)', async () => {
  const harness = await createHarness();
  const flatten = (value, prefix = '') => {
    const result = {};

    for (const [key, entry] of Object.entries(value)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;

      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        Object.assign(result, flatten(entry, path));
      } else {
        result[path] = entry;
      }
    }

    return result;
  };
  const enFile = flatten(
    JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8')),
  );
  const zhFile = flatten(
    JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8')),
  );
  const runtimeEn = harness.dictionaries.en;
  const runtimeZh = harness.dictionaries.zh;

  assert.deepEqual(Object.keys(runtimeEn).sort(), Object.keys(runtimeZh).sort());
  assert.deepEqual(Object.keys(runtimeEn).sort(), Object.keys(enFile).sort());
  assert.deepEqual(Object.keys(runtimeZh).sort(), Object.keys(zhFile).sort());
  assert.deepEqual(Object.keys(enFile).sort(), Object.keys(zhFile).sort());

  for (const [key, value] of Object.entries(runtimeEn)) {
    assert.equal(typeof value, 'string', `en.${key}`);
    assert.ok(value.length > 0, `en.${key} is not empty`);
  }
  for (const [key, value] of Object.entries(runtimeZh)) {
    assert.equal(typeof value, 'string', `zh.${key}`);
    assert.ok(value.length > 0, `zh.${key} is not empty`);
  }

  for (const label of ['Name', 'Workflow', 'Branch', 'Event', 'Status', 'Completed']) {
    const key = Object.keys(runtimeEn).find((candidate) => runtimeEn[candidate] === label);

    assert.ok(key, `the inline en dictionary has the ${label} header label`);
    assert.equal(enFile[key], label, `locale/en.json has the ${label} header label`);
    assert.equal(typeof zhFile[key], 'string', `locale/zh.json has the ${label} key`);
    assert.ok(zhFile[key].length > 0, `locale/zh.json ${label} is translated`);
    assert.equal(typeof runtimeZh[key], 'string', `the inline zh dictionary has the ${label} key`);
  }

  harness.unmount();
});
