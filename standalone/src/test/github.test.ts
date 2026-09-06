import { describe, expect, it, vi } from 'vitest';
import {
  createBlob,
  createCommit,
  createTree,
  decodeBase64Text,
  encodeTextBase64,
  fetchAuthenticatedUser,
  fetchBlobText,
  fetchBranchHead,
  fetchDefaultBranch,
  fetchRecursiveTree,
  fetchRepoBranches,
  fetchUserRepos,
  isBinaryText,
  parseRepoReference,
  updateBranchRef,
} from '../git/github';

function jsonResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as Response;
}

describe('parseRepoReference', () => {
  it('accepts owner/repo shorthand', () => {
    expect(parseRepoReference('teaqu/shader-studio')).toEqual({ owner: 'teaqu', repo: 'shader-studio' });
  });

  it('accepts github urls with .git suffix and slashes', () => {
    expect(parseRepoReference('https://github.com/teaqu/shader-studio.git/')).toEqual({
      owner: 'teaqu', repo: 'shader-studio',
    });
  });

  it('rejects bare names and non-github urls', () => {
    expect(() => parseRepoReference('just-a-name')).toThrow('owner/name');
    expect(() => parseRepoReference('https://example.com/a/b')).toThrow('owner/name');
    expect(() => parseRepoReference('')).toThrow('owner/name');
  });
});

describe('base64 text helpers', () => {
  it('round-trips unicode text', () => {
    expect(decodeBase64Text(encodeTextBase64('aurora ☀ vec3'))).toBe('aurora ☀ vec3');
  });

  it('detects binary content', () => {
    expect(isBinaryText('void main() {}')).toBe(false);
    expect(isBinaryText('')).toBe(false);
    expect(isBinaryText('abc\0def')).toBe(true);
  });
});

describe('github client auth errors', () => {
  it('validates the token before use', async () => {
    await expect(fetchAuthenticatedUser('   ', vi.fn())).rejects.toThrow('Paste a GitHub');
  });

  it('maps 401 to a token error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { message: 'Bad credentials' }));
    await expect(fetchAuthenticatedUser('bad', fetchFn)).rejects.toThrow('rejected the token');
  });

  it('returns the login on success and sends auth headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { login: 'octocat' }));
    await expect(fetchAuthenticatedUser('good', fetchFn)).resolves.toBe('octocat');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer good');
  });

  it('handles unreachable network', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('down'));
    await expect(fetchAuthenticatedUser('good', fetchFn)).rejects.toThrow('Could not reach github.com');
  });
});

describe('github repo reads', () => {
  it('reads the default branch and push permission', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { default_branch: 'main', permissions: { push: true } }),
    );
    await expect(fetchDefaultBranch('o', 'r', 't', fetchFn)).resolves.toEqual({
      defaultBranch: 'main', canPush: true,
    });
  });

  it('maps 404 to a not-found error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(404, { message: 'Not Found' }));
    await expect(fetchDefaultBranch('o', 'r', 't', fetchFn)).rejects.toThrow('not found');
  });

  it('rejects malformed repo responses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { default_branch: 42 }));
    await expect(fetchDefaultBranch('o', 'r', 't', fetchFn)).rejects.toThrow('unexpected repo response');
  });

  it('reads a branch head commit and tree', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      commit: { sha: 'c1', commit: { tree: { sha: 't1' } } },
    }));
    await expect(fetchBranchHead('o', 'r', 'main', 't', fetchFn)).resolves.toEqual({
      commitSha: 'c1', treeSha: 't1',
    });
  });

  it('reads the recursive tree and filters to blobs', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      truncated: false,
      tree: [
        { path: 'a.glsl', type: 'blob', sha: 's1', size: 10 },
        { path: 'dir', type: 'tree', sha: 's2' },
        { path: 'weird', type: 'commit', sha: 's3' },
      ],
    }));
    const entries = await fetchRecursiveTree('o', 'r', 't1', 't', fetchFn);
    expect(entries).toEqual([
      { path: 'a.glsl', type: 'blob', sha: 's1', size: 10 },
      { path: 'dir', type: 'tree', sha: 's2' },
    ]);
  });

  it('refuses truncated trees', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { truncated: true, tree: [] }));
    await expect(fetchRecursiveTree('o', 'r', 't1', 't', fetchFn)).rejects.toThrow('too large');
  });

  it('decodes blob text and skips oversized files', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      encoding: 'base64', size: 5, content: encodeTextBase64('hello'),
    }));
    await expect(fetchBlobText('o', 'r', 's', 't', fetchFn)).resolves.toEqual({ text: 'hello', skipped: null });

    const big = vi.fn().mockResolvedValue(jsonResponse(200, { encoding: 'base64', size: 2_000_000, content: '' }));
    await expect(fetchBlobText('o', 'r', 's', 't', big)).resolves.toEqual({ text: null, skipped: 'too-large' });
  });

  it('skips undecodable blobs as binary', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      encoding: 'base64', size: 4, content: btoa('\xff\xfe\x00\x01'),
    }));
    await expect(fetchBlobText('o', 'r', 's', 't', fetchFn)).resolves.toEqual({ text: null, skipped: 'binary' });
  });
});

