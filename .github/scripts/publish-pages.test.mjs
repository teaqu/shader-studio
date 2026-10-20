import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArguments, publish } from './publish-pages.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A bare origin plus a checkout, like the runner's repository. */
function repositories() {
  const root = mkdtempSync(join(tmpdir(), 'publish-pages-test-'));
  const origin = join(root, 'origin.git');
  const checkout = join(root, 'checkout');
  git(root, 'init', '--quiet', '--bare', origin);
  git(root, 'clone', '--quiet', origin, checkout);
  git(checkout, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--allow-empty', '-m', 'main');
  git(checkout, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  return { root, origin, checkout };
}

function site(root, name, files) {
  const directory = join(root, name);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(directory, path, '..'), { recursive: true });
    writeFileSync(join(directory, path), contents);
  }
  return directory;
}

function branchFiles(origin) {
  return git(origin, 'ls-tree', '-r', '--name-only', 'gh-pages').split('\n').filter(Boolean).sort();
}

const show = (origin, path) => git(origin, 'show', `gh-pages:${path}`);

test('arguments need a source to publish and a target to remove', () => {
  assert.deepEqual(parseArguments(['--source', 'public', '--keep', 'pr-preview']),
    { source: 'public', target: '', keep: ['pr-preview'], remove: false, attempts: 4 });
  assert.equal(parseArguments(['--source', 'p', '--target', '/pr-preview/pr-1/']).target, 'pr-preview/pr-1');
  assert.equal(parseArguments(['--remove', '--target', 'pr-preview/pr-1', '--attempts', '2']).attempts, 2);
  assert.throws(() => parseArguments([]), /--source/);
  assert.throws(() => parseArguments(['--remove', '--source', 'p', '--target', 'x']), /--source/);
  assert.throws(() => parseArguments(['--remove']), /never removed/);
  assert.throws(() => parseArguments(['--source', 'p', '--target', '../outside']), /outside/);
  assert.throws(() => parseArguments(['--source', 'p', '--target', '.git/hooks']), /outside/);
  assert.throws(() => parseArguments(['--source']), /needs a value/);
  assert.throws(() => parseArguments(['--source', 'p', '--attempts', '0']), /positive/);
  assert.throws(() => parseArguments(['--bogus']), /Unknown/);
});

test('the live site and previews share the branch without touching each other', () => {
  const { root, origin, checkout } = repositories();
  const live = site(root, 'live', { 'index.html': 'live 1', 'app/index.html': 'app 1', 'old.txt': 'stale' });

  assert.deepEqual(publish(parseArguments(['--source', live, '--keep', 'pr-preview']), { repository: checkout }),
    { changed: true, attempts: 1 });
  assert.deepEqual(branchFiles(origin), ['.nojekyll', 'app/index.html', 'index.html', 'old.txt']);

  const preview = site(root, 'preview', { 'app/index.html': 'preview app' });
  publish(parseArguments(['--source', preview, '--target', 'pr-preview/pr-7']), { repository: checkout });
  assert.equal(show(origin, 'pr-preview/pr-7/app/index.html'), 'preview app');
  assert.equal(show(origin, 'app/index.html'), 'app 1');

  // A new live build drops its own stale files but keeps every preview.
  const next = site(root, 'live-2', { 'index.html': 'live 2', 'app/index.html': 'app 2' });
  publish(parseArguments(['--source', next, '--keep', 'pr-preview']), { repository: checkout });
  assert.deepEqual(branchFiles(origin), ['.nojekyll', 'app/index.html', 'index.html', 'pr-preview/pr-7/app/index.html']);

  // A preview update replaces only that preview.
  const updated = site(root, 'preview-2', { 'app/main.js': 'v2' });
  publish(parseArguments(['--source', updated, '--target', 'pr-preview/pr-7']), { repository: checkout });
  assert.deepEqual(branchFiles(origin), ['.nojekyll', 'app/index.html', 'index.html', 'pr-preview/pr-7/app/main.js']);

  assert.deepEqual(publish(parseArguments(['--remove', '--target', 'pr-preview/pr-7']), { repository: checkout }),
    { changed: true, attempts: 1 });
  assert.deepEqual(branchFiles(origin), ['.nojekyll', 'app/index.html', 'index.html']);
  assert.equal(readFileSync(join(next, 'index.html'), 'utf8'), 'live 2');
});

test('publishing nothing new and removing a missing preview make no commit', () => {
  const { root, origin, checkout } = repositories();
  const live = site(root, 'live', { 'index.html': 'live' });
  publish(parseArguments(['--source', live]), { repository: checkout });
  const head = git(origin, 'rev-parse', 'gh-pages');

  assert.deepEqual(publish(parseArguments(['--source', live]), { repository: checkout }), { changed: false, attempts: 1 });
  assert.deepEqual(publish(parseArguments(['--remove', '--target', 'pr-preview/pr-9']), { repository: checkout }),
    { changed: false, attempts: 1 });
  assert.equal(git(origin, 'rev-parse', 'gh-pages'), head);
});

test('a push that loses a race is rebuilt on the newer branch', () => {
  const { root, origin, checkout } = repositories();
  publish(parseArguments(['--source', site(root, 'live', { 'index.html': 'live' })]), { repository: checkout });
  const other = join(root, 'other');
  git(root, 'clone', '--quiet', '--branch', 'gh-pages', origin, other);

  const preview = site(root, 'preview', { 'index.html': 'preview' });
  const result = publish(parseArguments(['--source', preview, '--target', 'pr-preview/pr-3']), {
    repository: checkout,
    beforePush: (attempt) => {
      if (attempt === 1) {
        // Another deploy lands between this job's fetch and its push.
        mkdirSync(join(other, 'pr-preview', 'pr-4'), { recursive: true });
        writeFileSync(join(other, 'pr-preview', 'pr-4', 'index.html'), 'other preview');
        git(other, 'add', '--all');
        git(other, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'pr-4');
        git(other, 'push', '--quiet', 'origin', 'HEAD:refs/heads/gh-pages');
      }
    },
  });

  assert.deepEqual(result, { changed: true, attempts: 2 });
  assert.equal(show(origin, 'pr-preview/pr-3/index.html'), 'preview');
  assert.equal(show(origin, 'pr-preview/pr-4/index.html'), 'other preview');
});

test('gives up after the last attempt and reports a missing build', () => {
  const { root, checkout } = repositories();
  const live = site(root, 'live', { 'index.html': 'live' });
  publish(parseArguments(['--source', live]), { repository: checkout });
  git(checkout, 'remote', 'set-url', '--push', 'origin', join(root, 'missing.git'));
  const changed = site(root, 'live-2', { 'index.html': 'changed' });

  assert.throws(() => publish(parseArguments(['--source', changed, '--attempts', '2']), { repository: checkout }));
  assert.throws(() => publish(parseArguments(['--source', join(root, 'absent')]), { repository: checkout }), /does not exist/);
});
