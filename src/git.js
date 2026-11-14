/**
 * Checkout detection and the git process seam — REQUIREMENTS.md §4
 * `snapshot` and docs/ARCHITECTURE.md `src/git.js`.
 *
 * The `run(cwd, args)` process runner is injected. This module never fetches
 * and never spawns; the Host supplies the real execFile-based runner.
 */

import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseRemoteLines, pickGitHubRemote, repoWebUrl } from './remotes.js';

const HOST_PATTERN = /^[A-Za-z0-9.-]+$/;

/**
 * A checkout exists but git could not read it. `no-git` is an RPC error code
 * (REQUIREMENTS §4), never a `Snapshot.repoStatus` value, so this module throws
 * and the Host turns it into `ok:false`.
 */
function noGitError(message, cause) {
  const error = new Error(message);

  error.name = 'GitInspectionError';
  error.code = 'no-git';
  error.details =
    typeof cause === 'string' && cause.length > 0 ? { cause } : {};

  return error;
}

async function hasGitDirectory(startPath) {
  if (typeof startPath !== 'string' || startPath.length === 0) return false;

  let directory = startPath;

  for (;;) {
    try {
      const info = await stat(join(directory, '.git'));

      // Worktrees use a `.git` file; both spellings mean "this is a checkout".
      if (info.isDirectory() || info.isFile()) return true;
    } catch {
      /* keep walking up */
    }

    const parent = dirname(directory);

    if (parent === directory) return false;

    directory = parent;
  }
}

function firstLine(text) {
  if (typeof text !== 'string') return '';

  return text.split(/\r?\n/)[0].trim();
}

async function currentBranch(run, workspacePath) {
  try {
    const result = await run(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']);

    if (result === null || typeof result !== 'object' || result.exitCode !== 0) return null;

    const branch = firstLine(result.stdout);

    return branch !== '' && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

async function upstreamEvidence(run, workspacePath, remotes, branch) {
  const evidence = new Map();

  if (branch === null) return evidence;

  const names = [...new Set(remotes.map((remote) => remote.name))];

  for (const name of names) {
    try {
      const result = await run(workspacePath, [
        'rev-parse',
        '--abbrev-ref',
        `${name}/${branch}@{upstream}`,
      ]);

      if (result === null || typeof result !== 'object' || result.exitCode !== 0) continue;

      const upstream = firstLine(result.stdout);

      if (upstream !== '') evidence.set(name, upstream);
    } catch {
      /* no upstream for this remote */
    }
  }

  return evidence;
}

/**
 * Detect the workspace's checkout state and GitHub repository.
 *
 * @param {object} options
 * @param {(cwd: string, args: string[]) => Promise<{stdout: string, stderr: string, exitCode: number}>} options.run
 * @param {string} options.workspacePath
 * @param {string} [options.host]
 * @returns {Promise<{repoStatus: 'ok' | 'no-checkout' | 'no-remote' | 'not-github', repo: object | null, remotes: Array}>}
 * @throws {Error & {code: 'no-git'}} when the checkout exists but git cannot read it
 */
export async function detectCheckout({ run, workspacePath, host = 'github.com' } = {}) {
  const wantedHost = typeof host === 'string' && host ? host : 'github.com';

  if (typeof run !== 'function') {
    throw noGitError(
      'Git is not available; install git (or repair the DSH git runner) and retry.',
    );
  }

  if (!(await hasGitDirectory(workspacePath))) {
    return { repoStatus: 'no-checkout', repo: null, remotes: [] };
  }

  let stdout;

  try {
    const result = await run(workspacePath, ['remote', '-v']);

    if (result === null || typeof result !== 'object') {
      throw noGitError('git remote -v returned no result; repair the checkout and retry.');
    }

    if (result.exitCode !== 0) {
      const stderr = firstLine(result.stderr);

      throw noGitError(
        'git cannot read this checkout; verify that git is installed and the repository is healthy, then retry.',
        stderr,
      );
    }

    stdout = result.stdout;
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'no-git') throw error;

    throw noGitError(
      'git cannot read this checkout; verify that git is installed and the repository is healthy, then retry.',
      error !== null && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : undefined,
    );
  }

  const remotes = parseRemoteLines(stdout);
  const branch = await currentBranch(run, workspacePath);
  const evidence = await upstreamEvidence(run, workspacePath, remotes, branch);
  const picked = pickGitHubRemote(
    remotes,
    HOST_PATTERN.test(wantedHost) ? wantedHost : 'github.com',
    (name) => evidence.get(name) ?? null,
  );

  if (picked === undefined) {
    return {
      repoStatus: remotes.length > 0 ? 'not-github' : 'no-remote',
      repo: null,
      remotes,
    };
  }

  return {
    repoStatus: 'ok',
    repo: {
      host: picked.repo.host,
      owner: picked.repo.owner,
      name: picked.repo.name,
      slug: `${picked.repo.owner}/${picked.repo.name}`,
      webUrl: repoWebUrl(picked.repo),
      defaultBranch: null,
      source: 'remote',
    },
    remotes,
  };
}
