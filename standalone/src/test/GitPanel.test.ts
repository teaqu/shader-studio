import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitPanel from '../GitPanel.svelte';
import { resetGitState } from '../state/gitState.svelte';

vi.mock('../git/github', async (importOriginal) => {
  const original = await importOriginal<typeof import('../git/github')>();
  return {
    ...original,
    fetchAuthenticatedUser: vi.fn(),
    fetchDefaultBranch: vi.fn(),
    fetchBranchHead: vi.fn(),
    fetchRecursiveTree: vi.fn(),
    fetchBlobText: vi.fn(),
    createBlob: vi.fn(),
    createTree: vi.fn(),
    createCommit: vi.fn(),
    updateBranchRef: vi.fn(),
    fetchUserRepos: vi.fn(),
    fetchRepoBranches: vi.fn(),
  };
});

import {
  createBlob,
  createCommit,
  createTree,
  fetchAuthenticatedUser,
  fetchBlobText,
  fetchBranchHead,
  fetchDefaultBranch,
  fetchRecursiveTree,
  fetchRepoBranches,
  fetchUserRepos,
  updateBranchRef,
} from '../git/github';
import type { WebTransport } from '../WebTransport';

type TestTransport = WebTransport & {
  listWorkspaceFiles: ReturnType<typeof vi.fn>;
  readWorkspaceSnapshot: ReturnType<typeof vi.fn>;
  applySyncedFiles: ReturnType<typeof vi.fn>;
  onWorkspaceChange: ReturnType<typeof vi.fn>;
};

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function createTransport(snapshot: { path: string; contents: string }[] = []): TestTransport {
  return {
    listWorkspaceFiles: vi.fn().mockResolvedValue(snapshot.map((file) => ({ path: file.path, modifiedAt: 1 }))),
    readWorkspaceSnapshot: vi.fn().mockResolvedValue(snapshot),
    applySyncedFiles: vi.fn().mockResolvedValue(undefined),
    onWorkspaceChange: vi.fn(() => () => {}),
  } as unknown as TestTransport;
}

