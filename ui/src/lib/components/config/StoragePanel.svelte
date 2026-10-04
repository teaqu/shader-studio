<svelte:options runes={true} />

<script lang="ts">
  import { tick } from "svelte";
  import type {
    StorageBufferConfig,
    StorageBufferSnapshot,
    StorageCapturePoint,
  } from "@shader-studio/types";
  import type { ConfigFieldErrors } from "../../config/ComputeConfigMutations";
  import {
    getStorageView,
    selectStorageBuffer,
    selectStorageTab,
  } from "../../state/storageViewState.svelte";
  import StorageBufferEditor from "./StorageBufferEditor.svelte";
  import StorageInspector from "./StorageInspector.svelte";
  interface Props {
    storage: Record<string, StorageBufferConfig>;
    referencesFor: (name: string) => string[];
    onAdd: () => string | null;
    onApply: (
      originalName: string,
      name: string,
      declaration: StorageBufferConfig,
    ) => ConfigFieldErrors;
    onDelete: (name: string) => ConfigFieldErrors;
    onRead?: (
      name: string,
      start: number,
      count: number,
      point?: StorageCapturePoint,
    ) => Promise<StorageBufferSnapshot>;
    onReset?: (name: string) => Promise<void>;
    scope?: string;
    language?: "wgsl" | "slang" | "glsl";
    passes?: Array<{ name: string; compute: boolean }>;
  }
  let {
    storage,
    referencesFor,
    onAdd,
    onApply,
    onDelete,
    onRead,
    onReset,
    scope = "",
    language = "wgsl",
    passes = [],
  }: Props = $props();
  let panel = $state<HTMLElement>();
  const id = $props.id();
  const view = $derived(getStorageView(scope));
  const names = $derived(Object.keys(storage));
  const selected = $derived(storage[view.selected] ? view.selected : names[0]);
  const tab = $derived(onRead ? view.tab : "settings");
  async function addStorage(): Promise<void> {
    const name = onAdd();
    if (!name) {
      return;
    }
    selectStorageBuffer(scope, name);
    selectStorageTab(scope, "settings");
    await tick();
    panel
      ?.querySelector<HTMLInputElement>('[aria-label="Storage name"]')
      ?.focus();
  }
</script>