describe('repo and branch listing', () => {
  function linkResponse(status: number, body: unknown, link: string | null): Response {
    return {
      status,
      json: async () => body,
      headers: { get: (name: string) => (name.toLowerCase() === 'link' ? link : null) },
    } as unknown as Response;
  }

  it('lists repos across pages following the Link header', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(linkResponse(200, [
        { full_name: 'octo/b', default_branch: 'main', permissions: { push: true } },
      ], '<https://api.github.com/user/repos?page=2>; rel="next"'))
      .mockResolvedValueOnce(linkResponse(200, [
        { full_name: 'octo/a', default_branch: 'dev', permissions: { push: false } },
      ], null));
    const repos = await fetchUserRepos('t', fetchFn);
    expect(repos).toEqual([
      { owner: 'octo', name: 'b', fullName: 'octo/b', defaultBranch: 'main', canPush: true },
      { owner: 'octo', name: 'a', fullName: 'octo/a', defaultBranch: 'dev', canPush: false },
    ]);
    expect(fetchFn.mock.calls[0][0]).toContain('/user/repos');
  });

  it('skips malformed repo entries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(linkResponse(200, [
      { full_name: 'octo/good', default_branch: 'main', permissions: {} },
      { nope: true },
      'junk',
    ], null));
    await expect(fetchUserRepos('t', fetchFn)).resolves.toEqual([
      { owner: 'octo', name: 'good', fullName: 'octo/good', defaultBranch: 'main', canPush: false },
    ]);
  });

  it('refuses repo listing when the token is rejected', async () => {
    const fetchFn = vi.fn().mockResolvedValue(linkResponse(401, { message: 'Bad' }, null));
    await expect(fetchUserRepos('bad', fetchFn)).rejects.toThrow('rejected the token');
  });

  it('lists branch names', async () => {
    const fetchFn = vi.fn().mockResolvedValue(linkResponse(200, [{ name: 'main' }, { name: 'dev' }], null));
    await expect(fetchRepoBranches('o', 'r', 't', fetchFn)).resolves.toEqual(['main', 'dev']);
  });

  it('rejects malformed branch responses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(linkResponse(200, { branches: [] }, null));
    await expect(fetchRepoBranches('o', 'r', 't', fetchFn)).rejects.toThrow('unexpected branches');
  });
});

describe('github writes', () => {
  it('creates blobs, trees, commits, and updates the ref', async () => {
    const calls: unknown[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      if (url.endsWith('/git/blobs')) {
        return jsonResponse(201, { sha: 'blob1' });
      }
      if (url.endsWith('/git/trees')) {
        return jsonResponse(201, { sha: 'tree1' });
      }
      if (url.endsWith('/git/commits')) {
        return jsonResponse(201, { sha: 'commit1' });
      }
      return jsonResponse(200, {});
    });

    await expect(createBlob('o', 'r', 't', 'aGVsbG8=', fetchFn)).resolves.toBe('blob1');
    await expect(createTree('o', 'r', 't', 'base', [{ path: 'a.glsl', sha: 'blob1' }], fetchFn)).resolves.toBe('tree1');
    await expect(createCommit('o', 'r', 't', 'save', 'tree1', ['parent'], fetchFn)).resolves.toBe('commit1');
    await updateBranchRef('o', 'r', 't', 'main', 'commit1', fetchFn);

    expect(calls[1]).toMatchObject({ base_tree: 'base' });
    expect(calls[2]).toMatchObject({ message: 'save', parents: ['parent'] });
  });

  it('encodes deletions as null tree entries', async () => {
    const seen: unknown[] = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return jsonResponse(201, { sha: 'tree1' });
    });
    await createTree('o', 'r', 't', 'base', [{ path: 'gone.glsl', sha: null }], fetchFn);
    expect(seen[0]).toMatchObject({ tree: [{ path: 'gone.glsl', sha: null }] });
  });

  it('asks to sync when the remote moved ahead', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(422, { message: 'Update is not a fast forward' }));
    await expect(updateBranchRef('o', 'r', 't', 'main', 'c', fetchFn)).rejects.toThrow('moved ahead');
  });

  it('surfaces rate-limit errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { message: 'rate limit exceeded' }));
    await expect(fetchAuthenticatedUser('t', fetchFn)).rejects.toThrow('rate limit');
  });
});
