<svelte:options runes={true} />
<script lang="ts">
  import { onMount } from 'svelte';
  import { configPathForShader, shaderLanguageForPath } from '@shader-studio/types';
  import type { WebTransport } from './WebTransport';
  import { workspaceTree, workspaceUserPath, type WorkspaceFileEntry, type WorkspaceTreeEntry } from './workspaceFiles';

  interface Props { transport: WebTransport; onOpen: (path: string) => void; onPathsRemoved: (paths: string[]) => void }
  let { transport, onOpen, onPathsRemoved }: Props = $props();
  let files = $state<WorkspaceFileEntry[]>([]);
  let filter = $state('');
  let collapsed = $state(new Set<string>());
  let selected = $state('');
  let error = $state('');
  let pending = $state(false);
  let edit = $state<'new' | 'rename' | null>(null);
  let editPath = $state('');
  let context = $state<{ x: number; y: number } | null>(null);
  let preview = $state<{ path: string; contents: string } | null>(null);
  let uploadInput: HTMLInputElement;
  let treeElement: HTMLElement;
  let editInput = $state<HTMLInputElement>();
  const rows = $derived(workspaceTree(files, collapsed, filter));
  const entry = $derived(rows.find(row => row.path === selected));
  $effect(() => {
    if (edit && editInput) {
      editInput.focus();
      editInput.select();
    }
  });

  onMount(() => transport.onWorkspaceFiles(next => {
    files = next;
    if (preview && !next.some(file => file.path === preview?.path)) {
      preview = null;
    }
  }));

  function folder(): string {
    return entry?.directory ? entry.path : selected.slice(0, selected.lastIndexOf('/')) || '/shaders';
  }

  function toggle(path: string) {
    const next = new Set(collapsed);
    if (!next.delete(path)) {
      next.add(path);
    }
    collapsed = next;
  }

  async function activate(row: WorkspaceTreeEntry) {
    if (pending) {
      return;
    }
    selected = row.path;
    context = null;
    if (row.directory) {
      toggle(row.path);
    } else if (files.find(file => file.path === row.path)?.asset) {
      await action(async () => {
        const contents = await transport.readEditorFile(row.path);
        if (contents === null) {
          throw new Error('File no longer exists.');
        }
        preview = { path: row.path, contents };
      });
    } else {
      onOpen(row.path);
    }
  }

  async function action(run: () => Promise<void>) {
    if (pending) {
      return;
    }
    error = '';
    pending = true;
    context = null;
    try {
      await run();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Could not complete this action.';
    } finally {
      pending = false;
    }
  }

  function beginEdit(mode: 'new' | 'rename') {
    edit = mode;
    editPath = mode === 'rename' ? selected : `${folder()}/untitled.glsl`;
    context = null;
  }

  function affectedPaths(): string[] {
    return files.filter(file => file.path === selected || file.path.startsWith(`${selected}/`)
      || (shaderLanguageForPath(selected) && file.path === configPathForShader(selected))).map(file => file.path);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    await action(async () => {
      const path = workspaceUserPath(editPath.trim());
      if (edit === 'rename') {
        const paths = affectedPaths();
        await transport.flush();
        await transport.renameWorkspacePath(selected, path);
        onPathsRemoved(paths);
      } else {
        await transport.createWorkspaceFile(path);
        onOpen(path);
      }
      selected = path;
      edit = null;
    });
  }

  async function remove() {
    context = null;
    if (!entry || !window.confirm(`Delete "${entry.name}"${entry.directory ? ' and everything inside it' : shaderLanguageForPath(selected) ? ' and its matching shader config' : ''}? This cannot be undone.`)) {
      return;
    }
    await action(async () => {
      const paths = affectedPaths();
      await transport.flush();
      await transport.deleteWorkspacePath(selected);
      onPathsRemoved(paths);
      selected = '';
      preview = null;
    });
  }

  async function download() {
    await action(async () => {
      const contents = await transport.readEditorFile(selected);
      if (contents === null) {
        throw new Error('File no longer exists.');
      }
      const asset = files.find(file => file.path === selected)?.asset;
      const url = asset ? contents : URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = selected.split('/').pop()!;
      anchor.click();
      if (!asset) {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const selection = Array.from(input.files ?? []);
    input.value = '';
    if (!selection.length) {
      return;
    }
    await action(async () => {
      await transport.uploadFiles(selection, folder());
    });
  }

  function handleKeys(event: KeyboardEvent) {
    if (pending) {
      return;
    }
    const index = rows.findIndex(row => row.path === selected);
    let next = index;
    if (event.key === 'ArrowDown') {
      next = Math.min(rows.length - 1, index + 1);
    } else if (event.key === 'ArrowUp') {
      next = Math.max(0, index - 1);
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = rows.length - 1;
    } else if (event.key === 'ArrowRight' && entry?.directory && collapsed.has(selected)) {
      toggle(selected);
    } else if (event.key === 'ArrowLeft' && entry?.directory && !collapsed.has(selected)) {
      toggle(selected);
    } else if (event.key === 'F2' && entry) {
      beginEdit('rename');
    } else if (event.key === 'Delete' && entry) {
      void remove();
    } else {
      return;
    }
    event.preventDefault();
    if (rows[next]) {
      selected = rows[next].path;
      treeElement.querySelectorAll<HTMLElement>('[role="treeitem"]')[next]?.focus();
    }
  }

  function handleWindowKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      context = null;
      preview = null;
      edit = null;
    }
  }

  function showContext(event: MouseEvent, row: WorkspaceTreeEntry) {
    event.preventDefault();
    selected = row.path;
    context = {
      x: Math.min(event.clientX, window.innerWidth - 170),
      y: Math.min(event.clientY, window.innerHeight - 150),
    };
  }
</script>

<svelte:window onclick={() => context = null} onkeydown={handleWindowKey} />
<section class="workspace-files" aria-label="Workspace files">
  <div class="file-toolbar">
    <strong>EXPLORER</strong>
    <button title="New File" aria-label="New file" disabled={pending} onclick={() => beginEdit('new')}><i class="codicon codicon-new-file"></i></button>
    <button title="Upload Files" aria-label="Upload to folder" disabled={pending} onclick={() => uploadInput.click()}><i class="codicon codicon-cloud-upload"></i></button>
  </div>
  <input type="file" multiple aria-label="Upload to workspace folder" bind:this={uploadInput} onchange={upload} class="hidden-input" />
  <input class="file-filter" aria-label="Filter workspace files" placeholder="Filter files…" bind:value={filter} />
  {#if edit}
    <form onsubmit={save} class="file-form">
      <label for="workspace-file-path">{edit === 'rename' ? 'Rename or move path' : 'New file path'}</label>
      <input id="workspace-file-path" bind:this={editInput} bind:value={editPath} autocomplete="off" spellcheck="false" />
      {#if edit === 'rename'}<small>References in other files are not updated.</small>{/if}
      <div><button type="submit" disabled={pending}>Save</button><button type="button" onclick={() => edit = null}>Cancel</button></div>
    </form>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="file-tree" role="tree" aria-label="Workspace file tree" tabindex="0" bind:this={treeElement} onkeydown={handleKeys}>
    {#each rows as row, index (row.path)}
      <button role="treeitem" aria-level={row.depth + 1} aria-expanded={row.directory ? !collapsed.has(row.path) : undefined}
        aria-selected={selected === row.path} tabindex={selected === row.path || (!selected && index === 0) ? 0 : -1}
        class:selected={selected === row.path} class="file-row" style:padding-left={`${8 + row.depth * 14}px`}
        title={row.path} data-path={row.path} onclick={() => activate(row)} disabled={pending}
        oncontextmenu={event => showContext(event, row)}>
        <i aria-hidden="true" class="codicon {row.directory ? collapsed.has(row.path) ? 'codicon-chevron-right' : 'codicon-chevron-down' : 'codicon-blank'}"></i>
        <i aria-hidden="true" class="codicon {row.directory ? 'codicon-folder' : files.find(file => file.path === row.path)?.asset ? 'codicon-file-media' : shaderLanguageForPath(row.path) ? 'codicon-code' : 'codicon-file'}"></i>
        <span>{row.name}</span>
      </button>
    {/each}
    {#if !rows.length}<p class="empty">{filter ? 'No matching files.' : 'No files yet. Upload files or create a new file.'}</p>{/if}
  </div>
  <div class="file-actions">
    <button disabled={!entry || pending} onclick={() => beginEdit('rename')} title="Rename / Move (F2)">Rename</button>
    <button disabled={!entry || pending} onclick={remove} title="Delete selected file or folder">Delete</button>
    <button disabled={!entry || entry.directory || pending} onclick={download}>Download</button>
  </div>
</section>
{#if context}
  <div role="menu" aria-label="File actions" class="file-context" style:left={`${context.x}px`} style:top={`${context.y}px`}>
    <button role="menuitem" onclick={() => beginEdit('rename')}>Rename / Move…</button>
    <button role="menuitem" onclick={remove}>Delete</button>
    {#if !entry?.directory}<button role="menuitem" onclick={download}>Download</button>{/if}
  </div>
{/if}
{#if preview}
  <div class="preview-overlay" role="presentation">
    <div role="dialog" aria-modal="true" aria-label="Asset preview" tabindex="-1" class="asset-preview">
      <header><strong>{preview.path.split('/').pop()}</strong><button onclick={() => preview = null} aria-label="Close asset preview">×</button></header>
      {#if /^data:image\//.test(preview.contents)}<img src={preview.contents} alt={preview.path.split('/').pop()} />
      {:else if /^data:video\//.test(preview.contents)}<video src={preview.contents} controls><track kind="captions" /></video>
      {:else if /^data:audio\//.test(preview.contents)}<audio src={preview.contents} controls></audio>
      {:else}<p>Preview is unavailable for this file type. Use the matching channel picker to load it.</p>{/if}
      <p>{preview.path}</p><button onclick={download}>Download</button>
    </div>
  </div>
{/if}

<style>
  .workspace-files { height: 100%; display: flex; flex-direction: column; min-height: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-size: 12px; }
  .file-toolbar { display: flex; align-items: center; padding: 7px 8px; gap: 4px; }
  .file-toolbar strong { flex: 1; font-size: 11px; font-weight: 500; letter-spacing: 1px; }
  button, input { color: inherit; font: inherit; }
  button { cursor: pointer; border: 0; background: transparent; border-radius: 3px; padding: 4px 6px; }
  button:hover { background: var(--vscode-list-hoverBackground); }
  button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  button:disabled { opacity: .45; cursor: default; }
  .file-filter, .file-form input { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; padding: 5px; min-width: 0; }
  .file-filter { margin: 0 8px 6px; }
  .file-tree { flex: 1; min-height: 0; overflow: auto; padding-bottom: 6px; }
  .file-row { display: flex; align-items: center; gap: 5px; width: 100%; text-align: left; height: 26px; white-space: nowrap; border-radius: 0; }
  .file-row span { overflow: hidden; text-overflow: ellipsis; }
  .file-row.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
  .file-row .codicon { flex-shrink: 0; font-size: 14px; }
  .file-row .codicon-code { color: #d7ba7d; }
  .file-row .codicon-file-media { color: #b4a1db; }
  .file-row .codicon-folder { color: #c3a16c; }
  .file-actions { display: flex; gap: 2px; padding: 6px; border-top: 1px solid var(--vscode-panel-border); }
  .file-form { display: grid; gap: 6px; margin: 0 8px 8px; }
  .file-form small { color: var(--vscode-descriptionForeground); }
  .file-form button { border: 1px solid var(--vscode-panel-border); margin-right: 6px; }
  [role="alert"], .empty { margin: 8px; overflow-wrap: anywhere; }
  [role="alert"] { color: var(--vscode-errorForeground); }
  .hidden-input { display: none; }
  .file-context { position: fixed; z-index: 20000; display: grid; min-width: 160px; padding: 4px; background: var(--vscode-menu-background, var(--vscode-sideBar-background)); border: 1px solid var(--vscode-panel-border); box-shadow: 0 4px 12px #0005; }
  .file-context button { text-align: left; }
  .preview-overlay { position: fixed; inset: 0; z-index: 20000; background: #0008; display: grid; place-items: center; }
  .asset-preview { max-width: min(800px, 90vw); max-height: 85vh; overflow: auto; padding: 16px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
  .asset-preview header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 12px; }
  .asset-preview img, .asset-preview video { display: block; max-width: 100%; max-height: 60vh; object-fit: contain; background: repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%) 50% / 16px 16px; }
  .asset-preview p { overflow-wrap: anywhere; font-size: 12px; color: var(--vscode-descriptionForeground); }
</style>
