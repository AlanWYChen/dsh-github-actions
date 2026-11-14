/**
 * Pure GitHub Actions run mapping — REQUIREMENTS.md §4/§9.3 (v1) and
 * §11/§13.1–13.2 (v1.1 history).
 *
 * Tolerant of missing optional fields and unknown statuses; never fetches.
 */

import { workflowFileUrlFromRunHtml } from './remotes.js';

const ACTIVE_STATUSES = new Set([
  'queued',
  'in_progress',
  'requested',
  'waiting',
  'pending',
]);

/** True for exactly the five active workflow-run statuses. */
export function isActiveStatus(status) {
  return typeof status === 'string' && ACTIVE_STATUSES.has(status);
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Map one GitHub REST workflow run into the frozen `Run` shape. */
export function mapWorkflowRun(raw, host = 'github.com') {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const name = typeof source.name === 'string' ? source.name : '';
  const workflowName =
    typeof source.workflow_name === 'string' && source.workflow_name.length > 0
      ? source.workflow_name
      : name;
  const branch = stringOrNull(source.head_branch);
  const path = stringOrNull(source.path);
  const htmlUrl = typeof source.html_url === 'string' ? source.html_url : '';
  const workflowUrl =
    branch !== null && path !== null
      ? workflowFileUrlFromRunHtml(htmlUrl, branch, path) ?? null
      : null;

  // Active runs never expose a conclusion or a completion time (§11/§13.1).
  // Finished runs keep GitHub's conclusion string (or null) and use
  // `updated_at` as completedAt, falling back to `created_at`.
  const active = isActiveStatus(source.status);
  const conclusion =
    active === true
      ? null
      : typeof source.conclusion === 'string'
        ? source.conclusion
        : null;
  const completedAt =
    active === true ? null : stringOrNull(source.updated_at) ?? stringOrNull(source.created_at);

  return {
    id: source.id,
    name: name.length > 0 ? name : workflowName,
    workflowName,
    status: source.status,
    conclusion,
    event: typeof source.event === 'string' ? source.event : '',
    branch,
    actor:
      source.actor !== null &&
      typeof source.actor === 'object' &&
      typeof source.actor.login === 'string'
        ? source.actor.login
        : null,
    number: typeof source.run_number === 'number' ? source.run_number : null,
    createdAt: typeof source.created_at === 'string' ? source.created_at : null,
    startedAt: stringOrNull(source.run_started_at),
    completedAt,
    htmlUrl,
    workflowUrl,
  };
}

function timestampOf(run) {
  const parsed = Date.parse(run.createdAt ?? '');

  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Every active run, newest `createdAt` first, capped (default 20). Completed
 * and unknown statuses are dropped.
 */
export function activeRuns(rawRuns, host = 'github.com', limit = 20) {
  if (!Array.isArray(rawRuns)) return [];

  const mapped = rawRuns
    .filter((raw) => raw !== null && typeof raw === 'object' && isActiveStatus(raw.status))
    .map((raw) => mapWorkflowRun(raw, host));

  mapped.sort((left, right) => timestampOf(right) - timestampOf(left));

  const cap = Number.isInteger(limit) && limit > 0 ? limit : 20;

  return mapped.slice(0, cap);
}

function completedTimestampOf(run) {
  const parsed = Date.parse(run.completedAt ?? '');

  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Completed runs only, newest `completedAt` first (entries with no dates last),
 * capped at `limit` (default 20). REQUIREMENTS §13.2.
 */
export function historyRuns(rawRuns, host = 'github.com', limit = 20) {
  if (!Array.isArray(rawRuns)) return [];

  const mapped = rawRuns
    .filter((raw) => raw !== null && typeof raw === 'object' && raw.status === 'completed')
    .map((raw) => mapWorkflowRun(raw, host));

  mapped.sort((left, right) => {
    const leftTimestamp = completedTimestampOf(left);
    const rightTimestamp = completedTimestampOf(right);

    if (leftTimestamp === rightTimestamp) return 0;

    return rightTimestamp > leftTimestamp ? 1 : -1;
  });

  const cap = Number.isInteger(limit) && limit > 0 ? limit : 20;

  return mapped.slice(0, cap);
}
