<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { WebTransport } from './WebTransport';
  import {
    createBlob,
    createCommit,
    createTree,
    encodeTextBase64,
    fetchAuthenticatedUser,
    fetchBlobText,
    fetchBranchHead,
    fetchDefaultBranch,
    fetchRecursiveTree,
    fetchRepoBranches,
    fetchUserRepos,
    parseRepoReference,
    updateBranchRef,
    type GitHubRepo,
  } from './git/github';
  import { diffSnapshots, isTrackedPath, snapshotTrackedFiles, toRepoPath } from './git/gitSync';
  import {
    getGitBase,
    getGitBranch,
    getGitError,
    getGitLastSyncAt,
    getGitLogin,
    getGitOwner,
    getGitPhase,
    getGitRepo,
    getGitRepoInput,
    getGitStatus,
    getGitToken,
    isGitBusy,
    resetGitState,
    setGitBase,
    setGitBusy,
    setGitError,
    setGitLastSyncAt,
    setGitRepo,
    setGitStatus,
    setGitToken,
  } from './state/gitState.svelte';

  interface Props {
    transport?: WebTransport;
  }

  let { transport }: Props = $props();

  /** Classic token page with the repo scope preselected; fine-grained tokens work too. */
  const TOKEN_CREATION_URL =
    'https://github.com/settings/tokens/new?scopes=repo&description=shader-studio-standalone';

  let tokenInput = $state(getGitToken());
  let repoInput = $state(getGitRepoInput());
  let branchInput = $state(getGitBranch());
  let commitMessage = $state('');
  let notice = $state('');
  let cleanup: (() => void) | null = null;
  let repos = $state<GitHubRepo[]>([]);
  let reposLoading = $state(false);
  let repoFilter = $state('');
  let branches = $state<string[]>([]);
  let branchesLoading = $state(false);

  const phase = $derived(getGitPhase());
  const status = $derived(getGitStatus());
  const busy = $derived(isGitBusy());
  const error = $derived(getGitError());
  const login = $derived(getGitLogin());
  const lastSyncAt = $derived(getGitLastSyncAt());
  const changeCount = $derived(status.added.length + status.modified.length + status.deleted.length);
  const filterText = $derived(repoFilter.trim().toLowerCase());
  const filteredRepos = $derived(filterText
    ? repos.filter((entry) => entry.fullName.toLowerCase().includes(filterText))
    : repos);

  async function refreshStatus(): Promise<void> {
    if (!transport || phase === 'signed-out') {
      return;
    }
    try {
      const snapshot = await transport.readWorkspaceSnapshot();
      const current = snapshotTrackedFiles(snapshot);
      const diff = diffSnapshots(getGitBase().files, current);
      setGitStatus({ ...diff, skipped: getGitStatus().skipped });
    } catch {
      // Status is best-effort; the panel keeps the last known diff.
    }
  }

  async function runTask(task: () => Promise<void>): Promise<void> {
    if (isGitBusy()) {
      return;
    }
    setGitBusy(true);
    setGitError('');
    notice = '';
    try {
      await task();
    } catch (unknown) {
      setGitError(unknown instanceof Error ? unknown.message : 'Git operation failed.');
    } finally {
      setGitBusy(false);
    }
  }

  async function signIn(): Promise<void> {
    await runTask(async () => {
      const user = await fetchAuthenticatedUser(tokenInput.trim());
      setGitToken(tokenInput.trim(), user);
      const { owner, repo } = parseRepoReference(repoInput);
      let branch = branchInput.trim();
      if (!branch) {
        branch = (await fetchDefaultBranch(owner, repo, tokenInput.trim())).defaultBranch;
        branchInput = branch;
      }
      setGitRepo(owner, repo, branch);
      await refreshStatus();
      notice = `Signed in as ${user}.`;
      // Picker loading must not gate the sign-in task: it only fills the
      // repo/branch dropdowns and reports its own errors.
      void loadRepos();
    });
  }

  async function loadRepos(): Promise<void> {
    const token = getGitToken();
    if (!token) {
      return;
    }
    reposLoading = true;
    try {
      const fetched = await fetchUserRepos(token);
      const combined = [...fetched];
      const storedOwner = getGitOwner();
      const storedRepo = getGitRepo();
      if (storedRepo && !combined.some((entry) => entry.fullName.toLowerCase() === `${storedOwner}/${storedRepo}`.toLowerCase())) {
        combined.unshift({
          owner: storedOwner,
          name: storedRepo,
          fullName: `${storedOwner}/${storedRepo}`,
          defaultBranch: getGitBranch() || 'main',
          canPush: true,
        });
      }
      repos = combined;
      if (!repoInput.trim() && storedRepo) {
        repoInput = `${storedOwner}/${storedRepo}`;
      }
      await loadBranches();
    } catch (unknown) {
      setGitError(unknown instanceof Error ? unknown.message : 'Could not list your repos. Type owner/name manually.');
    } finally {
      reposLoading = false;
    }
  }

  async function loadBranches(): Promise<void> {
    branches = [];
    const reference = repoInput.trim() || `${getGitOwner()}/${getGitRepo()}`;
    if (!reference || reference === '/') {
      return;
    }
    let owner = '';
    let repo = '';
    try {
      ({ owner, repo } = parseRepoReference(reference));
    } catch {
      return;
    }
    branchesLoading = true;
    try {
      const names = await fetchRepoBranches(owner, repo, getGitToken());
      branches = [...names];
      if (names.length === 0) {
        return;
      }
      const current = branchInput.trim() || getGitBranch();
      if (!current || !names.includes(current)) {
        const entry = repos.find(
          (candidate) => candidate.fullName.toLowerCase() === `${owner}/${repo}`.toLowerCase(),
        );
        branchInput = entry?.defaultBranch && names.includes(entry.defaultBranch)
          ? entry.defaultBranch
          : (names[0] ?? current);
      }
    } catch {
      // Branch listing is a convenience; the branch text field still works.
    } finally {
      branchesLoading = false;
    }
  }

  function chooseRepo(fullName: string): void {
    if (!fullName) {
      return;
    }
    repoInput = fullName;
    try {
      const { owner, repo } = parseRepoReference(fullName);
      const entry = repos.find(
        (candidate) => candidate.fullName.toLowerCase() === fullName.toLowerCase(),
      );
      const branch = branchInput.trim() || entry?.defaultBranch || getGitBranch();
      setGitRepo(owner, repo, branch);
      if (entry?.defaultBranch && !branchInput.trim()) {
        branchInput = entry.defaultBranch;
      }
    } catch {
      // Manual entries validate when syncing.
    }
    void loadBranches();
  }

  function chooseBranch(name: string): void {
    if (!name) {
      return;
    }
    branchInput = name;
    if (getGitOwner() && getGitRepo()) {
      setGitRepo(getGitOwner(), getGitRepo(), name);
    }
  }

  async function syncRepo(): Promise<void> {
    await runTask(async () => {
      if (!transport) {
        throw new Error('Workspace is not connected yet.');
      }
      const reference = repoInput.trim() || `${getGitOwner()}/${getGitRepo()}`;
      const { owner, repo } = parseRepoReference(reference);
      const branch = branchInput.trim() || getGitBranch();
      if (!branch) {
        throw new Error('Enter a branch name to sync.');
      }
      const token = getGitToken();
      if (!token) {
        throw new Error('Sign in with a GitHub token first.');
      }
      if (phase === 'synced' && !status.clean
        && !window.confirm('Syncing replaces local files with the remote branch. Uncommitted changes will be lost. Continue?')) {
        return;
      }
      const head = await fetchBranchHead(owner, repo, branch, token);
      const entries = (await fetchRecursiveTree(owner, repo, head.treeSha, token))
        .filter((entry) => entry.type === 'blob');
      const writes: { path: string; contents: string }[] = [];
      const skipped: { path: string; reason: 'binary' | 'too-large' }[] = [];
      const queue = [...entries];
      async function worker(): Promise<void> {
        while (queue.length > 0) {
          const entry = queue.pop();
          if (!entry) {
            return;
          }
          const fetched = await fetchBlobText(owner, repo, entry.sha, token);
          if (fetched.text !== null) {
            writes.push({ path: `/${entry.path}`, contents: fetched.text });
          } else if (fetched.skipped) {
            skipped.push({ path: `/${entry.path}`, reason: fetched.skipped });
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, Math.max(1, entries.length)) }, () => worker()));
      const remotePaths = new Set(entries.map((entry) => `/${entry.path}`));
      const snapshot = await transport.readWorkspaceSnapshot();
      const removes = snapshot
        .map((file) => file.path)
        .filter((path) => isTrackedPath(path) && !remotePaths.has(path));
      await transport.applySyncedFiles(writes, removes);
      setGitRepo(owner, repo, branch);
      setGitBase(head.commitSha, head.treeSha, new Map(writes.map((file) => [file.path, file.contents])));
      setGitLastSyncAt(new Date().toLocaleString());
      setGitStatus({ added: [], modified: [], deleted: [], clean: true, skipped });
      notice = skipped.length > 0
        ? `Synced ${writes.length} files. Skipped ${skipped.length} binary or large files.`
        : `Synced ${writes.length} files from ${owner}/${repo}@${branch}.`;
    });
  }

  async function commitAndPush(): Promise<void> {
    await runTask(async () => {
      if (!transport) {
        throw new Error('Workspace is not connected yet.');
      }
      const message = commitMessage.trim();
      if (!message) {
        throw new Error('Write a commit message first.');
      }
      const base = getGitBase();
      if (!base.commitSha) {
        throw new Error('Sync a repo first so there is a commit to build on.');
      }
      const token = getGitToken();
      const owner = getGitOwner();
      const repo = getGitRepo();
      const branch = getGitBranch();
      const snapshot = await transport.readWorkspaceSnapshot();
      const current = snapshotTrackedFiles(snapshot);
      const diff = diffSnapshots(base.files, current);
      if (diff.clean) {
        throw new Error('No changes to commit.');
      }
      const oversized = [...diff.added, ...diff.modified]
        .filter((path) => (current.get(path) ?? '').length > 950_000);
      if (oversized.length > 0) {
        throw new Error(`These files are too large for the GitHub API: ${oversized.join(', ')}`);
      }
      const blobShas = new Map<string, string>();
      for (const path of [...diff.added, ...diff.modified]) {
        const contents = current.get(path) ?? '';
        blobShas.set(path, await createBlob(owner, repo, token, encodeTextBase64(contents)));
      }
      const treeEntries = [
        ...[...diff.added, ...diff.modified].map((path) => ({ path: toRepoPath(path), sha: blobShas.get(path) ?? '' })),
        ...diff.deleted.map((path) => ({ path: toRepoPath(path), sha: null })),
      ];
      const treeSha = await createTree(owner, repo, token, base.treeSha, treeEntries);
      const commitSha = await createCommit(owner, repo, token, message, treeSha, [base.commitSha]);
      await updateBranchRef(owner, repo, token, branch, commitSha);
      const head = await fetchBranchHead(owner, repo, branch, token);
      setGitBase(head.commitSha, head.treeSha, current);
      setGitStatus({ added: [], modified: [], deleted: [], clean: true, skipped: getGitStatus().skipped });
      commitMessage = '';
      notice = `Pushed ${changeCount === 1 ? '1 change' : `${changeCount} changes`} to ${owner}/${repo}@${branch}.`;
    });
  }

  function signOut(): void {
    resetGitState();
    tokenInput = '';
    notice = '';
    repos = [];
    branches = [];
    repoFilter = '';
  }

  onMount(() => {
    if (getGitToken()) {
      void fetchAuthenticatedUser(getGitToken())
        .then((user) => {
          if (getGitToken()) {
            setGitToken(getGitToken(), user);
          }
        })
        .catch(() => {
          // A stored token may have expired; the user can sign in again.
        });
      void loadRepos();
    }
    void refreshStatus();
    if (transport) {
      cleanup = transport.onWorkspaceChange(() => {
        void refreshStatus();
      });
    }
  });

  onDestroy(() => {
    cleanup?.();
    cleanup = null;
  });
