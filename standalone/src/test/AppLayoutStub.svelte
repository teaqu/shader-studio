<script module lang="ts">
  import { vi } from 'vitest';

  export const layoutStub = {
    selectEditor: vi.fn(),
    openEditor: vi.fn(),
    closeEditorPaths: vi.fn(),
    showPanel: vi.fn(),
    togglePanel: vi.fn(),
    isPanelVisible: vi.fn((_panel: 'explorer' | 'files' | 'editor' | 'preview') => true),
    resetLayout: vi.fn(),
    isMobileLayout: vi.fn(() => false),
    selectMobilePanel: vi.fn(),
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isMobileViewport } from '../state/mobileShellState.svelte';

  interface Props {
    explorer: Snippet; files?: Snippet;
    editor: Snippet;
    preview: Snippet;
    studio?: Snippet;
    studioNotices?: Snippet;
  }

  let { explorer, files, editor, preview, studio, studioNotices }: Props = $props();

  export function selectEditor(path: string) {
    layoutStub.selectEditor(path);
  }

  export function openEditor(path: string) {
    layoutStub.openEditor(path);
  }

  export function closeEditorPaths(paths: readonly string[]) {
    layoutStub.closeEditorPaths(paths);
  }

  export function showPanel(panel: 'explorer' | 'files' | 'editor' | 'preview') {
    layoutStub.showPanel(panel);
  }

  export function togglePanel(panel: 'explorer' | 'files' | 'editor' | 'preview') {
    layoutStub.togglePanel(panel);
  }

  export function isPanelVisible(panel: 'explorer' | 'files' | 'editor' | 'preview') {
    return layoutStub.isPanelVisible(panel);
  }

  export function resetLayout() {
    layoutStub.resetLayout();
  }

  export function isMobileLayout() {
    return layoutStub.isMobileLayout();
  }

  export function selectMobilePanel(panel: 'explorer' | 'files' | 'editor' | 'preview' | 'tools') {
    layoutStub.selectMobilePanel(panel);
  }
</script>

<div data-testid="standalone-layout-stub">
  <section data-testid="explorer-panel">{@render explorer()}</section>
  <section data-testid="files-panel">{@render files?.()}</section>
  <section data-testid="editor-panel">{@render editor()}</section>
  <section data-testid="preview-panel">{@render preview()}</section>
  {#if isMobileViewport()}
    <section data-testid="studio-bar">{@render studio?.()}</section>
    <section data-testid="studio-notices">{@render studioNotices?.()}</section>
  {/if}
</div>
