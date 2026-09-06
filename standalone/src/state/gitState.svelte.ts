import type { WorkspaceDiff } from '../git/gitSync';

/** Shared git-sync session state for the standalone shell (token is tab-scoped). */

const TOKEN_KEY = 'shader-studio.git-token';
const REPO_KEY = 'shader-studio.git-repo';
const BRANCH_KEY = 'shader-studio.git-branch';

export type GitPhase = 'signed-out' | 'ready' | 'synced';

export interface GitStatus extends WorkspaceDiff {
  skipped: { path: string; reason: 'binary' | 'too-large' }[];
}

function readStorage(storage: Storage | undefined, key: string): string {
  try {
    return storage?.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function parseStoredRepo(value: string): { owner: string; repo: string } {
  const match = value.match(/^([^/\s]+)\/([^/\s]+)$/);
  return match ? { owner: match[1], repo: match[2] } : { owner: '', repo: '' };
}

const storedRepo = parseStoredRepo(
  readStorage(typeof localStorage === 'undefined' ? undefined : localStorage, REPO_KEY),
);

let token = $state(readStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage, TOKEN_KEY));
let login = $state('');
let owner = $state(storedRepo.owner);
let repo = $state(storedRepo.repo ? `${storedRepo.owner}/${storedRepo.repo}` : '');
let repoName = $state(storedRepo.repo);
let branch = $state(readStorage(typeof localStorage === 'undefined' ? undefined : localStorage, BRANCH_KEY));
let baseCommitSha = $state('');
let baseTreeSha = $state('');
let baseFiles = $state(new Map<string, string>());
let status = $state<GitStatus>({ added: [], modified: [], deleted: [], clean: true, skipped: [] });
let lastSyncAt = $state('');
let busy = $state(false);
let error = $state('');

export function getGitToken(): string {
  return token;
}

export function getGitLogin(): string {
  return login;
}

export function getGitRepoInput(): string {
  return repo;
}

export function getGitBranch(): string {
  return branch;
}

export function getGitOwner(): string {
  return owner;
}

export function getGitRepo(): string {
  return repoName;
}

export function getGitPhase(): GitPhase {
  if (!token) {
    return 'signed-out';
  }
  return baseCommitSha ? 'synced' : 'ready';
}

export function getGitBase(): { commitSha: string; treeSha: string; files: Map<string, string> } {
  return { commitSha: baseCommitSha, treeSha: baseTreeSha, files: baseFiles };
}

export function getGitStatus(): GitStatus {
  return status;
}

export function getGitLastSyncAt(): string {
  return lastSyncAt;
}

export function isGitBusy(): boolean {
  return busy;
}

export function getGitError(): string {
  return error;
}

export function setGitBusy(value: boolean): void {
  busy = value;
}

export function setGitError(message: string): void {
  error = message;
}

export function setGitToken(value: string, userLogin: string): void {
  token = value;
  login = userLogin;
  try {
    if (value) {
      sessionStorage.setItem(TOKEN_KEY, value);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Token persistence is a convenience; the in-memory session still works.
  }
}

export function setGitRepo(nextOwner: string, nextRepo: string, nextBranch: string): void {
  owner = nextOwner;
  repoName = nextRepo;
  repo = `${nextOwner}/${nextRepo}`;
  branch = nextBranch;
  try {
    localStorage.setItem(REPO_KEY, nextRepo ? `${nextOwner}/${nextRepo}` : '');
    localStorage.setItem(BRANCH_KEY, nextBranch);
  } catch {
    // Repo persistence is a convenience.
  }
}

export function setGitBase(commitSha: string, treeSha: string, files: Map<string, string>): void {
  baseCommitSha = commitSha;
  baseTreeSha = treeSha;
  baseFiles = files;
}

export function setGitStatus(next: GitStatus): void {
  status = next;
}

export function setGitLastSyncAt(value: string): void {
  lastSyncAt = value;
}

export function resetGitState(): void {
  token = '';
  login = '';
  baseCommitSha = '';
  baseTreeSha = '';
  baseFiles = new Map();
  status = { added: [], modified: [], deleted: [], clean: true, skipped: [] };
  lastSyncAt = '';
  busy = false;
  error = '';
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Session cleanup is best-effort.
  }
}
