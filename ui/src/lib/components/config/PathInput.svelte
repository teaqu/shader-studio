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
    allowInsert?: boolean;
    insertLabel?: string;
    hidePath?: boolean;
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
    allowInsert = false,
    insertLabel = 'Insert',
    hidePath = false,
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
    onCreated = undefined,
    postMessage = undefined,
    onMessage = undefined,
  }: Props = $props();

  let selectedMode = $state<'hooks' | 'native' | null>(null);
  const supportsNative = $derived(fileType.startsWith('wgsl-') || fileType.startsWith('slang-'));
  const effectiveMode = $derived(supportsNative ? selectedMode ?? authoringMode ?? getDefaultAuthoringMode() : 'hooks');
  let pathInputFocused = $state(false);
  let localPath = $state(value);
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
  let prevValue = value;

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
      payload: { shaderPath, suggestedPath, fileType, requestId, authoringMode: createAuthoringMode ?? effectiveMode, passName, outputCount },
    });
  }

  function handleInsert() {
    requestError = null;
    const requestId = crypto.randomUUID();
    pendingRequestId = requestId;
    postMessage?.({
      type: 'insertShaderSource',
      payload: { shaderPath, sourcePath: effectiveMode === 'hooks' ? builtInSourcePath ?? sourcePath : sourcePath, fileType, requestId, authoringMode: effectiveMode, passName, outputCount, geometryType, vertexSpace },
    });
  }
</script>

<div class="input-group">
  {#if !hidePath}<div class="input-row">
    <label for={inputId}>{label}</label>
    <input
      id={inputId}
      type="text"
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
      {#if !hidePath && allowSelect}<button class="select-file-btn" onclick={handleSelect}>{selectLabel}</button>{/if}
      {#if showCreate}
        <button class="create-file-btn" onclick={handleCreate}>Create</button>
      {/if}
      {#if allowInsert}
        <select aria-label="Insert mode" value={effectiveMode} onchange={(event) => selectedMode = event.currentTarget.value as 'hooks' | 'native'}>
          <option value="hooks">Built-in</option>
          {#if supportsNative}<option value="native">Native</option>{/if}
        </select>
        {#if !existingModes.includes(effectiveMode)}<button class="insert-file-btn" onclick={handleInsert}>{insertLabel}</button>{/if}
      {/if}
      {#if onClear}<button class="select-file-btn" onclick={onClear} disabled={!clearEnabled}>Clear</button>{/if}
      {#if note}
        <span class="input-note">{note}</span>
      {/if}
    </div>
  {:else if note}
    <span class="input-note">{note}</span>
  {/if}
  {#if requestError}<p class="request-error" role="alert">{requestError}</p>{/if}
</div>

<style>
  .input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .input-row label {
    color: var(--vscode-foreground, #ccc);
    white-space: nowrap;
    font-size: 14px;
  }

  .config-input {
    flex: 1;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c));
    padding: 8px 12px;
    font-size: 14px;
    border-radius: 4px;
    outline: none;
  }

  .config-input:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .config-input.error {
    border-color: var(--vscode-inputValidation-errorBorder, #f44336);
  }

  .input-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }
  .request-error { margin: 0; color: var(--vscode-errorForeground, #f48771); font-size: 12px; }
  select { padding: 4px 6px; border-radius: 4px; font-size: 13px; color: var(--vscode-input-foreground, #ccc); background: var(--vscode-input-background, #3c3c3c); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c)); }
  select:focus { outline: 1px solid var(--vscode-focusBorder, #007acc); }
  button:disabled { opacity: 0.5; cursor: default; }

  .select-file-btn,
  .create-file-btn,
  .insert-file-btn {
    padding: 4px 12px;
    font-size: 13px;
    background: none;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .select-file-btn:hover,
  .create-file-btn:hover,
  .insert-file-btn:hover {
    color: var(--vscode-foreground, #cccccc);
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .input-note {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    font-style: italic;
  }
</style>
