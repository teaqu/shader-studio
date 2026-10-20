<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getHostEditorAutoSuggestions, toggleHostEditorAutoSuggestions, getHostEditorDescriptions, toggleHostEditorDescriptions } from '../state/hostState.svelte';

  interface Props {
    options?: Snippet;
    touch?: boolean;
    onCommand?: (command: 'undo' | 'redo' | 'indent' | 'outdent') => void;
    onInsert?: (text: string) => void;
  }
  let { options, touch = false, onCommand, onInsert }: Props = $props();
  let optionsOpen = $state(false);
  let expanded = $state(false);
  let toolbar = $state<HTMLDivElement>();
  const collapsed = $derived(touch && !!onCommand && !expanded);
  const optionsId = $props.id();
  const suggestions = $derived(getHostEditorAutoSuggestions());
  const descriptions = $derived(getHostEditorDescriptions(touch));
  const historyCommands = [
    { command: 'undo', label: 'Undo', text: 'Undo' },
    { command: 'redo', label: 'Redo', text: 'Redo' },
    { command: 'outdent', label: 'Outdent', text: 'Shift Tab' },
  ] as const;

  function dismissKeyboard() {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
      focused.blur();
    }
    optionsOpen = false;
  }

  $effect(() => {
    if (!touch) {
      optionsOpen = false;
      expanded = false;
    }
  });
</script>

<svelte:window onkeydown={event => {
  if (event.key === 'Escape') {
    optionsOpen = false;
  }
}} onpointerdown={event => {
  if (optionsOpen && toolbar && !event.composedPath().includes(toolbar)) {
    optionsOpen = false;
  }
}} />

{#if options || (touch && onCommand)}
  <div class="editor-toolbar" class:touch class:collapsed role="toolbar" aria-label="Editor options" bind:this={toolbar}>
    {#if touch && onCommand && optionsOpen}
      <div class="editor-actions" id={optionsId} role="group" aria-label="More editing options">
        <button type="button" onmousedown={event => event.preventDefault()} onclick={dismissKeyboard}>Hide keyboard</button>
        <div class="history-actions">
          {#each historyCommands as tool (tool.command)}
            <button type="button" aria-label={tool.label} title={tool.label} onmousedown={event => event.preventDefault()} onclick={() => onCommand?.(tool.command)}>{tool.text}</button>
          {/each}
        </div>
        {#if suggestions !== undefined}
          <button class="suggestions-toggle" type="button" aria-label={suggestions ? 'Disable suggestions' : 'Enable suggestions'} aria-pressed={suggestions}
            onmousedown={event => event.preventDefault()} onclick={toggleHostEditorAutoSuggestions}>
            <span>Suggestions</span><span aria-hidden="true">{suggestions ? 'On' : 'Off'}</span>
          </button>
        {/if}
        {#if descriptions !== undefined}
          <button type="button" aria-label={descriptions ? 'Disable descriptions' : 'Enable descriptions'} aria-pressed={descriptions}
            onmousedown={event => event.preventDefault()} onclick={() => toggleHostEditorDescriptions(touch)}>Descriptions</button>
        {/if}
        {@render options?.()}
      </div>
    {/if}
    <div class="toolbar-row">
      {#if touch && onCommand}
        {#if expanded}
          <div class="key-strip" role="group" aria-label="Keyboard keys; swipe for more">
            <button type="button" aria-label="Indent" title="Indent" onmousedown={event => event.preventDefault()} onclick={() => onCommand?.('indent')}>Tab</button>
            {#each ['{', '}', '(', ')', ';', '[', ']', '='] as symbol (symbol)}
              <button type="button" aria-label={`Insert ${symbol}`} onmousedown={event => event.preventDefault()} onclick={() => onInsert?.(symbol)}>{symbol}</button>
            {/each}
          </div>
          <button class="more-button" type="button" aria-label="More editing options" title="More editing options" aria-expanded={optionsOpen} aria-controls={optionsId}
            onmousedown={event => event.preventDefault()} onclick={() => optionsOpen = !optionsOpen}>More</button>
        {/if}
        <button class="toolbar-toggle" type="button" aria-label={expanded ? 'Hide keyboard toolbar' : 'Show keyboard toolbar'}
          title={expanded ? 'Hide keyboard toolbar' : 'Show keyboard toolbar'} aria-expanded={expanded}
          onmousedown={event => event.preventDefault()} onclick={() => {
            expanded = !expanded;
            optionsOpen = false;
          }}>
          {#if expanded}<span aria-hidden="true">›</span>{:else}<span aria-hidden="true">‹</span> Keys{/if}
        </button>
      {:else if !touch}
        {@render options?.()}
      {/if}
    </div>
  </div>
{/if}

<style>
  .editor-toolbar {
    position: relative;
    flex: none;
    min-width: 0;
    min-height: 32px;
    box-sizing: border-box;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-statusBar-background, var(--vscode-sideBar-background));
    color: var(--vscode-statusBar-foreground, var(--vscode-foreground));
  }
  .toolbar-row { display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 2px 6px; }
  .toolbar-row :global(button) { flex: none; }
  .editor-toolbar.touch { position: absolute; left: calc(6px + var(--mobile-editor-switch-width, 0px)); right: 6px; bottom: calc(6px + var(--mobile-keyboard-inset, 0px)); z-index: 2; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); box-shadow: 0 1px 5px rgb(0 0 0 / 18%); }
  .editor-toolbar.collapsed { left: auto; min-height: 0; border: 0; border-radius: 18px; background: transparent; }
  .collapsed .toolbar-row { padding: 0; }
  .touch.collapsed .toolbar-toggle { min-height: 36px; padding: 4px 10px; border-radius: 18px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); }
  .toolbar-toggle span { font-size: 22px; line-height: 20px; }
  .touch .toolbar-row :global(button) { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 32px; min-width: 32px; padding: 3px 8px; font-size: 13px; line-height: 20px; }
  .toolbar-row :global(button[aria-pressed='true']), .editor-actions :global(button[aria-pressed='true']), button[aria-expanded='true'] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .key-strip { display: flex; flex: 1; min-width: 0; gap: 4px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; touch-action: pan-x; }
  .key-strip::-webkit-scrollbar { display: none; }
  .more-button { margin-left: auto; }
  .editor-actions { position: absolute; bottom: calc(100% + 4px); right: 4px; z-index: 2; display: grid; gap: 6px; width: min(260px, calc(100% - 8px)); max-height: max(80px, calc(var(--mobile-viewport-height, 100dvh) - 60px)); overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); box-shadow: 0 2px 10px rgb(0 0 0 / 20%); }
  .history-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .suggestions-toggle, .editor-actions :global(button[aria-pressed]) { display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 6px 10px; font: inherit; text-align: left; }
  .editor-actions :global(button[aria-pressed]::after) { content: 'Off'; font-size: 12px; }
  .editor-actions :global(button[aria-pressed='true']::after) { content: 'On'; }
  .suggestions-toggle::after { display: none; }
  button { min-width: 0; min-height: 36px; padding: 4px; border: 1px solid var(--vscode-panel-border); border-radius: var(--shader-studio-control-radius, 4px); background: transparent; color: inherit; font: inherit; cursor: pointer; touch-action: manipulation; }
  button:hover { background: var(--vscode-statusBarItem-hoverBackground, var(--vscode-toolbar-hoverBackground)); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -2px; }
</style>
