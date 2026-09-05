<script module lang="ts">
  import { vi } from 'vitest';

  export const layoutStub = {
    selectEditor: vi.fn(),
    openEditor: vi.fn(),
    showPanel: vi.fn(),
    togglePanel: vi.fn(),
    isPanelVisible: vi.fn((_panel: 'explorer' | 'editor' | 'preview') => true),
    resetLayout: vi.fn(),
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    explorer: Snippet;
    editor: Snippet;
    preview: Snippet;
  }

  let { explorer, editor, preview }: Props = $props();

  export function selectEditor(path: string) {
    layoutStub.selectEditor(path);
  }

  export function openEditor(path: string) {
    layoutStub.openEditor(path);
  }

  export function showPanel(panel: 'explorer' | 'editor' | 'preview') {
    layoutStub.showPanel(panel);
  }

  export function togglePanel(panel: 'explorer' | 'editor' | 'preview') {
    layoutStub.togglePanel(panel);
  }

  export function isPanelVisible(panel: 'explorer' | 'editor' | 'preview') {
    return layoutStub.isPanelVisible(panel);
  }

  export function resetLayout() {
    layoutStub.resetLayout();
  }
</script>

<div data-testid="standalone-layout-stub">
  <section data-testid="explorer-panel">{@render explorer()}</section>
  <section data-testid="editor-panel">{@render editor()}</section>
  <section data-testid="preview-panel">{@render preview()}</section>
</div>
