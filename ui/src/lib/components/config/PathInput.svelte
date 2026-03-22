<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let value: string;
  export let placeholder: string = '';
  export let onPathChange: ((path: string) => void) | undefined = undefined;
  export let fileExists: boolean = true;
  export let hasError: boolean = false;
  export let note: string | undefined = undefined;
  export let shaderPath: string = '';
  export let suggestedPath: string = '';
  export let fileType: 'script' | 'glsl-buffer' | 'glsl-common' = 'glsl-buffer';
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;

  let pathInputFocused = false;
  let localPath = value;
  $: if (!pathInputFocused) localPath = value;

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
  let suppressCreate = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  let prevValue = value;

  $: {
    if (value !== prevValue) {
      prevValue = value;
      if (value) {
        suppressCreate = true;
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => { suppressCreate = false; }, 400);
      } else {
        suppressCreate = false;
      }
    }
  }

  $: if (fileExists) { suppressCreate = false; clearTimeout(suppressTimer); }

  onDestroy(() => clearTimeout(suppressTimer));

  $: showCreate = !suppressCreate && (localPath === '' || !fileExists);

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
      on:input={handlePathInput}
      on:focus={() => pathInputFocused = true}
      on:blur={() => { pathInputFocused = false; handlePathCommit(); }}
      class="config-input"
      class:error={hasError}
      {placeholder}
    />
  </div>
  {#if postMessage}
    <div class="input-actions">
      <button class="select-file-btn" on:click={handleSelect}>Select</button>
      {#if showCreate}
        <button class="create-file-btn" on:click={handleCreate}>Create</button>
      {/if}
    </div>
  {/if}
  {#if note}
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
    display: block;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #888);
    font-style: italic;
    margin-top: 10px;
  }
</style>
