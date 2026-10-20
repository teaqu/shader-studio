#!/usr/bin/env node
// Publishes a built site into one directory of the gh-pages branch, leaving
// the rest of the branch alone. The live site owns the branch root (apart from
// pr-preview/), and each pull request preview owns pr-preview/pr-<number>/, so
// the main deploy and previews can push independently. A push that loses a
// race is rebuilt on the newer branch and retried.
//
//   node publish-pages.mjs --source public --keep pr-preview
//   node publish-pages.mjs --source public --target pr-preview/pr-12
//   node publish-pages.mjs --remove --target pr-preview/pr-12
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BRANCH = 'gh-pages';

export function parseArguments(argv) {
  const options = { source: null, target: '', keep: [], remove: false, attempts: 4 };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) {
        throw new Error(`${flag} needs a value`);
      }
      return next;
    };
    switch (flag) {
      case '--source':
        options.source = value();
        break;
      case '--target':
        options.target = value();
        break;
      case '--keep':
        options.keep.push(value());
        break;
      case '--remove':
        options.remove = true;
        break;
      case '--attempts':
        options.attempts = Number(value());
        break;
      default:
        throw new Error(`Unknown argument ${flag}`);
    }
  }
  options.target = options.target.replace(/^\/+|\/+$/g, '');
  if (options.target.split('/').some((part) => part === '..' || part === '.git')) {
    throw new Error(`Refusing to publish outside the branch: ${options.target}`);
  }
  if (options.remove ? options.source !== null : options.source === null) {
    throw new Error('Pass --source to publish, or --remove without --source');
  }
  if (options.remove && !options.target) {
    throw new Error('--remove needs a --target; the branch root is never removed');
  }
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    throw new Error('--attempts must be a positive integer');
  }
  return options;
}

/** Replaces `target` inside `worktree` with `source`, keeping the `keep` entries. */
export function applyChange(worktree, { source, target, keep, remove }) {
  const destination = join(worktree, target);
  if (existsSync(destination)) {
    for (const entry of readdirSync(destination)) {
      if (entry !== '.git' && !(target === '' && keep.includes(entry))) {
        rmSync(join(destination, entry), { recursive: true, force: true });
      }
    }
    if (remove && target) {
      rmSync(destination, { recursive: true, force: true });
    }
  }
  if (!remove) {
    cpSync(source, destination, { recursive: true });
  }
  // Pages runs Jekyll on branch sites unless told not to.
  writeFileSync(join(worktree, '.nojekyll'), '');
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function remoteHasBranch(repository) {
  try {
    git(repository, 'fetch', '--depth', '1', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`);
    return true;
  } catch (error) {
    if (/couldn't find remote ref/i.test(String(error.stderr ?? error.message))) {
      return false;
    }
    throw error;
  }
}

/** Checks out the current gh-pages, or an empty orphan branch before the first deploy. */
function prepareWorktree(repository, worktree) {
  if (remoteHasBranch(repository)) {
    git(repository, 'worktree', 'add', '--force', '--detach', worktree, `origin/${BRANCH}`);
  } else {
    git(repository, 'worktree', 'add', '--force', '--detach', worktree);
    git(worktree, 'checkout', '--orphan', `${BRANCH}-publish`);
    git(worktree, 'rm', '-rf', '--quiet', '--ignore-unmatch', '.');
    git(worktree, 'clean', '-fdx');
  }
}

export function publish(options, { repository = process.cwd(), message, beforePush = () => {} } = {}) {
  const source = options.source && resolve(options.source);
  if (source && !existsSync(source)) {
    throw new Error(`Nothing to publish: ${options.source} does not exist`);
  }
  const worktree = join(mkdtempSync(join(tmpdir(), 'publish-pages-')), 'site');
  const summary = message ?? (options.remove
    ? `Remove ${options.target}`
    : `Publish ${options.target || 'site'}`);
  try {
    for (let attempt = 1; attempt <= options.attempts; attempt++) {
      prepareWorktree(repository, worktree);
      applyChange(worktree, { ...options, source });
      git(worktree, 'add', '--all');
      if (!git(worktree, 'status', '--porcelain')) {
        return { changed: false, attempts: attempt };
      }
      git(worktree, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '--quiet', '-m', summary);
      beforePush(attempt);
      try {
        git(worktree, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`);
        return { changed: true, attempts: attempt };
      } catch (error) {
        if (attempt === options.attempts) {
          throw error;
        }
        console.warn(`Push ${attempt} was rejected, retrying on the newer ${BRANCH}.`);
      } finally {
        git(repository, 'worktree', 'remove', '--force', worktree);
      }
    }
  } finally {
    rmSync(join(worktree, '..'), { recursive: true, force: true });
    git(repository, 'worktree', 'prune');
  }
  throw new Error('unreachable');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = publish(parseArguments(process.argv.slice(2)));
    console.log(result.changed ? `Published to ${BRANCH}.` : `${BRANCH} already up to date.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
