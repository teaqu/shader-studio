<script lang="ts">
  import type { MessageEvent as ShaderMessage } from "@shader-studio/types";
  import { getDefaultAuthoringMode } from '../../state/authoringModeState.svelte';
  import { onMount, onDestroy, untrack } from 'svelte';

  import type { FileDialogFileType } from '@shader-studio/types';

  interface Props {
    value: string;
    label?: string;
    inputId?: string;
    placeholder?: string;
    onPathChange?: (path: string) => void;
    fileExists?: boolean;
    hasError?: boolean;
    note?: string;
    shaderPath?: string;
    suggestedPath?: string;
    fileType?: FileDialogFileType;
    allowCreate?: boolean;
    allowSelect?: boolean;
    selectLabel?: string;
    createLabel?: string;
    allowInsert?: boolean;
    showSelectWhenHidden?: boolean;
    insertLabel?: string;
    hidePath?: boolean;
    fragmentInsertMenu?: boolean;
    onClear?: () => void;
    existingModes?: ('hooks' | 'native')[];
    clearEnabled?: boolean;
    sourcePath?: string;
    builtInSourcePath?: string;
    vertexSpace?: string;
    authoringMode?: 'hooks' | 'native';
    createAuthoringMode?: 'hooks' | 'native';
    passName?: string;
    geometryType?: string;
    outputCount?: number;
    outputKind?: '2d' | 'cubemap';
    onCreated?: (result: {
      path: string;
      entryPoints?: { vertex?: string; fragment?: string; compute?: string };
      entryPoint?: string;
      authoringMode?: 'hooks' | 'native';
    }) => void;
    postMessage?: (msg: ShaderMessage) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
  }

  let {
    value,
    label = 'Path:',
    inputId = 'path-input',
    placeholder = '',
    onPathChange = undefined,
    fileExists = true,
    hasError = false,
    note = undefined,
    shaderPath = '',
    suggestedPath = '',
    fileType = 'glsl-buffer',
    allowCreate = true,
    allowSelect = true,
    selectLabel = 'Select',
    createLabel = 'Create',
    allowInsert = false,
    showSelectWhenHidden = false,
    insertLabel = 'Insert',
    hidePath = false,
    fragmentInsertMenu = false,
    onClear = undefined,
    existingModes = [],
    clearEnabled = !!value,
    sourcePath = undefined,
    builtInSourcePath = undefined,
    vertexSpace = undefined,
    authoringMode = undefined,
    createAuthoringMode = undefined,
    passName = undefined,
    geometryType = undefined,
    outputCount = undefined,
    outputKind = undefined,
    onCreated = undefined,
    postMessage = undefined,
    onMessage = undefined,
  }: Props = $props();

  let selectedMode = $state<'hooks' | 'native' | null>(null);
  const supportsNative = $derived(fileType.startsWith('wgsl-') || fileType.startsWith('slang-'));
  const effectiveMode = $derived(supportsNative ? fileType.endsWith('-compute') ? 'native' : selectedMode ?? authoringMode ?? getDefaultAuthoringMode() : 'hooks');
  let pathInputFocused = $state(false);
  let localPath = $state(untrack(() => value));
  $effect(() => {
    const v = value; // force track value
    if (!pathInputFocused) {
      localPath = v;
    }
  });

  function handlePathInput(e: Event) {
    localPath = (e.target as HTMLInputElement).value;
    // Commit immediately so parent can update fileExists
    onPathChange?.(localPath);
  }

  function handlePathCommit() {
    if (localPath !== value) {
      onPathChange?.(localPath);
    }
  }

  // Suppress the Create button briefly after value changes externally (e.g. after Select),
  // preventing a flash while fileExists hasn't yet been confirmed by the extension.
  let suppressCreate = $state(false);
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  let prevValue = untrack(() => value);

  $effect(() => {
    const v = value;
    untrack(() => {
      if (v !== prevValue) {
        prevValue = v;
        if (v) {
          suppressCreate = true;
          clearTimeout(suppressTimer);
          suppressTimer = setTimeout(() => {
            suppressCreate = false;
          }, 400);
        } else {
          suppressCreate = false;
        }
      }
    });
  });

  $effect(() => {
    if (fileExists) {
      suppressCreate = false;
      clearTimeout(suppressTimer);
    }
  });

  onDestroy(() => clearTimeout(suppressTimer));

  let showCreate = $derived(allowCreate && !suppressCreate && (localPath === '' || !fileExists));

  let pendingRequestId: string | null = null;
  let requestError = $state<string | null>(null);

  onMount(() => {
    if (onMessage) {
      onMessage((event: MessageEvent) => {
        if (
          event.data?.type === 'fileSelected' &&
          event.data.payload?.requestId === pendingRequestId
        ) {
          pendingRequestId = null;
          if (event.data.payload.path) {
            requestError = null;
            if (onCreated) {
onCreated(event.data.payload);
} else {
onPathChange?.(event.data.payload.path);
}
          } else if (typeof event.data.payload.error === 'string' && event.data.payload.error) {
            requestError = event.data.payload.error;
          }
        }
      });
    }
  });

  function handleSelect() {
    requestError = null;
    const requestId = crypto.randomUUID();
    pendingRequestId = requestId;
    postMessage?.({ type: 'selectFile', payload: { shaderPath, fileType, requestId } });
  }

  function handleCreate() {
    requestError = null;
    const requestId = crypto.randomUUID();
    pendingRequestId = requestId;
    postMessage?.({
      type: 'createFile',
      payload: { shaderPath, suggestedPath, fileType, requestId, authoringMode: createAuthoringMode ?? effectiveMode, passName, outputCount, outputKind },
    });
  }

  let insertPopover = $state<HTMLDivElement>();
  let insertTrigger = $state<HTMLButtonElement>();
  let insertMenuOpen = $state(false);

  const insertPopoverId = $props.id();

  function positionInsertMenu() {
    if (!insertTrigger || !insertPopover) {
      return;
    }
    const bounds = insertTrigger.getBoundingClientRect();
    const width = Math.min(272, window.innerWidth - 16);
    insertPopover.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`;
    insertPopover.style.top = `${bounds.bottom + 6}px`;
  }

  function onInsertMenuToggle(event: ToggleEvent) {
    insertMenuOpen = event.newState === 'open';
    if (insertMenuOpen && insertTrigger && insertPopover) {
      const bounds = insertTrigger.getBoundingClientRect();
      const menuBounds = insertPopover.getBoundingClientRect();
      if (menuBounds.bottom > window.innerHeight - 8) {
        insertPopover.style.top = `${Math.max(8, bounds.top - menuBounds.height - 6)}px`;
      }
      insertPopover.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }

  function insertFromMenu(mode: 'hooks' | 'native') {
    insertPopover?.hidePopover?.();
    insertTrigger?.focus();
    handleInsert(mode);
  }

  function handleInsert(mode: 'hooks' | 'native' = effectiveMode) {
    requestError = null;
    const requestId = crypto.randomUUID();
    pendingRequestId = requestId;
    postMessage?.({
      type: 'insertShaderSource',
      payload: { shaderPath, sourcePath: mode === 'hooks' ? builtInSourcePath ?? sourcePath : sourcePath, fileType, requestId, authoringMode: mode, passName, outputCount, geometryType, vertexSpace },
    });
  }
</script>

<div class="input-group" class:actions-only={hidePath}>
  {#if !hidePath}<div class="input-row">
    <label for={inputId}>{label}</label>
    <input
      id={inputId}
      type="text"
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      value={localPath}
      oninput={handlePathInput}
      onfocus={() => pathInputFocused = true}
      onblur={() => {
        pathInputFocused = false; handlePathCommit();
      }}
      class="config-input"
      class:error={hasError}
      {placeholder}
    />
  </div>{/if}
  {#if postMessage}
    <div class="input-actions">
      {#if (!hidePath || showSelectWhenHidden) && allowSelect}<button class="select-file-btn" onclick={handleSelect}>{selectLabel}</button>{/if}
      {#if showCreate}
        <button class="create-file-btn" onclick={handleCreate}>{createLabel}</button>
      {/if}
      {#if allowInsert}
        {#if fragmentInsertMenu && supportsNative && !fileType.endsWith('-compute')}
          <button class="insert-file-btn" bind:this={insertTrigger} popovertarget={insertPopoverId} onclick={positionInsertMenu} aria-label="Add function" aria-expanded={insertMenuOpen}>+ Add&#8230;</button>
          <div class="insert-menu" id={insertPopoverId} bind:this={insertPopover} popover="auto" role="group" aria-label="Add function" ontoggle={onInsertMenuToggle}>
            <button class="insert-option" onclick={() => insertFromMenu('native')}>Native fragment function</button>
            <button class="insert-option" disabled={existingModes.includes('hooks')} onclick={() => insertFromMenu('hooks')}>
              <span>Built-in mainImage</span>{#if existingModes.includes('hooks')}<small>Already in this shader</small>{/if}
            </button>
          </div>
        {:else}
          {#if supportsNative && !fileType.endsWith('-compute')}
            <select aria-label="Insert mode" value={effectiveMode} onchange={(event) => selectedMode = event.currentTarget.value as 'hooks' | 'native'}>
              <option value="hooks">Built-in</option>
              <option value="native">Native</option>
            </select>
          {/if}
          {#if !existingModes.includes(effectiveMode)}<button class="insert-file-btn" onclick={() => handleInsert()}>{insertLabel}</button>{/if}
        {/if}
      {/if}
      {#if onClear}<button class="select-file-btn" onclick={onClear} disabled={!clearEnabled}>Clear</button>{/if}
    </div>
  {/if}
  {#if note}<span class="input-note">{note}</span>{/if}
  {#if requestError}<p class="request-error" role="alert">{requestError}</p>{/if}
</div>

<style>
  .input-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    min-width: 0;
    container-type: inline-size;
  }

  .input-group.actions-only { container-type: normal; }
  .input-group.actions-only .input-actions select { min-width: 7em; }

  .input-row {
    flex: 1 1 180px;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .input-row label {
    color: var(--vscode-foreground, #ccc);
    white-space: nowrap;
    font-size: var(--shader-studio-label-size);
  }

  .config-input {
    flex: 1;
    min-width: 0;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c));
    padding: var(--shader-studio-control-padding);
    font-size: var(--shader-studio-font-size);
    border-radius: var(--shader-studio-control-radius);
    outline: none;
    min-height: var(--shader-studio-control-height);
  }

  .config-input:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
}

  .config-input:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .config-input.error {
    border-color: var(--vscode-inputValidation-errorBorder, #f44336);
  }

  .input-actions {
    flex: 0 1 auto;
    max-width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .insert-menu {
    position: fixed; inset: auto; margin: 0; padding: 4px;
    width: min(272px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); overflow: auto;
    border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
    border-radius: var(--shader-studio-control-radius);
    background: var(--vscode-menu-background, var(--vscode-sideBar-background));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    box-shadow: 0 4px 12px var(--vscode-widget-shadow, rgb(0 0 0 / 20%));
  }
  .insert-option { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 6px 8px; min-height: var(--shader-studio-control-height); border: 0; border-radius: var(--shader-studio-control-radius); background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .insert-option:hover:not(:disabled) { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  .insert-option small { font-size: var(--shader-studio-label-size); font-family: var(--shader-studio-font-family); }
  .request-error { flex-basis: 100%; margin: 0; color: var(--vscode-errorForeground, #f48771); font-size: 12px; }
  select { padding: var(--shader-studio-control-padding); border-radius: var(--shader-studio-control-radius); font-size: var(--shader-studio-font-size); color: var(--vscode-dropdown-foreground, #ccc); background: var(--vscode-dropdown-background, #3c3c3c); border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border, #3c3c3c)); min-height: var(--shader-studio-control-height); }
  select:focus { outline: 1px solid var(--vscode-focusBorder, #007acc); }
  button:disabled { opacity: 0.5; cursor: default; }

  .select-file-btn,
  .create-file-btn,
  .insert-file-btn {
    padding: var(--shader-studio-control-padding);
    font-size: var(--shader-studio-font-size);
    background: none;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: var(--shader-studio-control-radius);
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
    min-height: var(--shader-studio-control-height);
  }

  .select-file-btn:hover,
  .create-file-btn:hover,
  .insert-file-btn:hover {
    color: var(--vscode-foreground, #cccccc);
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .input-note {
    flex-basis: 100%;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    font-style: italic;
  }
  @container (max-width: 300px) {
    .input-row { display: contents; }
    .input-row label { flex-basis: 100%; }
    .config-input { flex: 1 1 120px; }
  }
</style>