<section class="storage-panel" bind:this={panel} aria-label="Storage buffers">
  <header>
    <div>
      <h2>GPU storage</h2>
    </div>
    <button class="primary" onclick={addStorage} aria-label="Add storage buffer"
      >+ Add buffer</button
    >
  </header>
  {#if !names.length}<p>No storage buffers are configured.</p>
  {:else}<div class="workspace">
      <nav aria-label="Storage buffers list">
        {#each names as name}<button
            aria-label="Select storage {name}"
            aria-pressed={selected === name}
            onclick={() => selectStorageBuffer(scope, name)}
            ><span>{name}</span><small
              >{storage[name]!.count.toLocaleString()} elements</small
            ></button
          >{/each}
      </nav>
      <main>
        <div class="tabs" role="tablist" aria-label="Buffer view">
          <button
            role="tab"
            id={`${id}-settings-tab`}
            aria-controls={`${id}-settings`}
            aria-selected={tab === "settings"}
            onclick={() => selectStorageTab(scope, "settings")}>Settings</button
          ><button
            role="tab"
            id={`${id}-inspect-tab`}
            aria-controls={`${id}-inspect`}
            aria-selected={tab === "inspect"}
            disabled={!onRead}
            onclick={() => selectStorageTab(scope, "inspect")}>Inspect</button
          >
        </div>
        {#if selected}{#key selected}
            {#if tab === "settings"}<div
                id={`${id}-settings`}
                role="tabpanel"
                aria-labelledby={`${id}-settings-tab`}
              >
                <StorageBufferEditor
                  name={selected}
                  declaration={storage[selected]!}
                  existingNames={names}
                  referencedBy={referencesFor(selected)}
                  {language}
                  {passes}
                  {onApply}
                  {onDelete}
                  {onReset}
                  onRenamed={(name) => selectStorageBuffer(scope, name)}
                  onDeleted={() => {
                    selectStorageBuffer(scope, "");
                    panel
                      ?.querySelector<HTMLButtonElement>(
                        '[aria-label="Add storage buffer"]',
                      )
                      ?.focus();
                  }}
                />
              </div>
            {:else if onRead}<div
                id={`${id}-inspect`}
                role="tabpanel"
                aria-labelledby={`${id}-inspect-tab`}
              >
                <StorageInspector
                  name={selected}
                  count={storage[selected]!.count}
                  {scope}
                  passes={passes.map((pass) => pass.name)}
                  {onRead}
                />
              </div>{/if}
          {/key}{/if}
      </main>
    </div>{/if}
</section>

<style>
  .storage-panel {
    --storage-bg: var(--vscode-editor-background, #202124);
    --storage-text: var(--vscode-foreground, #edeef2);
    --storage-muted: var(--vscode-descriptionForeground, #a7adba);
    --storage-soft: color-mix(
      in srgb,
      var(--storage-text) 4%,
      var(--storage-bg)
    );
    --storage-line: color-mix(
      in srgb,
      var(--storage-text) 14%,
      var(--storage-bg)
    );
    --storage-accent: color-mix(in srgb, var(--vscode-focusBorder, #a9b6ff) 55%, var(--storage-text));
    --storage-selected: color-mix(
      in srgb,
      var(--storage-accent) 14%,
      var(--storage-bg)
    );
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    color: var(--storage-text);
    background: var(--storage-bg);
    font: 14px/1.5 var(--vscode-font-family, system-ui, sans-serif);
    container-type: inline-size;
  }
  .storage-panel :global(button),
  .storage-panel :global(input),
  .storage-panel :global(select) {
    font: inherit;
    font-size: 14px;
    color: var(--storage-text);
    background: var(--storage-bg);
    border: 1px solid var(--storage-line);
    border-radius: 6px;
    padding: 6px 10px;
    min-height: 32px;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  .storage-panel :global(button) {
    cursor: pointer;
    height: 32px;
    line-height: 18px;
    flex: 0 0 auto;
  }
  .storage-panel :global(input[type='checkbox']) {
    min-height: 0;
    width: 14px;
    height: 14px;
    padding: 0;
    accent-color: var(--storage-accent);
  }
  .storage-panel :global(button:hover:not(:disabled)) {
    background: var(--storage-soft);
  }
  .storage-panel :global(button:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  .storage-panel :global(.primary) {
    background: var(--storage-selected);
    color: var(--storage-accent);
    border-color: transparent;
  }
  .storage-panel :global(button:focus-visible),
  .storage-panel :global(input:focus-visible),
  .storage-panel :global(select:focus-visible) {
    outline: 2px solid var(--storage-accent);
    outline-offset: 2px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    gap: 12px;
    border-bottom: 1px solid var(--storage-line);
  }
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 500;
  }
  p {
    padding: 16px;
    margin: 0;
    font-size: 12px;
    color: var(--storage-muted);
  }
  .workspace {
    display: grid;
    grid-template-columns: 175px minmax(0, 1fr);
    flex: 1;
  }
  nav {
    background: var(--storage-soft);
    padding: 10px;
    border-right: 1px solid var(--storage-line);
  }
  .storage-panel nav button {
    display: grid;
    gap: 3px;
    height: auto;
    width: 100%;
    text-align: left;
    margin: 3px 0;
    padding: 10px;
    background: transparent;
    border: 0;
    overflow-wrap: anywhere;
  }
  .storage-panel nav button[aria-pressed="true"] {
    background: var(--storage-selected);
    color: var(--storage-accent);
  }
  small {
    font-size: 12px;
    color: var(--storage-muted);
  }
  main {
    padding: 22px;
    min-width: 0;
  }
  .tabs {
    display: flex;
    gap: 24px;
    border-bottom: 1px solid var(--storage-line);
    margin-bottom: 20px;
  }
  .storage-panel .tabs button {
    height: 36px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: transparent;
    padding: 0 2px 10px;
    color: var(--storage-muted);
  }
  .storage-panel .tabs button[aria-selected="true"] {
    border-bottom-color: var(--storage-accent);
    color: var(--storage-text);
  }
  .storage-panel .tabs button:hover:not(:disabled) {
    color: var(--storage-text);
    background: transparent;
  }
  @container (max-width: 540px) {
    .workspace {
      grid-template-columns: 1fr;
    }
    header,
    main {
      padding: 16px;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      border-right: 0;
      border-bottom: 1px solid var(--storage-line);
    }
    .storage-panel nav button {
      width: auto;
      min-width: 110px;
      flex: 1;
    }
  }
</style>
