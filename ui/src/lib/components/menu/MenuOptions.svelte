<svelte:options runes={true} />
<script lang="ts">
  import { portal } from "../../actions/portal";
  import { getHostCapabilities, getHostEditorWordWrap, toggleHostEditorWordWrap } from "../../state/hostState.svelte";
  import { getActiveProfile, getProfileList, restoreActiveProfile, saveProfile, switchTo } from "../../state/profileStore.svelte";
  import type { CompileMode } from "../../stores/compileModeStore";
  import ProfileModal from "../ProfileModal.svelte";
  import { MenuOverlay } from "./MenuOverlay.svelte";

  interface Props {
    optionsMenu: MenuOverlay;
    layoutMenu: MenuOverlay;
    editorMenu: MenuOverlay;
    hasShader: boolean;
    previewVisible: boolean;
    showLockInOptions: boolean;
    showRecordInOptions: boolean;
    showConfigInOptions: boolean;
    showDebugInOptions: boolean;
    isLocked: boolean;
    isRecordingPanelVisible: boolean;
    isConfigPanelVisible: boolean;
    isDebugEnabled: boolean;
    isDebugSupported: boolean;
    isEditorOverlayVisible: boolean;
    isVimModeEnabled: boolean;
    showThemeButton: boolean;
    theme: "light" | "dark";
    showFullscreenButton: boolean;
    compileMode: CompileMode;
    compileModeIcons: Record<CompileMode, string>;
    compileModeLabels: Record<CompileMode, string>;
    audioVolume: number;
    audioMuted: boolean;
    onShowPreview: () => void;
    onConfig: (event: MouseEvent) => void;
    onToggleLock: () => void;
    onToggleRecording: () => void;
    onToggleConfigPanel: () => void;
    onToggleDebugEnabled: () => void;
    onToggleEditorOverlay: () => void;
    onToggleVimMode: () => void;
    onRefresh: (event: MouseEvent) => void;
    onToggleTheme: (event: MouseEvent) => void;
    onToggleFullscreen: () => void;
    onFork: () => void;
    onExtensionCommand: (command: string) => void;
    onSetCompileMode: (mode: CompileMode) => void;
    onVolumeChange: (volume: number) => void;
    onToggleMute: () => void;
    onResetLayout: () => void;
  }

  let {
    optionsMenu, layoutMenu, editorMenu, hasShader, previewVisible,
    showLockInOptions, showRecordInOptions, showConfigInOptions, showDebugInOptions,
    isLocked, isRecordingPanelVisible, isConfigPanelVisible, isDebugEnabled,
    isDebugSupported, isEditorOverlayVisible, isVimModeEnabled, showThemeButton,
    theme, showFullscreenButton, compileMode, compileModeIcons, compileModeLabels,
    audioVolume, audioMuted, onShowPreview, onConfig, onToggleLock, onToggleRecording,
    onToggleConfigPanel, onToggleDebugEnabled, onToggleEditorOverlay, onToggleVimMode,
    onRefresh, onToggleTheme, onToggleFullscreen, onFork, onExtensionCommand,
    onSetCompileMode, onVolumeChange, onToggleMute, onResetLayout,
  }: Props = $props();

  let confirmingSave = $state(false);
  let showProfileModal = $state(false);
  const wordWrap = $derived(getHostEditorWordWrap());

  function handleVolumeSlider(event: Event) {
    onVolumeChange(parseFloat((event.target as HTMLInputElement).value));
  }

  function handleToggleMute(event: MouseEvent) {
    event.stopPropagation();
    onToggleMute();
  }

  $effect(() => {
    if (!layoutMenu.open) {
      confirmingSave = false;
    }
  });
</script>

