<svelte:options runes={true} />

<script lang="ts">
  import {
    copySelection, cutSelection, hasSelectedText, openEditorMenu, pasteClipboard, selectAll, TouchDragSelection,
    type TouchClipboard, type TouchEditor,
  } from "../editor/touchSelection";

  interface Props {
    editor: TouchEditor;
    clipboard?: TouchClipboard;
  }

  let { editor, clipboard = globalThis.navigator?.clipboard }: Props = $props();

  let selecting = $state(false);
  let hasSelection = $state(false);
  let message = $state("");
  let drag = $state.raw<TouchDragSelection | null>(null);

  $effect(() => {
    const current = new TouchDragSelection(editor);
    drag = current;
    hasSelection = hasSelectedText(editor);
    const subscription = editor.onDidChangeCursorSelection(() => {
      hasSelection = hasSelectedText(editor);
    });
    return () => {
      subscription.dispose();
      current.dispose();
      drag = null;
    };
  });

  $effect(() => {
    drag?.setEnabled(selecting);
  });

  async function run(action: (target: TouchEditor, board: TouchClipboard) => Promise<boolean>, failure: string) {
    message = "";
    if (!clipboard) {
      message = "Clipboard is not available in this browser.";
      return;
    }
    try {
      if (await action(editor, clipboard)) {
        selecting = false;
      }
    } catch {
      message = failure;
    }
  }

  // Tapping a button must not move focus out of the editor, or iOS closes the keyboard.
  function keepEditorFocus(event: PointerEvent) {
    event.preventDefault();
  }
</script>

<div class="touch-edit-bar" role="toolbar" aria-label="Touch editing">
  <button
    type="button"
    aria-pressed={selecting}
    title="Drag over the code to select it"
    onpointerdown={keepEditorFocus}
    onclick={() => {
      selecting = !selecting;
      message = "";
    }}
  >Select</button>
  <button type="button" onpointerdown={keepEditorFocus} onclick={() => selectAll(editor)}>All</button>
  <button
    type="button"
    disabled={!hasSelection}
    onpointerdown={keepEditorFocus}
    onclick={() => run(copySelection, "Could not copy to the clipboard.")}
  >Copy</button>
  <button
    type="button"
    disabled={!hasSelection}
    onpointerdown={keepEditorFocus}
    onclick={() => run(cutSelection, "Could not copy to the clipboard.")}
  >Cut</button>
  <button
    type="button"
    onpointerdown={keepEditorFocus}
    onclick={() => run(pasteClipboard, "Could not read the clipboard. Allow pasting and try again.")}
  >Paste</button>
  <button
    type="button"
    aria-label="More editor actions"
    title="More editor actions"
    onpointerdown={keepEditorFocus}
    onclick={() => {
      message = "";
      openEditorMenu(editor);
    }}
  >Menu</button>
  {#if message}<span class="touch-edit-message" role="status">{message}</span>{/if}
</div>

<style>
  .touch-edit-bar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    padding: 4px 8px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526));
  }

  .touch-edit-bar button {
    min-height: 44px;
    min-width: 44px;
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--vscode-foreground, #ccc);
    background: transparent;
    font: inherit;
    touch-action: manipulation;
  }

  .touch-edit-bar button[aria-pressed="true"] {
    border-color: var(--vscode-focusBorder, #007fd4);
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }

  .touch-edit-bar button:disabled {
    opacity: 0.45;
  }

  .touch-edit-message {
    flex: 1 0 auto;
    padding: 0 6px;
    color: var(--vscode-errorForeground, #f48771);
    font-size: 12px;
  }
</style>
