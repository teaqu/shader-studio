<svelte:options runes={true} />
<script lang="ts">
  import { onMount } from 'svelte';
  import { configPathForShader, shaderLanguageForPath } from '@shader-studio/types';
  import type { FileExplorerHost } from './FileExplorerHost';
  import { workspaceTree, normalizeFilePath } from './fileTree';
  import type { WorkspaceFileEntry, WorkspaceTreeEntry } from './FileExplorerHost';
  import { archiveDownload } from './archiveDownload';

  interface Props { transport: FileExplorerHost; onOpen: (path: string) => void; onPathsRemoved: (paths: string[]) => void }
  let { transport, onOpen, onPathsRemoved }: Props = $props();
  let files = $state<WorkspaceFileEntry[]>([]);
  let filter = $state('');
  let collapsed = $state(new Set<string>());
  let selected = $state('');
  let selection = $state(new Set<string>());
  let selectionAnchor = '';
  let error = $state('');
  let pending = $state(false);
  let edit = $state<'new' | 'folder' | 'rename' | null>(null);
  let editPath = $state('');
  let context = $state<{ x: number; y: number } | null>(null);
  let preview = $state<{ path: string; contents: string } | null>(null);
  let dropTarget = $state<string | null>(null);
  let status = $state('');
  const FILE_DRAG_TYPE = 'application/x-shader-studio-path';
  const FILES_DRAG_TYPE = 'application/x-shader-studio-paths';
  let treeElement: HTMLElement;
  let editInput = $state<HTMLInputElement>();
  let uploadInput: HTMLInputElement;
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
    selection = new Set([...selection].filter(path => next.some(file => file.path === path || file.path.startsWith(`${path}/`))));
    if (preview && !next.some(file => file.path === preview?.path)) {
      preview = null;
    }
  }));

  function folder(): string {
    return entry?.directory ? entry.path : selected.slice(0, selected.lastIndexOf('/')) || '/';
  }

  function toggle(path: string) {
    const next = new Set(collapsed);
    if (!next.delete(path)) {
      next.add(path);
    }
    collapsed = next;
  }

  function selectPath(path: string, modifiers?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    if (modifiers?.shiftKey && selectionAnchor) {
      const end = rows.findIndex(row => row.path === path);
      const anchor = Math.max(0, rows.findIndex(row => row.path === selectionAnchor));
      selection = new Set(rows.slice(Math.min(anchor, end), Math.max(anchor, end) + 1).map(row => row.path));
    } else if (modifiers?.ctrlKey || modifiers?.metaKey) {
      const next = new Set(selection);
      if (!next.delete(path)) {
        next.add(path);
      }
      selection = next;
      selectionAnchor = path;
    } else {
      selection = new Set([path]);
      selectionAnchor = path;
    }
    selected = path;
  }

  function selectionRoots(): string[] {
    const paths = [...selection];
    return paths.filter(path => !paths.some(other => other !== path && (path.startsWith(`${other}/`)
      || (shaderLanguageForPath(other) && configPathForShader(other) === path))));
  }

  async function activate(row: WorkspaceTreeEntry, event?: MouseEvent) {
    if (pending) {
      return;
    }
    selectPath(row.path, event);
    context = null;
    if (event?.ctrlKey || event?.metaKey || event?.shiftKey) {
      return;
    }
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
    status = '';
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

  function beginEdit(mode: 'new' | 'folder' | 'rename') {
    edit = mode;
    editPath = mode === 'rename' ? selected : `${folder() === '/' ? '' : folder()}/${mode === 'folder' ? 'new-folder' : 'untitled.glsl'}`;
    context = null;
  }

  function affectedPaths(path = selected): string[] {
    return files.filter(file => file.path === path || file.path.startsWith(`${path}/`)
      || (!files.find(file => file.path === path)?.directory && shaderLanguageForPath(path) && file.path === configPathForShader(path))).map(file => file.path);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    await action(async () => {
      const path = normalizeFilePath(editPath.trim());
      if (edit === 'rename') {
        const paths = affectedPaths();
        await transport.flush();
        await transport.renameWorkspacePath(selected, path);
        onPathsRemoved(paths);
      } else if (edit === 'folder') {
        await transport.createWorkspaceFolder(path);
      } else {
        await transport.createWorkspaceFile(path);
        onOpen(path);
      }
      selected = path;
      selection = new Set([path]);
      edit = null;
    });
  }

  async function remove() {
    context = null;
    if (!selection.size || !window.confirm(selection.size > 1 ? `Delete ${selection.size} selected items and their contents? This cannot be undone.` : `Delete "${entry?.name}"${entry?.directory ? ' and everything inside it' : shaderLanguageForPath(selected) ? ' and its matching shader config' : ''}? This cannot be undone.`)) {
      return;
    }
    await action(async () => {
      const roots = selectionRoots();
      const paths = [...new Set(roots.flatMap(path => affectedPaths(path)))];
      await transport.flush();
      if (roots.length === 1) {
        await transport.deleteWorkspacePath(roots[0]);
      } else {
        await transport.deleteWorkspacePaths(roots);
      }
      onPathsRemoved(paths);
      selected = '';
      selection = new Set();
      preview = null;
    });
  }

  async function download() {
    await action(async () => {
      await transport.flush();
      if (selection.size > 1 || entry?.directory) {
        const archive = await archiveDownload(files, [...selection], path => transport.readEditorFile(path));
        const url = URL.createObjectURL(new Blob([archive.bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = archive.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
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

  function acceptsDrop(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).some(type => type === 'Files' || type === FILE_DRAG_TYPE);
  }

  async function uploadSelection() {
    const uploads = Array.from(uploadInput.files ?? []);
    if (!uploads.length) {
      return;
    }
    const directory = folder();
    await action(async () => {
      await transport.uploadFiles(uploads, directory);
      status = `Added ${uploads.length} file${uploads.length === 1 ? '' : 's'} to ${directory}.`;
      reveal(directory);
    });
    uploadInput.value = '';
  }

  function dragOver(event: DragEvent, directory = '/') {
    if (!acceptsDrop(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (pending) {
      return;
    }
    dropTarget = directory;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes(FILE_DRAG_TYPE) ? 'move' : 'copy';
    }
  }

  function startDrag(event: DragEvent, path: string) {
    if (pending || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(FILE_DRAG_TYPE, path);
    if (!selection.has(path)) {
      selectPath(path);
    }
    event.dataTransfer.setData(FILES_DRAG_TYPE, JSON.stringify(selectionRoots()));
    event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  }

  function leaveDropTarget(event: DragEvent) {
    if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) {
      dropTarget = null;
    }
  }

  function reveal(directory: string) {
    collapsed = new Set([...collapsed].filter(path => directory !== path && !directory.startsWith(`${path}/`)));
  }

  async function dropFiles(event: DragEvent, directory = '/') {
    if (!acceptsDrop(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dropTarget = null;
    if (pending) {
      return;
    }
    const transfer = event.dataTransfer!;
    const source = transfer.getData(FILE_DRAG_TYPE);
    const uploads = Array.from(transfer.files);
    await action(async () => {
      if (source) {
        const multiple = Array.from(transfer.types).includes(FILES_DRAG_TYPE) ? transfer.getData(FILES_DRAG_TYPE) : '';
        const sources: string[] = multiple ? JSON.parse(multiple) : [source];
        if (!Array.isArray(sources) || sources.some(path => typeof path !== 'string')) {
          throw new Error('Invalid file selection.');
        }
        if (sources.length > 1) {
          const removed = [...new Set(sources.flatMap(path => affectedPaths(path)))];
          await transport.moveWorkspacePaths(sources, directory);
          onPathsRemoved(removed);
          selection = new Set(sources.map(path => `${directory === '/' ? '' : directory}/${path.split('/').pop()}`));
          selected = [...selection][0];
          status = `Moved ${sources.length} items to ${directory}.`;
          reveal(directory);
          return;
        }
        const path = normalizeFilePath(source);
        const destination = `${directory === '/' ? '' : directory}/${path.slice(path.lastIndexOf('/') + 1)}`;
        if (path === destination) {
          return;
        }
        const removed = affectedPaths(path);
        await transport.renameWorkspacePath(path, destination);
        onPathsRemoved(removed);
        selected = destination;
        selection = new Set([destination]);
        status = `Moved to ${directory}.`;
      } else if (uploads.length) {
        await transport.uploadFiles(uploads, directory);
        status = `Added ${uploads.length} file${uploads.length === 1 ? '' : 's'} to ${directory}.`;
      }
      reveal(directory);
    });
  }

  function handleKeys(event: KeyboardEvent) {
    if (pending) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selection = new Set(rows.map(row => row.path));
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
    } else if (event.key === 'F2' && entry && selection.size === 1) {
      beginEdit('rename');
    } else if (event.key === 'Delete' && entry) {
      void remove();
    } else {
      return;
    }
    event.preventDefault();
    if (rows[next]) {
      if (next !== index) {
        selectPath(rows[next].path, event);
      }
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
    if (!selection.has(row.path)) {
      selectPath(row.path);
    } else {
      selected = row.path;
    }
    context = {
      x: Math.min(event.clientX, window.innerWidth - 170),
      y: Math.min(event.clientY, window.innerHeight - 150),
    };
  }

  function contextPortal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<svelte:window onclick={() => context = null} onkeydown={handleWindowKey} />
<section class="workspace-files" class:drop-root={dropTarget === '/'} aria-label="Workspace files"
  ondragover={event => dragOver(event)} ondrop={event => dropFiles(event)}
  ondragleave={leaveDropTarget}>
  <div class="file-toolbar">
    <strong>FILES</strong>
    <button title="Upload Files" aria-label="Upload Files" disabled={pending} onclick={() => uploadInput.click()}><i class="codicon codicon-cloud-upload"></i></button>
    <button title="New File" aria-label="New file" disabled={pending} onclick={() => beginEdit('new')}><i class="codicon codicon-new-file"></i></button>
    <button title="New Folder" aria-label="New folder" disabled={pending} onclick={() => beginEdit('folder')}><i class="codicon codicon-new-folder"></i></button>
  </div>
  <input hidden type="file" multiple aria-label="Upload files" bind:this={uploadInput} onchange={uploadSelection} />
  <input class="file-filter" aria-label="Filter workspace files" placeholder="Filter files…" bind:value={filter} />
  {#if edit}
    <form onsubmit={save} class="file-form">
      <label for="workspace-file-path">{edit === 'rename' ? 'Rename or move path' : edit === 'folder' ? 'New folder path' : 'New file path'}</label>
      <input id="workspace-file-path" bind:this={editInput} bind:value={editPath} autocomplete="off" spellcheck="false" />
      {#if edit === 'rename'}<small>References in other files are not updated.</small>{/if}
      <div><button type="submit" disabled={pending}>Save</button><button type="button" onclick={() => edit = null}>Cancel</button></div>
    </form>
  {/if}
  {#if error}<p role="alert">{error} <button aria-label="Dismiss file warning" title="Close warning" onclick={() => error = ''}>×</button></p>{/if}
  {#if status}<p class="file-status" role="status">{status}</p>{/if}
  <div class="file-tree" role="tree" aria-label="Workspace file tree" aria-multiselectable="true" tabindex="0" bind:this={treeElement} onkeydown={handleKeys}>
    {#each rows as row, index (row.path)}
      <button role="treeitem" aria-level={row.depth + 1} aria-expanded={row.directory ? !collapsed.has(row.path) : undefined}
        aria-selected={selection.has(row.path)} tabindex={selected === row.path || (!selected && index === 0) ? 0 : -1}
        class:selected={selection.has(row.path)} class="file-row" style:padding-left={`${8 + row.depth * 14}px`}
        class:drop-folder={dropTarget === row.path} draggable={!pending}
        ondragstart={event => startDrag(event, row.path)} ondragend={() => dropTarget = null}
        ondragover={event => dragOver(event, row.directory ? row.path : row.path.slice(0, row.path.lastIndexOf('/')) || '/')}
        ondrop={event => dropFiles(event, row.directory ? row.path : row.path.slice(0, row.path.lastIndexOf('/')) || '/')}
        title={row.path} data-path={row.path} onclick={event => activate(row, event)} disabled={pending}
        oncontextmenu={event => showContext(event, row)}>
        <i aria-hidden="true" class="codicon {row.directory ? collapsed.has(row.path) ? 'codicon-chevron-right' : 'codicon-chevron-down' : 'codicon-blank'}"></i>
        <i aria-hidden="true" class="codicon {row.directory ? 'codicon-folder' : files.find(file => file.path === row.path)?.asset ? 'codicon-file-media' : shaderLanguageForPath(row.path) ? 'codicon-code' : 'codicon-file'}"></i>
        <span>{row.name}</span>
      </button>
    {/each}
    {#if !rows.length}<p class="empty">{filter ? 'No matching files.' : 'No files yet. Drop files here or create a new file.'}</p>{/if}
  </div>
  <div class="file-actions">
    <button disabled={selection.size !== 1 || pending} onclick={() => beginEdit('rename')} title="Rename / Move (F2)">Rename</button>
    <button disabled={!selection.size || pending} onclick={remove} title="Delete selected files or folders">Delete</button>
    <button disabled={!selection.size || pending} onclick={download}>Download</button>
  </div>
</section>
{#if context}
  <div use:contextPortal role="menu" aria-label="File actions" class="file-context" style:left={`${context.x}px`} style:top={`${context.y}px`}>
    <button role="menuitem" disabled={selection.size !== 1} onclick={() => beginEdit('rename')}>Rename / Move…</button>
    <button role="menuitem" onclick={remove}>Delete</button>
    <button role="menuitem" onclick={download}>Download</button>
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
  .file-row.selected { color: var(--vscode-list-activeSelectionForeground, #fff); background: var(--vscode-list-activeSelectionBackground, var(--vscode-button-background, #094771)); }
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
  .file-status { margin: 0 8px 6px; font-size: 11px; line-height: 1.4; color: var(--vscode-descriptionForeground); }
  .drop-root { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground)); }
  .file-row.drop-folder { background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground)); outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .file-context { position: fixed; z-index: 20000; display: grid; min-width: 160px; padding: 4px; background: var(--vscode-menu-background, var(--vscode-sideBar-background)); border: 1px solid var(--vscode-panel-border); box-shadow: 0 4px 12px #0005; }
  .file-context button { text-align: left; }
  .preview-overlay { position: fixed; inset: 0; z-index: 20000; background: #0008; display: grid; place-items: center; }
  .asset-preview { max-width: min(800px, 90vw); max-height: 85vh; overflow: auto; padding: 16px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
  .asset-preview header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 12px; }
  .asset-preview img, .asset-preview video { display: block; max-width: 100%; max-height: 60vh; object-fit: contain; background: repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%) 50% / 16px 16px; }
  .asset-preview p { overflow-wrap: anywhere; font-size: 12px; color: var(--vscode-descriptionForeground); }
</style>
