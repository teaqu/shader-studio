/** Minimal GitHub REST client for standalone git sync (browser-only, no backend). */

export const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface GitHubBranchHead {
  commitSha: string;
  treeSha: string;
}

/** Minimal fetch shape so tests can inject lightweight mocks. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const TEXT_SIZE_LIMIT = 950_000;

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function parseRepoReference(input: string): { owner: string; repo: string } {
  const trimmed = input.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  const match = urlMatch ?? shortMatch;
  if (!match) {
    throw new Error('Enter a repo as "owner/name" or a github.com URL.');
  }
  const [, owner, repo] = match;
  if (!owner || !repo) {
    throw new Error('Enter a repo as "owner/name" or a github.com URL.');
  }
  return { owner, repo };
}

export function encodeTextBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeBase64Text(base64: string): string {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Binary heuristic: NUL bytes or a high share of control characters. */
export function isBinaryText(text: string): boolean {
  if (text.includes('\0')) {
    return true;
  }
  const sample = text.slice(0, 8000);
  if (sample.length === 0) {
    return false;
  }
  let suspicious = 0;
  for (const character of sample) {
    const code = character.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32 && code !== 27)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.1;
}

async function requestJson(
  path: string,
  token: string,
  fetchFn: FetchFn,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers | null }> {
  let response: Response;
  try {
    response = await fetchFn(joinApiUrl(path), {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error('Could not reach github.com. Check your connection and try again.');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const rawHeaders: unknown = 'headers' in response ? response.headers : null;
  const headers = rawHeaders && typeof (rawHeaders as Headers).get === 'function'
    ? (rawHeaders as Headers)
    : null;
  return { status: response.status, body, headers };
}

/** Absolute paginated `next` URLs pass through; relative paths join the API base. */
function joinApiUrl(path: string): string {
  return /^https?:\/\//i.test(path) ? path : joinUrl(GITHUB_API_BASE, path);
}

/** Extract the `rel="next"` page URL from a paginated GitHub Link header. */
function nextPagePath(headers: Headers | null): string | null {
  const link = headers?.get?.('link');
  if (!link) {
    return null;
  }
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function throwForStatus(status: number, body: unknown, fallback: string): never {
  const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
    ? body.message
    : fallback;
  if (status === 401) {
    throw new Error('GitHub rejected the token. Check it has not expired and try signing in again.');
  }
  if (status === 403) {
    throw new Error(`GitHub refused the request: ${message}`);
  }
  if (status === 404) {
    throw new Error('Repo or branch not found. Check the name and that the token can access it.');
  }
  if (status === 422) {
    throw new Error(`GitHub rejected the push: ${message}`);
  }
  throw new Error(`GitHub request failed (${status}): ${message}`);
}

function recordBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? body as Record<string, unknown> : {};
}

export async function fetchAuthenticatedUser(
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  if (!token.trim()) {
    throw new Error('Paste a GitHub fine-grained personal access token first.');
  }
  const { status, body } = await requestJson('/user', token, fetchFn);
  if (status !== 200) {
    throwForStatus(status, body, 'Could not validate the token.');
  }
  const login = recordBody(body).login;
  if (typeof login !== 'string' || !login) {
    throw new Error('GitHub returned an unexpected user response.');
  }
  return login;
}

export async function fetchDefaultBranch(
  owner: string,
  repo: string,
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<{ defaultBranch: string; canPush: boolean }> {
  const { status, body } = await requestJson(`/repos/${owner}/${repo}`, token, fetchFn);
  if (status !== 200) {
    throwForStatus(status, body, 'Could not read the repo.');
  }
  const record = recordBody(body);
  if (typeof record.default_branch !== 'string' || !record.default_branch) {
    throw new Error('GitHub returned an unexpected repo response.');
  }
  const permissions = recordBody(record.permissions);
  return { defaultBranch: record.default_branch, canPush: permissions.push === true };
}

export async function fetchBranchHead(
  owner: string,
  repo: string,
  branch: string,
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<GitHubBranchHead> {
  const { status, body } = await requestJson(
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    token,
    fetchFn,
  );
  if (status !== 200) {
    throwForStatus(status, body, 'Could not read the branch.');
  }
  const record = recordBody(body);
  const commit = recordBody(record.commit);
  const commitSha = commit.sha;
  const treeSha = recordBody(commit.commit).treeSha ?? recordBody(recordBody(commit.commit).tree).sha;
  if (typeof commitSha !== 'string' || typeof treeSha !== 'string') {
    throw new Error('GitHub returned an unexpected branch response.');
  }
  return { commitSha, treeSha };
}

export async function fetchRecursiveTree(
  owner: string,
  repo: string,
  treeSha: string,
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<GitHubTreeEntry[]> {
  const { status, body } = await requestJson(
    `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    token,
    fetchFn,
  );
  if (status !== 200) {
    throwForStatus(status, body, 'Could not read the repo tree.');
  }
  const tree = recordBody(body).tree;
  if (!Array.isArray(tree)) {
    throw new Error('GitHub returned an unexpected tree response.');
  }
  const entries: GitHubTreeEntry[] = [];
  for (const item of tree) {
    const record = recordBody(item);
    if (typeof record.path === 'string' && typeof record.sha === 'string'
      && (record.type === 'blob' || record.type === 'tree')) {
      entries.push({
        path: record.path,
        type: record.type,
        sha: record.sha,
        ...(typeof record.size === 'number' ? { size: record.size } : {}),
      });
    }
  }
  const truncated = recordBody(body).truncated === true;
  if (truncated) {
    throw new Error('Repo tree is too large to sync (truncated by GitHub). Sync a smaller repo.');
  }
  return entries;
}

export interface FetchedBlob {
  text: string | null;
  skipped: 'binary' | 'too-large' | null;
}

export async function fetchBlobText(
  owner: string,
  repo: string,
  sha: string,
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<FetchedBlob> {
  const { status, body } = await requestJson(`/repos/${owner}/${repo}/git/blobs/${sha}`, token, fetchFn);
  if (status !== 200) {
    throwForStatus(status, body, 'Could not read a file from GitHub.');
  }
  const record = recordBody(body);
  if (typeof record.size === 'number' && record.size > TEXT_SIZE_LIMIT) {
    return { text: null, skipped: 'too-large' };
  }
  if (record.encoding !== 'base64' || typeof record.content !== 'string') {
    throw new Error('GitHub returned an unexpected file response.');
  }
  let text: string;
  try {
    text = decodeBase64Text(record.content);
  } catch {
    return { text: null, skipped: 'binary' };
  }
  if (isBinaryText(text)) {
    return { text: null, skipped: 'binary' };
  }
  return { text, skipped: null };
}

export async function createBlob(
  owner: string,
  repo: string,
  token: string,
  base64Content: string,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const { status, body } = await requestJson(`/repos/${owner}/${repo}/git/blobs`, token, fetchFn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: base64Content, encoding: 'base64' }),
  });
  if (status !== 201) {
    throwForStatus(status, body, 'Could not upload a file.');
  }
  const sha = recordBody(body).sha;
  if (typeof sha !== 'string' || !sha) {
    throw new Error('GitHub returned an unexpected upload response.');
  }
  return sha;
}

export interface TreeWriteEntry {
  path: string;
  sha: string | null;
}

export async function createTree(
  owner: string,
  repo: string,
  token: string,
  baseTreeSha: string,
  entries: TreeWriteEntry[],
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const tree = entries.map((entry) => entry.sha === null
    ? { path: entry.path, mode: '100644', type: 'blob', sha: null as unknown as string }
    : { path: entry.path, mode: '100644', type: 'blob', sha: entry.sha });
  const { status, body } = await requestJson(`/repos/${owner}/${repo}/git/trees`, token, fetchFn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  if (status !== 201) {
    throwForStatus(status, body, 'Could not create the commit tree.');
  }
  const sha = recordBody(body).sha;
  if (typeof sha !== 'string' || !sha) {
    throw new Error('GitHub returned an unexpected tree response.');
  }
  return sha;
}

export async function createCommit(
  owner: string,
  repo: string,
  token: string,
  message: string,
  treeSha: string,
  parents: string[],
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const { status, body } = await requestJson(`/repos/${owner}/${repo}/git/commits`, token, fetchFn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tree: treeSha, parents }),
  });
  if (status !== 201) {
    throwForStatus(status, body, 'Could not create the commit.');
  }
  const sha = recordBody(body).sha;
  if (typeof sha !== 'string' || !sha) {
    throw new Error('GitHub returned an unexpected commit response.');
  }
  return sha;
}

export async function updateBranchRef(
  owner: string,
  repo: string,
  token: string,
  branch: string,
  sha: string,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const { status, body } = await requestJson(
    `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    token,
    fetchFn,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha, force: false }),
    },
  );
  if (status !== 200) {
    if (status === 422) {
      throw new Error('Remote branch moved ahead. Sync again before pushing.');
    }
    throwForStatus(status, body, 'Could not update the branch.');
  }
}

export interface GitHubRepo {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  canPush: boolean;
}

function parseRepoEntry(item: unknown): GitHubRepo | null {
  const record = recordBody(item);
  const fullName = record.full_name;
  const defaultBranch = record.default_branch;
  if (typeof fullName !== 'string' || typeof defaultBranch !== 'string') {
    return null;
  }
  let owner = '';
  let name = '';
  try {
    ({ owner, repo: name } = parseRepoReference(fullName));
  } catch {
    return null;
  }
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    defaultBranch,
    canPush: recordBody(record.permissions).push === true,
  };
}

/** List the signed-in user's repos (newest first), following pagination. */
export async function fetchUserRepos(
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let path: string | null = '/user/repos?per_page=100&sort=updated';
  for (let page = 0; page < 10 && path !== null; page += 1) {
    const { status, body, headers } = await requestJson(path, token, fetchFn);
    if (status !== 200) {
      throwForStatus(status, body, 'Could not list your repos.');
    }
    if (!Array.isArray(body)) {
      throw new Error('GitHub returned an unexpected repos response.');
    }
    for (const item of body) {
      const repo = parseRepoEntry(item);
      if (repo) {
        repos.push(repo);
      }
    }
    path = nextPagePath(headers);
  }
  return repos;
}

/** List branch names for a repo, following pagination. */
export async function fetchRepoBranches(
  owner: string,
  repo: string,
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<string[]> {
  const branches: string[] = [];
  let path: string | null = `/repos/${owner}/${repo}/branches?per_page=100`;
  for (let page = 0; page < 5 && path !== null; page += 1) {
    const { status, body, headers } = await requestJson(path, token, fetchFn);
    if (status !== 200) {
      throwForStatus(status, body, 'Could not list the branches.');
    }
    if (!Array.isArray(body)) {
      throw new Error('GitHub returned an unexpected branches response.');
    }
    for (const item of body) {
      const name = recordBody(item).name;
      if (typeof name === 'string' && name) {
        branches.push(name);
      }
    }
    path = nextPagePath(headers);
  }
  return branches;
}
