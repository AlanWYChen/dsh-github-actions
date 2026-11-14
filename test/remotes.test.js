/**
 * Unit contract for src/remotes.js — REQUIREMENTS.md §9.1 and §9.2.
 *
 * These tests are derived only from the frozen requirements and
 * docs/ARCHITECTURE.md. No process, network, or filesystem I/O is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGitHubRemote,
  parseRemoteLines,
  pickGitHubRemote,
  isSafeSegment,
} from '../src/remotes.js';

const REPO = { host: 'github.com', owner: 'octo', name: 'hello' };

test('parseGitHubRemote maps every accepted URL form to {host, owner, name}', () => {
  const cases = [
    'https://github.com/octo/hello',
    'https://github.com/octo/hello.git',
    'https://github.com/octo/hello/',
    'http://github.com/octo/hello',
    'http://github.com/octo/hello.git',
    'ssh://git@github.com/octo/hello',
    'ssh://git@github.com/octo/hello.git',
    'git://github.com/octo/hello',
    'git://github.com/octo/hello.git',
    'git@github.com:octo/hello',
    'git@github.com:octo/hello.git',
  ];

  for (const url of cases) {
    assert.deepEqual(parseGitHubRemote(url), REPO, url);
  }
});

test('parseGitHubRemote honours the configurable host and defaults to github.com', () => {
  assert.deepEqual(parseGitHubRemote('https://ghe.example.com/octo/hello.git', 'ghe.example.com'), {
    host: 'ghe.example.com',
    owner: 'octo',
    name: 'hello',
  });

  // A custom host is not accepted when the caller asks for the default host.
  assert.equal(parseGitHubRemote('https://ghe.example.com/octo/hello.git'), undefined);
  // And github.com is not accepted when the caller asked for another host.
  assert.equal(parseGitHubRemote('https://github.com/octo/hello.git', 'ghe.example.com'), undefined);
});

test('parseGitHubRemote rejects non-GitHub, lookalike, malformed, and unsafe URLs', () => {
  const rejected = [
    // Lookalike / hostile hosts.
    'https://github.com.evil.io/octo/hello.git',
    'https://notgithub.com/octo/hello.git',
    'https://evil.io/github.com/octo/hello.git',
    'https://github.com@evil.io/octo/hello.git',
    'https://evil.io@github.com/octo/hello.git',
    'ssh://git@github.com.evil.io/octo/hello.git',
    'git@github.com.evil.io:octo/hello.git',
    'https://gitlab.com/octo/hello.git',
    // Malformed repository paths.
    'https://github.com/octo',
    'https://github.com/octo/',
    'https://github.com//hello',
    'https://github.com/octo/hello/extra',
    'git@github.com:octo',
    'git@github.com:/octo/hello.git',
    'https://github.com/octo/hello name',
    'https://github.com/octo/hello%2Fextra',
    'https://github.com/octo/na%2Fme',
    'https://github.com/../hello',
    'https://github.com/octo/..',
    'https://github.com/./hello',
    'not a url',
    '',
  ];

  for (const url of rejected) {
    assert.equal(parseGitHubRemote(url), undefined, url);
  }

  for (const value of [undefined, null, 42, {}, []]) {
    assert.equal(parseGitHubRemote(value), undefined, String(value));
  }
});

test('isSafeSegment enforces the GitHub-safe character set and rejects dot segments', () => {
  for (const value of ['octo', 'hello-world', 'a.b', 'a_b', 'abc123', 'A1', 'x'.repeat(100)]) {
    assert.equal(isSafeSegment(value), true, value);
  }

  for (const value of ['', '.', '..', 'a/b', 'a b', 'a:b', 'a@b', 'a?b', 'a#b', 'a%2Fb', '-bad?', null, undefined, 7]) {
    assert.equal(isSafeSegment(value), false, String(value));
  }
});

test('parseRemoteLines reads git remote -v output in declaration order', () => {
  const text = [
    'origin\thttps://github.com/octo/hello.git (fetch)',
    'origin\thttps://github.com/octo/hello.git (push)',
    'upstream\tgit@github.com:up/stream.git (fetch)',
    'upstream\tgit@github.com:up/stream.git (push)',
  ].join('\n');

  assert.deepEqual(parseRemoteLines(text), [
    { name: 'origin', url: 'https://github.com/octo/hello.git', kind: 'fetch' },
    { name: 'origin', url: 'https://github.com/octo/hello.git', kind: 'push' },
    { name: 'upstream', url: 'git@github.com:up/stream.git', kind: 'fetch' },
    { name: 'upstream', url: 'git@github.com:up/stream.git', kind: 'push' },
  ]);

  assert.deepEqual(parseRemoteLines(''), []);
  assert.deepEqual(parseRemoteLines('\n'), []);
});

test('pickGitHubRemote prefers the remote with upstream tracking evidence', () => {
  const remotes = parseRemoteLines(
    [
      'origin\thttps://github.com/octo/hello.git (fetch)',
      'origin\thttps://github.com/octo/hello.git (push)',
      'upstream\tgit@github.com:up/stream.git (fetch)',
      'upstream\tgit@github.com:up/stream.git (push)',
    ].join('\n'),
  );

  assert.deepEqual(
    pickGitHubRemote(remotes, 'github.com', (name) => (name === 'upstream' ? 'main' : null)),
    { name: 'upstream', repo: { host: 'github.com', owner: 'up', name: 'stream' } },
  );

  // Without upstream evidence the order falls back to origin.
  assert.deepEqual(
    pickGitHubRemote(remotes, 'github.com', () => null),
    { name: 'origin', repo: REPO },
  );

  // Missing evidence callback is still tolerated.
  assert.deepEqual(pickGitHubRemote(remotes, 'github.com'), { name: 'origin', repo: REPO });
});

test('pickGitHubRemote falls back to origin and then declaration order', () => {
  const originSecond = parseRemoteLines(
    [
      'fork\tgit@github.com:fork/hello.git (fetch)',
      'fork\tgit@github.com:fork/hello.git (push)',
      'origin\thttps://github.com/octo/hello.git (fetch)',
      'origin\thttps://github.com/octo/hello.git (push)',
    ].join('\n'),
  );
  assert.deepEqual(
    pickGitHubRemote(originSecond, 'github.com', () => null),
    { name: 'origin', repo: REPO },
  );

  // No origin: the first GitHub remote in declaration order wins.
  const forkFirst = parseRemoteLines(
    [
      'fork\tgit@github.com:fork/hello.git (fetch)',
      'fork\tgit@github.com:fork/hello.git (push)',
      'mirror\thttps://github.com/mirror/hello.git (fetch)',
      'mirror\thttps://github.com/mirror/hello.git (push)',
    ].join('\n'),
  );
  assert.deepEqual(
    pickGitHubRemote(forkFirst, 'github.com', () => null),
    { name: 'fork', repo: { host: 'github.com', owner: 'fork', name: 'hello' } },
  );

  // Non-GitHub remotes never win, even when they carry upstream evidence.
  const nonGitHub = parseRemoteLines(
    [
      'upstream\tgit@gitlab.com:up/stream.git (fetch)',
      'upstream\tgit@gitlab.com:up/stream.git (push)',
      'origin\thttps://github.com/octo/hello.git (fetch)',
      'origin\thttps://github.com/octo/hello.git (push)',
    ].join('\n'),
  );
  assert.deepEqual(
    pickGitHubRemote(nonGitHub, 'github.com', (name) => (name === 'upstream' ? 'main' : null)),
    { name: 'origin', repo: REPO },
  );
});

test('pickGitHubRemote returns undefined when no remote is a GitHub repository', () => {
  assert.equal(pickGitHubRemote([], 'github.com', () => null), undefined);

  const onlyGitLab = parseRemoteLines(
    ['origin\thttps://gitlab.com/octo/hello.git (fetch)', 'origin\thttps://gitlab.com/octo/hello.git (push)'].join('\n'),
  );
  assert.equal(pickGitHubRemote(onlyGitLab, 'github.com', () => null), undefined);

  const customHost = parseRemoteLines(
    ['origin\thttps://ghe.example.com/octo/hello.git (fetch)', 'origin\thttps://ghe.example.com/octo/hello.git (push)'].join('\n'),
  );
  assert.deepEqual(pickGitHubRemote(customHost, 'ghe.example.com', () => null), {
    name: 'origin',
    repo: { host: 'ghe.example.com', owner: 'octo', name: 'hello' },
  });
});