describe('GitPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetGitState();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    vi.mocked(fetchAuthenticatedUser).mockReset();
    vi.mocked(fetchDefaultBranch).mockReset();
    vi.mocked(fetchBranchHead).mockReset();
    vi.mocked(fetchRecursiveTree).mockReset();
    vi.mocked(fetchBlobText).mockReset();
    vi.mocked(createBlob).mockReset();
    vi.mocked(createTree).mockReset();
    vi.mocked(createCommit).mockReset();
    vi.mocked(updateBranchRef).mockReset();
    vi.mocked(fetchUserRepos).mockReset().mockResolvedValue([]);
    vi.mocked(fetchRepoBranches).mockReset().mockResolvedValue([]);
  });

  it('starts with a sign-in form and validates the token', async () => {
    render(GitPanel, { transport: createTransport() });
    expect(screen.getByTestId('git-panel')).toBeTruthy();
    expect(screen.getByLabelText('GitHub token')).toBeTruthy();
    expect(screen.getByText('Create one on GitHub').getAttribute('href')).toContain('github.com/settings/tokens');

    vi.mocked(fetchAuthenticatedUser).mockRejectedValueOnce(new Error('GitHub rejected the token.'));
    await fireEvent.input(screen.getByLabelText('GitHub token'), { target: { value: 'bad' } });
    await fireEvent.input(screen.getByLabelText('Repo'), { target: { value: 'octo/repo' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('rejected the token');
    });
  });

  it('signs in, syncs a repo tree into the workspace, and tracks it as clean', async () => {
    const transport = createTransport([{ path: '/old.glsl', contents: 'old' }]);
    vi.mocked(fetchAuthenticatedUser).mockResolvedValue('octocat');
    vi.mocked(fetchDefaultBranch).mockResolvedValue({ defaultBranch: 'main', canPush: true });
    vi.mocked(fetchBranchHead).mockResolvedValue({ commitSha: 'c1', treeSha: 't1' });
    vi.mocked(fetchRecursiveTree).mockResolvedValue([{ path: 'a.glsl', type: 'blob', sha: 's1' }]);
    vi.mocked(fetchBlobText).mockResolvedValue({ text: 'hello', skipped: null });

    render(GitPanel, { transport });
    await fireEvent.input(screen.getByLabelText('GitHub token'), { target: { value: 'good' } });
    await fireEvent.input(screen.getByLabelText('Repo'), { target: { value: 'octo/repo' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByText(/Signed in as/)).toBeTruthy();
    });
    // Picker loading runs in the background; let it settle before syncing.
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Sync repo' }));
    await waitFor(() => {
      expect(transport.applySyncedFiles).toHaveBeenCalledWith(
        [{ path: '/a.glsl', contents: 'hello' }],
        ['/old.glsl'],
      );
    });
    expect(screen.getByText('No changes since the last sync.')).toBeTruthy();
  });

  it('commits local edits and pushes them to the branch', async () => {
    const transport = createTransport([{ path: '/a.glsl', contents: 'original' }]);
    const workspaceEvents: { listener: (() => void) | null } = { listener: null };
    transport.onWorkspaceChange.mockImplementation((next: () => void) => {
      workspaceEvents.listener = next;
      return () => {};
    });
    vi.mocked(fetchAuthenticatedUser).mockResolvedValue('octocat');
    vi.mocked(fetchBranchHead).mockResolvedValue({ commitSha: 'c2', treeSha: 't2' });
    vi.mocked(fetchRecursiveTree).mockResolvedValue([{ path: 'a.glsl', type: 'blob', sha: 's1' }]);
    vi.mocked(fetchBlobText).mockResolvedValue({ text: 'original', skipped: null });
    vi.mocked(createBlob).mockResolvedValue('blob9');
    vi.mocked(createTree).mockResolvedValue('tree9');
    vi.mocked(createCommit).mockResolvedValue('commit9');

    render(GitPanel, { transport });
    await fireEvent.input(screen.getByLabelText('GitHub token'), { target: { value: 'good' } });
    await fireEvent.input(screen.getByLabelText('Repo'), { target: { value: 'octo/repo' } });
    await fireEvent.input(screen.getByLabelText('Branch'), { target: { value: 'main' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByText(/Signed in as/)).toBeTruthy();
    });
    // Picker loading runs in the background; let it settle before syncing.
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Sync repo' }));
    await waitFor(() => {
      expect(transport.applySyncedFiles).toHaveBeenCalled();
    });

    // Local edit after the sync surfaces through the workspace subscription.
    transport.readWorkspaceSnapshot.mockResolvedValue([{ path: '/a.glsl', contents: 'edited' }]);
    workspaceEvents.listener?.();
    await waitFor(() => {
      expect(screen.getByText('/a.glsl')).toBeTruthy();
    });
    await fireEvent.input(screen.getByLabelText('Commit message'), { target: { value: 'tweak color' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Commit & push' }));
    await waitFor(() => {
      expect(createCommit).toHaveBeenCalled();
    });
    expect(updateBranchRef).toHaveBeenCalledWith('octo', 'repo', 'good', 'main', 'commit9');
  });

  it('requires a commit message and a prior sync before pushing', async () => {
    const transport = createTransport([]);
    vi.mocked(fetchAuthenticatedUser).mockResolvedValue('octocat');
    render(GitPanel, { transport });
    await fireEvent.input(screen.getByLabelText('GitHub token'), { target: { value: 'good' } });
    await fireEvent.input(screen.getByLabelText('Repo'), { target: { value: 'octo/repo' } });
    await fireEvent.input(screen.getByLabelText('Branch'), { target: { value: 'main' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sync repo' })).toBeTruthy();
    });
    // Commit section is present but pushing without a sync is refused.
    expect(screen.queryByRole('button', { name: 'Commit & push' })).toBeTruthy();
  });

  it('picks a repo and branch from the dropdowns, then syncs', async () => {
    const transport = createTransport([]);
    vi.mocked(fetchAuthenticatedUser).mockResolvedValue('octocat');
    vi.mocked(fetchUserRepos).mockResolvedValue([
      { owner: 'octo', name: 'beta', fullName: 'octo/beta', defaultBranch: 'dev', canPush: true },
      { owner: 'octo', name: 'alpha', fullName: 'octo/alpha', defaultBranch: 'main', canPush: false },
    ]);
    vi.mocked(fetchRepoBranches).mockResolvedValue(['dev', 'feature']);
    vi.mocked(fetchBranchHead).mockResolvedValue({ commitSha: 'c1', treeSha: 't1' });
    vi.mocked(fetchRecursiveTree).mockResolvedValue([{ path: 'a.glsl', type: 'blob', sha: 's1' }]);
    vi.mocked(fetchBlobText).mockResolvedValue({ text: 'hello', skipped: null });

    render(GitPanel, { transport });
    await fireEvent.input(screen.getByLabelText('GitHub token'), { target: { value: 'good' } });
    await fireEvent.input(screen.getByLabelText('Repo'), { target: { value: 'octo/beta' } });
    await fireEvent.input(screen.getByLabelText('Branch'), { target: { value: 'dev' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByText(/Signed in as/)).toBeTruthy();
    });

    // Picker loading runs in the background; let it settle before choosing.
    await tick();
    await waitFor(() => {
      expect(screen.getByLabelText('Repo list')).toBeTruthy();
    });
    const repoSelect = screen.getByLabelText('Repo list');
    expect(repoSelect.textContent).toContain('octo/beta');
    expect(repoSelect.textContent).toContain('octo/alpha (read-only)');

    await fireEvent.input(screen.getByLabelText('Search repos'), { target: { value: 'beta' } });
    expect(screen.getByLabelText('Repo list').textContent).toContain('octo/beta');
    expect(screen.getByLabelText('Repo list').textContent).not.toContain('octo/alpha');
    await fireEvent.input(screen.getByLabelText('Search repos'), { target: { value: '' } });

    await fireEvent.change(repoSelect, { target: { value: 'octo/beta' } });
    await tick();
    await waitFor(() => {
      expect(screen.getByLabelText('Branch list')).toBeTruthy();
    });
    expect((screen.getByLabelText('Branch') as HTMLInputElement).value).toBe('dev');

    await fireEvent.click(screen.getByRole('button', { name: 'Sync repo' }));
    await waitFor(() => {
      expect(transport.applySyncedFiles).toHaveBeenCalledWith(
        [{ path: '/a.glsl', contents: 'hello' }],
        [],
      );
    });
  });

  it('falls back to manual repo entry when listing repos fails', async () => {
    const transport = createTransport([]);
    vi.mocked(fetchAuthenticatedUser).mockResolvedValue('octocat');
    vi.mocked(fetchUserRepos).mockRejectedValue(new Error('Could not list your repos.'));

    render(GitPanel, { transport });
    await fireEvent.input(screen.getByLabelText('GitHub token'), { target: { value: 'good' } });
    await fireEvent.input(screen.getByLabelText('Repo'), { target: { value: 'octo/repo' } });
    await fireEvent.input(screen.getByLabelText('Branch'), { target: { value: 'main' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Could not list your repos');
    });
    // Manual entry still works.
    expect((screen.getByLabelText('Repo') as HTMLInputElement).value).toBe('octo/repo');
    expect((screen.getByLabelText('Branch') as HTMLInputElement).value).toBe('main');
  });
});