</script>

<div class="git-panel" data-testid="git-panel">
  <div class="git-section">
    <strong>GitHub</strong>
    {#if phase === 'signed-out'}
      <label>Token
        <input type="password" autocomplete="off" spellcheck={false} placeholder="ghp_…" bind:value={tokenInput} disabled={busy} aria-label="GitHub token" />
      </label>
      <p class="hint">Paste a personal access token (it stays in this tab only).
        <a href={TOKEN_CREATION_URL} target="_blank" rel="noreferrer">Create one on GitHub</a>
        with the repo scope already selected, then Generate.</p>
    {:else}
      <p class="signed-in">Signed in{#if login} as <strong>{login}</strong>{/if}</p>
    {/if}
    {#if repos.length > 0}
        <label>Search repos
          <input spellcheck={false} placeholder="Filter your repos…" bind:value={repoFilter} disabled={busy} aria-label="Search repos" />
        </label>
        <label>Choose repo
          <select value={repoInput} onchange={(event) => chooseRepo(event.currentTarget.value)} disabled={busy} aria-label="Repo list">
            <option value="">Select a repo…</option>
            {#each filteredRepos as entry (entry.fullName)}
              <option value={entry.fullName}>{entry.fullName}{entry.canPush ? '' : ' (read-only)'}</option>
            {/each}
          </select>
        </label>
      {:else if reposLoading}
        <p class="hint" role="status">Loading your repos…</p>
      {/if}
      <label>Repo
        <input spellcheck={false} placeholder="owner/name" bind:value={repoInput} disabled={busy} aria-label="Repo" />
      </label>
      {#if branches.length > 0}
        <label>Choose branch
          <select value={branchInput} onchange={(event) => chooseBranch(event.currentTarget.value)} disabled={busy} aria-label="Branch list">
            {#each branches as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
        </label>
      {:else if branchesLoading}
        <p class="hint" role="status">Loading branches…</p>
      {/if}
      <label>Branch
        <input spellcheck={false} placeholder="main" bind:value={branchInput} disabled={busy} aria-label="Branch" />
      </label>
    <div class="row">
      {#if phase === 'signed-out'}
        <button type="button" disabled={busy || !tokenInput.trim() || !repoInput.trim()} onclick={signIn}>Sign in</button>
      {:else}
        <button type="button" disabled={busy} onclick={syncRepo}>Sync repo</button>
        <button type="button" class="ghost" disabled={busy} onclick={signOut}>Sign out</button>
      {/if}
    </div>
    {#if lastSyncAt}<p class="hint">Last sync: {lastSyncAt}</p>{/if}
  </div>

  {#if phase !== 'signed-out'}
    <div class="git-section">
      <strong>Changes{#if !status.clean} ({changeCount}){/if}</strong>
      {#if status.clean}
        <p class="hint">No changes since the last sync.</p>
      {:else}
        <ul class="change-list">
          {#each status.modified as path (path)}<li><span class="badge modified">M</span>{path}</li>{/each}
          {#each status.added as path (path)}<li><span class="badge added">A</span>{path}</li>{/each}
          {#each status.deleted as path (path)}<li><span class="badge deleted">D</span>{path}</li>{/each}
        </ul>
      {/if}
      {#if status.skipped.length > 0}
        <p class="hint">Skipped on sync: {status.skipped.map((entry) => entry.path).join(', ')}</p>
      {/if}
      <label>Commit message
        <input spellcheck={false} placeholder="Describe the change" bind:value={commitMessage} disabled={busy} aria-label="Commit message" />
      </label>
      <button type="button" disabled={busy || status.clean || !commitMessage.trim()} onclick={commitAndPush}>
        Commit &amp; push
      </button>
    </div>
  {/if}

  {#if busy}<p role="status">Working…</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</div>

<style>
  .git-panel { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; overflow-y: auto; padding: 10px; box-sizing: border-box; }
  .git-section { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .git-section:last-child { border-bottom: 0; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  input { font: inherit; padding: 5px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
  button { font: inherit; padding: 5px 10px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-background, transparent); color: inherit; cursor: pointer; align-self: flex-start; }
  button:disabled { opacity: 0.5; cursor: default; }
  button.ghost { background: transparent; }
  .row { display: flex; gap: 8px; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 0; }
  .signed-in { font-size: 12px; margin: 0; }
  .notice { font-size: 12px; color: var(--vscode-foreground); }
  .change-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .change-list li { display: flex; gap: 6px; align-items: baseline; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { display: inline-block; width: 16px; text-align: center; border-radius: 3px; font-size: 11px; font-weight: bold; }
  .badge.modified { background: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); color: #000; }
  .badge.added { background: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); color: #000; }
  .badge.deleted { background: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); color: #fff; }
</style>