{#if optionsMenu.open}
  <div
    use:portal
    bind:this={optionsMenu.element}
    class="options-menu-portal"
    style="top: {optionsMenu.position.top}px; left: {optionsMenu.position.left}px; visibility: {optionsMenu.visible ? 'visible' : 'hidden'};"
  >
    {#if !previewVisible}
      <button
        class="options-menu-item"
        onclick={() => {
          onShowPreview(); optionsMenu.open = false;
        }}
        aria-label="Show preview"
      >
        <i class="codicon codicon-play"></i>
        <span>Show Preview</span>
      </button>
    {/if}
    <button
      class="options-menu-item"
      onclick={(event) => onConfig(event)}
      aria-label="Open config"
      disabled={!hasShader}
    >
      <i class="codicon codicon-json"></i>
      <span>Open Config File</span>
    </button>
    {#if showLockInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
          onToggleLock(); optionsMenu.open = false;
        }}
        aria-label="Toggle lock"
        class:active={isLocked}
        disabled={!hasShader}
      >
        {#if isLocked}
          <i class="codicon codicon-lock"></i>
        {:else}
          <i class="codicon codicon-unlock"></i>
        {/if}
        <span>{isLocked ? 'Unlock' : 'Lock'}</span>
      </button>
    {/if}
    {#if showRecordInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
          optionsMenu.open = false; onToggleRecording();
        }}
        aria-label="Toggle export panel"
        class:active={isRecordingPanelVisible}
        disabled={!hasShader}
      >
        <i class="codicon codicon-device-camera"></i>
        <span>Export</span>
      </button>
    {/if}
    {#if showConfigInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
          onToggleConfigPanel(); optionsMenu.open = false;
        }}
        aria-label="Toggle config panel"
        class:active={isConfigPanelVisible}
        disabled={!hasShader}
      >
        <i class="codicon codicon-gear"></i>
        <span>Config</span>
      </button>
    {/if}
    <button
      bind:this={layoutMenu.trigger}
      class="options-menu-item"
      onclick={() => {
        layoutMenu.open = !layoutMenu.open;
      }}
      aria-label="Switch layout profile"
      style="width:100%;justify-content:space-between"
    >
      <div style="display:flex;align-items:center;gap:8px">
        <i class="codicon codicon-layout"></i>
        <span>Layout: {getProfileList().find(p => p.id === getActiveProfile())?.name ?? getActiveProfile()}</span>
      </div>
      <i class="codicon codicon-chevron-right"></i>
    </button>
    {#if showDebugInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
          onToggleDebugEnabled(); optionsMenu.open = false;
        }}
        aria-label="Toggle debug mode"
        class:active={isDebugEnabled}
        disabled={!hasShader || !isDebugSupported}
      >
        <i class="codicon codicon-bug"></i>
        <span>Debug</span>
      </button>
    {/if}
    <button
      bind:this={editorMenu.trigger}
      class="options-menu-item"
      onclick={() => {
        editorMenu.open = !editorMenu.open;
      }}
      aria-label="Open editor submenu"
      style="width:100%;justify-content:space-between"
    >
      <div style="display:flex;align-items:center;gap:8px">
        <i class="codicon codicon-code"></i>
        <span>Editor Overlay</span>
      </div>
      <i class="codicon codicon-chevron-right"></i>
    </button>
    <button
      class="options-menu-item"
      onclick={(event) => onRefresh(event)}
      aria-label="Refresh shader"
      disabled={!hasShader}
    >
      <i class="codicon codicon-refresh"></i>
      <span>Refresh</span>
    </button>
    {#if showThemeButton}
      <button
        class="options-menu-item"
        onclick={(event) => onToggleTheme(event)}
        aria-label="Toggle theme"
      >
        {#if theme === "light"}
          <i class="codicon codicon-color-mode"></i>
          <span>Dark Mode</span>
        {:else}
          <i class="codicon codicon-color-mode"></i>
          <span>Light Mode</span>
        {/if}
      </button>
    {/if}
    {#if showFullscreenButton}
      <button
        class="options-menu-item"
        onclick={() => onToggleFullscreen()}
        aria-label="Toggle fullscreen"
      >
        <i class="codicon codicon-screen-full"></i>
        <span>Fullscreen</span>
      </button>
    {/if}
    <button
      class="options-menu-item"
      onclick={() => {
        onFork(); optionsMenu.open = false;
      }}
      aria-label="Fork shader"
      disabled={!hasShader}
    >
      <i class="codicon codicon-repo-forked"></i>
      <span>Fork</span>
    </button>
    <button
      class="options-menu-item"
      onclick={() => {
        onExtensionCommand('newShader'); optionsMenu.open = false;
      }}
      aria-label="New shader"
    >
      <i class="codicon codicon-new-file"></i>
      <span>New Shader</span>
    </button>
    <button
      class="options-menu-item"
      onclick={() => {
        onExtensionCommand('openShaderExplorer'); optionsMenu.open = false;
      }}
      aria-label="Shader explorer"
    >
      <i class="codicon codicon-book"></i>
      <span>Shader Explorer</span>
    </button>
    <div class="options-menu-divider"></div>
    <div class="options-menu-item compile-mode-menu-item">
      <span>Mode</span>
      <div class="compile-mode-selector" role="group" aria-label="Compile mode">
        <button
          class="compile-mode-button"
          class:active={compileMode === "hot"}
          onclick={() => onSetCompileMode("hot")}
          aria-label="Set hot compile mode"
          disabled={!hasShader}
          title={compileModeLabels.hot}
        >
          <i class={`codicon codicon-${compileModeIcons.hot}`}></i>
        </button>
        {#if getHostCapabilities().compileOnSave}
          <button
            class="compile-mode-button"
            class:active={compileMode === "save"}
            onclick={() => onSetCompileMode("save")}
            aria-label="Set save compile mode"
            disabled={!hasShader}
            title={compileModeLabels.save}
          >
            <i class={`codicon codicon-${compileModeIcons.save}`}></i>
          </button>
        {/if}
        <button
          class="compile-mode-button"
          class:active={compileMode === "manual"}
          onclick={() => onSetCompileMode("manual")}
          aria-label="Set manual compile mode"
          disabled={!hasShader}
          title={compileModeLabels.manual}
        >
          <i class={`codicon codicon-${compileModeIcons.manual}`}></i>
        </button>
      </div>
    </div>
    <div class="options-menu-divider"></div>
    <div class="volume-slider-container">
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={audioVolume}
        oninput={handleVolumeSlider}
        class="volume-slider"
        aria-label="Volume"
        class:muted-slider={audioMuted}
      />
      <span class="volume-label">{Math.round(audioVolume * 100)}%</span>
      <button
        class="mute-icon-btn"
        onclick={(e) => {
          e.stopPropagation(); onToggleMute();
        }}
        aria-label="Toggle mute"
        class:muted={audioMuted}
      >
        {#if audioMuted}
          <i class="codicon codicon-mute"></i>
        {:else}
          <i class="codicon codicon-unmute"></i>
        {/if}
      </button>
    </div>
  </div>
{/if}

{#if editorMenu.open}
  <div
    use:portal
    bind:this={editorMenu.element}
    class="editor-submenu-portal"
    style="top: {editorMenu.position.top}px; left: {editorMenu.position.left}px; visibility: {editorMenu.visible ? 'visible' : 'hidden'};"
  >
    {#if wordWrap !== undefined}
      <button class="editor-submenu-item" class:active={wordWrap === 'on'}
        aria-label="Wrap text" aria-pressed={wordWrap === 'on'} onclick={toggleHostEditorWordWrap}>
        {#if wordWrap === 'on'}
          <i class="codicon codicon-check"></i>
        {:else}
          <span class="check-placeholder"></span>
        {/if}
        Wrap Text
      </button>
    {/if}
    <button
      class="editor-submenu-item"
      class:active={isEditorOverlayVisible}
      onclick={() => {
        onToggleEditorOverlay();
      }}
      aria-label="Enable editor overlay"
      disabled={!hasShader}
    >
      {#if isEditorOverlayVisible}
        <i class="codicon codicon-check"></i>
      {:else}
        <span class="check-placeholder"></span>
      {/if}
      Enable
    </button>
    <button
      class="editor-submenu-item"
      class:active={isVimModeEnabled}
      onclick={() => {
        onToggleVimMode();
      }}
      aria-label="Toggle vim mode"
    >
      {#if isVimModeEnabled}
        <i class="codicon codicon-check"></i>
      {:else}
        <span class="check-placeholder"></span>
      {/if}
      Vim Mode
    </button>
  </div>
{/if}

{#if layoutMenu.open}
  <div
    use:portal
    bind:this={layoutMenu.element}
    class="layout-submenu-portal"
    style="top: {layoutMenu.position.top}px; left: {layoutMenu.position.left}px; visibility: {layoutMenu.visible ? 'visible' : 'hidden'};"
  >
    {#each getProfileList() as profile}
      <button
        class="layout-submenu-item"
        class:active={profile.id === getActiveProfile()}
        onclick={() => {
          switchTo(profile.id); layoutMenu.open = false; optionsMenu.open = false;
        }}
      >
        {#if profile.id === getActiveProfile()}
          <i class="codicon codicon-check"></i>
        {:else}
          <span class="check-placeholder"></span>
        {/if}
        {profile.name}
      </button>
    {/each}
    <div class="options-menu-divider"></div>
    {#if confirmingSave}
      <div class="layout-submenu-confirm">
        <span>Save to "{getProfileList().find(p => p.id === getActiveProfile())?.name ?? getActiveProfile()}"? Are you sure?</span>
        <div class="layout-submenu-confirm-btns">
          <button class="confirm-btn confirm-yes" onclick={async (e) => {
            e.stopPropagation();
            await saveProfile(); confirmingSave = false; layoutMenu.open = false; optionsMenu.open = false;
          }}>Yes</button>
          <button class="confirm-btn confirm-no" onclick={(e) => {
            e.stopPropagation();
            confirmingSave = false;
          }}>Cancel</button>
        </div>
      </div>
    {:else}
      <button
        class="layout-submenu-item"
        onclick={(e) => {
          e.stopPropagation();
          confirmingSave = true;
        }}
      >
        <i class="codicon codicon-save"></i>
        Save current layout
      </button>
    {/if}
    <button
      class="layout-submenu-item"
      onclick={async () => {
        await restoreActiveProfile(); layoutMenu.open = false; optionsMenu.open = false;
      }}
      aria-label="Restore saved layout"
      disabled={!hasShader}
    >
      <i class="codicon codicon-history"></i>
      Restore Saved Layout
    </button>
    <button
      class="layout-submenu-item"
      onclick={() => {
        onResetLayout(); layoutMenu.open = false; optionsMenu.open = false;
      }}
      aria-label="Reset default layout"
      disabled={!hasShader}
    >
      <i class="codicon codicon-debug-restart"></i>
      Reset to Default
    </button>
    <button
      class="layout-submenu-item"
      onclick={() => {
        showProfileModal = true; layoutMenu.open = false; optionsMenu.open = false;
      }}
    >
      <i class="codicon codicon-settings"></i>
      Manage profiles…
    </button>
  </div>
{/if}

{#if showProfileModal}
  <div use:portal>
    <ProfileModal onclose={() => {
      showProfileModal = false;
    }} />
  </div>
{/if}

<style>
  .compile-mode-selector {
    display: flex;
    gap: 2px;
  }

  .compile-mode-menu-item {
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .compile-mode-button {
    min-width: 32px;
  }

  .compile-now-button {
    min-width: 32px;
  }

  .options-menu-divider {
    height: 1px;
    background: var(--border-color, rgba(128, 128, 128, 0.3));
    margin: 4px 0;
  }

  .volume-slider-container {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
  }

  .volume-slider {
    flex: 1;
    height: 4px;
    cursor: pointer;
    accent-color: var(--accent-color, #007acc);
  }

  .volume-slider.muted-slider {
    opacity: 0.4;
  }

  .volume-label {
    font-size: 11px;
    min-width: 32px;
    text-align: right;
    opacity: 0.7;
  }

  .mute-icon-btn {
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: inherit;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .mute-icon-btn.muted {
    color: #e55;
  }

  :global(.layout-submenu-portal) {
    position: fixed;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
    border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
    border-radius: 4px;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    z-index: 9999;
    padding: 4px 0;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
  }

  :global(.layout-submenu-portal .layout-submenu-item) {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 12px;
    background: none;
    border: none;
    color: var(--vscode-menu-foreground, var(--vscode-editor-foreground));
    cursor: pointer;
    font-size: 12px;
    text-align: left;
    box-sizing: border-box;
  }

  :global(.layout-submenu-portal .layout-submenu-item:hover),
  :global(.layout-submenu-portal .layout-submenu-item.active) {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
  }

  :global(.layout-submenu-portal .layout-submenu-item:disabled) {
    cursor: default;
    opacity: 0.45;
  }

  :global(.layout-submenu-portal .layout-submenu-item:disabled:hover) {
    background: none;
  }

  :global(.layout-submenu-portal .check-placeholder) {
    width: 16px;
    display: inline-block;
  }

  :global(.layout-submenu-portal .options-menu-divider) {
    height: 1px;
    background: var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
    margin: 4px 0;
  }

  :global(.layout-submenu-portal .layout-submenu-confirm) {
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  :global(.layout-submenu-portal .layout-submenu-confirm span) {
    font-size: 11px;
    color: var(--vscode-menu-foreground, var(--vscode-editor-foreground));
    opacity: 0.85;
  }

  :global(.layout-submenu-portal .layout-submenu-confirm-btns) {
    display: flex;
    gap: 6px;
  }

  :global(.layout-submenu-portal .confirm-btn) {
    flex: 1;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 2px;
    border: none;
    cursor: pointer;
  }

  :global(.layout-submenu-portal .confirm-yes) {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  :global(.layout-submenu-portal .confirm-yes:hover) {
    background: var(--vscode-button-hoverBackground);
  }

  :global(.layout-submenu-portal .confirm-no) {
    background: var(--vscode-button-secondaryBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
  }

  :global(.layout-submenu-portal .confirm-no:hover) {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-activeSelectionBackground));
  }

  :global(.editor-submenu-portal) {
    position: fixed;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
    border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
    border-radius: 4px;
    min-width: 160px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    z-index: 9999;
    padding: 4px 0;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
  }

  :global(.editor-submenu-portal .editor-submenu-item) {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 12px;
    background: none;
    border: none;
    color: var(--vscode-menu-foreground, var(--vscode-editor-foreground));
    cursor: pointer;
    font-size: 12px;
    text-align: left;
    box-sizing: border-box;
  }

  :global(.editor-submenu-portal .editor-submenu-item:hover),
  :global(.editor-submenu-portal .editor-submenu-item.active) {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
  }

  :global(.editor-submenu-portal .editor-submenu-item:disabled) {
    cursor: default;
    opacity: 0.45;
  }

  :global(.editor-submenu-portal .editor-submenu-item:disabled:hover) {
    background: none;
  }

  :global(.editor-submenu-portal .check-placeholder) {
    width: 16px;
    display: inline-block;
  }
</style>
