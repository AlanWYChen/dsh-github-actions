/**
 * Pure GitHub remote parsing — REQUIREMENTS.md §4 and §9.1/§9.2.
 *
 * No process, filesystem, or network access lives here. The only place a
 * repository URL is built is this module, so validation and interpolation
 * cannot drift apart.
 */

const DEFAULT_HOST = 'github.com';
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const SCP_PATTERN = /^([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+):(.+)$/;
const REMOTE_LINE = /^(\S+)\s+(\S+)\s+\((fetch|push)\)\s*$/;

/** A GitHub-safe owner/name segment: `^[A-Za-z0-9_.-]+$`, not `.`/`..`. */
export function isSafeSegment(value) {
  return (
    typeof value === 'string' &&
    value !== '.' &&
    value !== '..' &&
    SAFE_SEGMENT.test(value)
  );
}

function stripDotGit(name) {
  return name.endsWith('.git') ? name.slice(0, -4) : name;
}

function splitRepoPath(rawPath) {
  // Exactly two non-empty, safe segments: owner and name.
  if (typeof rawPath !== 'string' || rawPath.includes('%')) return undefined;

  const trimmed = rawPath.replace(/\/+$/, '');

  if (!trimmed.startsWith('/')) return undefined;

  const parts = trimmed.split('/');

  if (parts.length !== 3 || parts[0] !== '') return undefined;

  const owner = parts[1];
  const name = stripDotGit(parts[2]);

  if (!isSafeSegment(owner) || !isSafeSegment(name)) return undefined;

  return { owner, name };
}

/**
 * Parse a git remote URL for `host` into `{ host, owner, name }`.
 *
 * Accepts `https://`, `http://`, `ssh://`, `git://`, and the scp form
 * `git@host:owner/name.git`, with or without `.git`/a trailing slash.
 * Returns `undefined` for non-GitHub, lookalike, malformed, or unsafe input.
 */
export function parseGitHubRemote(url, host = DEFAULT_HOST) {
  if (typeof url !== 'string') return undefined;

  const wantedHost = (typeof host === 'string' && host) || DEFAULT_HOST;
  const wanted = wantedHost.toLowerCase();
  const text = url.trim();

  if (!text || /\s/.test(text)) return undefined;

  const scp = SCP_PATTERN.exec(text);

  if (scp !== null) {
    const [, user, remoteHost, path] = scp;

    if (user !== 'git' || remoteHost.toLowerCase() !== wanted) return undefined;

    const segments = splitRepoPath(`/${path}`);

    if (segments === undefined) return undefined;

    return { host: wantedHost, owner: segments.owner, name: segments.name };
  }

  let parsed;

  try {
    parsed = new URL(text);
  } catch {
    return undefined;
  }

  if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) {
    return undefined;
  }

  if (parsed.hostname.toLowerCase() !== wanted) return undefined;
  if (parsed.search !== '' || parsed.hash !== '') return undefined;

  // userinfo tricks are rejected: ssh may carry the conventional `git` user,
  // every other scheme must be anonymous.
  if (parsed.password !== '') return undefined;
  if (parsed.username !== '' && !(parsed.protocol === 'ssh:' && parsed.username === 'git')) {
    return undefined;
  }

  const segments = splitRepoPath(parsed.pathname);

  if (segments === undefined) return undefined;

  return { host: wantedHost, owner: segments.owner, name: segments.name };
}

/**
 * Read `git remote -v` output in declaration order. One entry per line, fetch
 * and push lines both preserved; never deduplicated.
 */
export function parseRemoteLines(text) {
  if (typeof text !== 'string' || text.trim() === '') return [];

  const remotes = [];

  for (const line of text.split(/\r?\n/)) {
    const match = REMOTE_LINE.exec(line);

    if (match === null) continue;

    remotes.push({ name: match[1], url: match[2], kind: match[3] });
  }

  return remotes;
}

