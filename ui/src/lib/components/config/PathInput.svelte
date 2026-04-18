<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';

  type FileType = 'script' | 'glsl-buffer' | 'glsl-common' | 'texture' | 'video' | 'audio' | 'cubemap';

  interface Props {
    value: string;
    placeholder?: string;
    onPathChange?: (path: string) => void;
    fileExists?: boolean;
    hasError?: boolean;
    note?: string;
    shaderPath?: string;
    suggestedPath?: string;
    fileType?: FileType;
    allowCreate?: boolean;
    postMessage?: (msg: any) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
  }

  let {
    value,
    placeholder = '',
    onPathChange = undefined,
    fileExists = true,
    hasError = false,
    note = undefined,
    shaderPath = '',
    suggestedPath = '',
    fileType = 'glsl-buffer',
    allowCreate = true,
    postMessage = undefined,
    onMessage = undefined,
  }: Props = $props();

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

  onMount(() => {
    if (onMessage) {
      onMessage((event: MessageEvent) => {
        if (
          event.data?.type === 'fileSelected' &&
          event.data.payload?.requestId === pendingRequestId
        ) {
          pendingRequestId = null;
          onPathChange?.(event.data.payload.path);
        }
      });
    }
  });

  function handleSelect() {
    const requestId = crypto.randomUUID();
    pendingRequestId = requestId;
    postMessage?.({ type: 'selectFile', payload: { shaderPath, fileType, requestId } });
  }

  function handleCreate() {
    const requestId = crypto.randomUUID();
    pendingRequestId = requestId;
    postMessage?.({ type: 'createFile', payload: { shaderPath, suggestedPath, fileType, requestId } });
  }
</script>

<div class="input-group">
  <div class="input-row">
    <label for="path-input">Path:</label>
    <input
      id="path-input"
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
  </div>
  {#if postMessage}
    <div class="input-actions">
      <button class="select-file-btn" onclick={handleSelect}>Select</button>
      {#if showCreate}
        <button class="create-file-btn" onclick={handleCreate}>Create</button>
      {/if}
      {#if note}
        <span class="input-note">{note}</span>
      {/if}
    </div>
  {:else if note}
    <span class="input-note">{note}</span>
  {/if}
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

  .select-file-btn,
  .create-file-btn {
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
  .create-file-btn:hover {
    color: var(--vscode-foreground, #cccccc);
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .input-note {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    font-style: italic;
  }
</style>