/**
 * Pick the GitHub remote for a checkout.
 *
 * Order: a remote with upstream tracking evidence (supplied by `upstreamBranchOf`),
 * then `origin`, then the first parseable remote in declaration order. Non-GitHub
 * remotes never win, even when they carry upstream evidence.
 *
 * @returns {{name: string, repo: {host: string, owner: string, name: string}} | undefined}
 */
export function pickGitHubRemote(remotes, host = DEFAULT_HOST, upstreamBranchOf) {
  if (!Array.isArray(remotes)) return undefined;

  const order = [];
  const repoByName = new Map();

  for (const remote of remotes) {
    if (!remote || typeof remote.name !== 'string' || typeof remote.url !== 'string') continue;

    if (!repoByName.has(remote.name)) {
      order.push(remote.name);
      repoByName.set(remote.name, undefined);
    }

    if (repoByName.get(remote.name) === undefined) {
      const repo = parseGitHubRemote(remote.url, host);

      if (repo !== undefined) repoByName.set(remote.name, repo);
    }
  }

  const candidates = [];

  for (const name of order) {
    const repo = repoByName.get(name);

    if (repo !== undefined) candidates.push({ name, repo });
  }

  if (candidates.length === 0) return undefined;

  if (typeof upstreamBranchOf === 'function') {
    for (const candidate of candidates) {
      let branch;

      try {
        branch = upstreamBranchOf(candidate.name);
      } catch {
        branch = undefined;
      }

      if (typeof branch === 'string' && branch.length > 0) return candidate;
    }
  }

  const origin = candidates.find((candidate) => candidate.name === 'origin');

  return origin ?? candidates[0];
}

function encodePath(value) {
  return value
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Web page of a repository: `https://host/owner/name`. */
export function repoWebUrl(repo) {
  return `https://${repo.host}/${repo.owner}/${repo.name}`;
}

/** API URL listing the repository's workflow runs (newest page first). */
export function repoApiRunsUrl(apiBaseUrl, repo) {
  const base = String(apiBaseUrl).replace(/\/+$/, '');

  return `${base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/actions/runs?per_page=50`;
}

/** API URL listing the repository's completed workflow runs (v1.1 history). */
export function repoApiHistoryUrl(apiBaseUrl, repo, limit = 20) {
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 20;

  return `${base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/actions/runs?status=completed&per_page=${cap}`;
}

/** Web page of one run. */
export function runWebUrl(repo, runId) {
  return `${repoWebUrl(repo)}/actions/runs/${encodeURIComponent(String(runId))}`;
}

/** Web page of a workflow file on a branch. */
export function workflowFileUrl(repo, branch, path) {
  if (typeof branch !== 'string' || branch.length === 0) return undefined;

  if (typeof path !== 'string' || path.length === 0) return undefined;

  return `${repoWebUrl(repo)}/blob/${encodePath(branch)}/${encodePath(path.replace(/^\/+/, ''))}`;
}

/**
 * Rebuild the repository web base from a run's `html_url`. `undefined` when the
 * URL is not a recognisable `.../<owner>/<name>/actions/runs/<id>` page.
 */
export function repoBaseFromRunHtml(htmlUrl) {
  if (typeof htmlUrl !== 'string') return undefined;

  const match = /^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+)\/actions\/runs\/\d+\/?$/.exec(htmlUrl);

  if (match === null) return undefined;

  return `${match[1]}/${match[2]}/${match[3]}`;
}

/** Workflow file page derived from a run's `html_url`. */
export function workflowFileUrlFromRunHtml(htmlUrl, branch, path) {
  const base = repoBaseFromRunHtml(htmlUrl);

  if (base === undefined) return undefined;
  if (typeof branch !== 'string' || branch.length === 0) return undefined;
  if (typeof path !== 'string' || path.length === 0) return undefined;

  return `${base}/blob/${encodePath(branch)}/${encodePath(path.replace(/^\/+/, ''))}`;
}
