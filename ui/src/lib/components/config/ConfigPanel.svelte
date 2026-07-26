<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from "svelte";
  import { ConfigManager } from "../../ConfigManager";
  import { getEditorOverlayVisible, setOverlayActiveFile } from "../../state/editorOverlayState.svelte";
  import type { ShaderConfig, BufferPass, ImagePass } from "@shader-studio/types";
  import type { Transport } from "../../transport/MessageTransport";
  import BufferConfig from "./BufferConfig.svelte";
  import ScriptInfo from "./ScriptInfo.svelte";
  import type { AudioVideoController } from "../../AudioVideoController";

  type ScriptInfoProp = { filename: string; uniforms: { name: string; type: string }[]; fileExists?: boolean } | null;

  interface Props {
    config?: ShaderConfig | null;
    pathMap?: Record<string, string>;
    bufferPathMap?: Record<string, string>;
    transport: Transport;
    shaderPath?: string;
    isVisible?: boolean;
    onFileSelect?: (bufferName: string) => void;
    selectedBuffer?: string;
    isLocked?: boolean;
    audioVideoController?: AudioVideoController;
    globalMuted?: boolean;
    scriptInfo?: ScriptInfoProp;
    customUniformValues?: Record<string, number | number[] | boolean>;
    actualPollFps?: number;
    uniformActualFps?: Record<string, number>;
    onConfigChange?: (config: ShaderConfig) => void;
  }

  let {
    config = $bindable(null),
    pathMap = {},
    bufferPathMap = {},
    transport,
    shaderPath = "",
    isVisible = true,
    onFileSelect = () => {},
    selectedBuffer = "Image",
    isLocked = false,
    audioVideoController = undefined,
    globalMuted = false,
    scriptInfo = null,
    customUniformValues = {},
    actualPollFps = 0,
    uniformActualFps = {},
    onConfigChange = () => {},
  }: Props = $props();

  let configManager = $state<ConfigManager | undefined>(undefined);
  let activeTab: string = $state("Image");
  let menuTab = $state<string | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuButton = $state<HTMLButtonElement | null>(null);
  let menuTrigger = $state<HTMLButtonElement | null>(null);
  let renamingTab = $state<string | null>(null);
  let renameDraft = $state("");
  let renameError = $state<string | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);

  // Sync activeTab when parent changes selectedBuffer
  // Don't override if user is on the Script tab (it has no corresponding buffer)
  $effect(() => {
    const displayName = selectedBuffer === "common" ? "Common" : selectedBuffer;
    untrack(() => {
      if (displayName !== activeTab && activeTab !== "Script") {
        activeTab = displayName;
      }
    });
  });

  onMount(() => {
    configManager = new ConfigManager(
      transport,
      (updatedConfig) => {
        config = updatedConfig;
        onConfigChange(updatedConfig);
      }
    );
    configManager.setConfig(config);
    configManager.setPathMap(pathMap);
    configManager.setShaderPath(shaderPath);
  });

  onDestroy(() => {
    if (configManager) {
      configManager.dispose();
    }
  });

  // Update config manager when props change
  $effect(() => {
    if (!configManager) {
      return;
    }
    configManager.setConfig(config);
  });

  $effect(() => {
    if (!configManager || !pathMap) {
      return;
    }
    configManager.setPathMap(pathMap);
  });

  $effect(() => {
    if (!configManager || !shaderPath) {
      return;
    }
    configManager.setShaderPath(shaderPath);
  });

  function addCommonBuffer() {
    if (!configManager) {
      return;
    }
    const success = configManager.addCommonBuffer();
    if (success) {
      config = configManager.getConfig();
      if (config) {
        onConfigChange(config);
      }
      switchTab("Common");
    }
  }

  function addBuffer() {
    if (!configManager) {
      return;
    }
    const bufferName = configManager.addBuffer();
    if (bufferName) {
      config = configManager.getConfig();
      if (config) {
        onConfigChange(config);
      }
      switchTab(bufferName);
    }
  }

  function addScript() {
    if (!configManager) {
      return;
    }
    configManager.setScript("");
    config = configManager.getConfig();
    if (config) {
      onConfigChange(config);
    }
    switchTab("Script");
  }

  function removeScript() {
    if (!configManager) {
      return;
    }
    if (activeTab === "Script") {
      activeTab = "Image";
    }
    configManager.removeScript();
    config = configManager.getConfig();
    if (config) {
      onConfigChange(config);
    }
  }

  function handleScriptPathChange(newPath: string) {
    if (!configManager) {
      return;
    }
    configManager.setScript(newPath);
    config = configManager.getConfig();
  }

  function handleScriptPollingFpsChange(fps: number) {
    if (!config || !shaderPath) {
      return;
    }

    const updatedConfig = { ...config, scriptMaxPollingFps: fps };
    config = updatedConfig;
    const text = JSON.stringify(updatedConfig, null, 2);

    transport.postMessage({
      type: 'updateConfig',
      payload: { config: updatedConfig, text, shaderPath, skipRefresh: true },
    });
    transport.postMessage({
      type: 'updateScriptPollingRate',
      payload: { fps },
    });
  }

  function removeBuffer(bufferName: string) {
    if (bufferName === "Script") {
      if (activeTab === "Script") {
        activeTab = "Image";
      }
      removeScript();
      return;
    }
    if (bufferName === activeTab) {
      activeTab = "Image";
    }
    const actualBufferName = getActualBufferName(bufferName);
    configManager?.removeBuffer(actualBufferName);
  }

  function getActualBufferName(tabName: string): string {
    return tabName === "Common" ? "common" : tabName;
  }

  function getWebviewUri(path: string): string | undefined {
    return configManager?.getWebviewUri(path);
  }

  let availableBufferNames = $derived.by(() => {
    if (!config?.passes) {
      return [];
    }
    return Object.keys(config.passes).filter((k) => k !== "Image" && k !== "common");
  });

  // Reactive statement to ensure tabs update when config changes
  let allTabs = $derived.by(() => {
    const bufferTabs: string[] = [];
    let hasCommon = false;
    if (config?.passes) {
      for (const name of Object.keys(config.passes)) {
        if (name === "Image") {
          continue;
        }
        if (name === "common") {
          hasCommon = true;
        } else {
          bufferTabs.push(name);
        }
      }
    }
    bufferTabs.sort();
    const tabs = ["Image"];
    if (hasCommon) {
      tabs.push("Common");
    }
    tabs.push(...bufferTabs);
    if (config && config.script !== undefined) {
      tabs.push("Script");
    }
    return tabs;
  });

  function switchTab(tabName: string) {
    activeTab = tabName;
    if (tabName !== "Script") {
      const actualName = getActualBufferName(tabName);
      onFileSelect(actualName);
    }
  }

  function isRenameableTab(tabName: string): boolean {
    return tabName !== "Image" && tabName !== "Common" && tabName !== "Script";
  }

  async function openRenameMenu(
    tabName: string,
    event: MouseEvent,
    trigger: HTMLButtonElement,
  ) {
    if (!isRenameableTab(tabName)) {
      return;
    }
    event.preventDefault();
    menuTab = tabName;
    menuX = event.clientX;
    menuY = event.clientY;
    menuTrigger = trigger;
    await tick();
    menuButton?.focus();
  }

  async function handleTabKeyDown(tabName: string, event: KeyboardEvent) {
    if (!isRenameableTab(tabName) || (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))) {
      return;
    }
    event.preventDefault();
    const trigger = event.currentTarget as HTMLButtonElement;
    const bounds = trigger.getBoundingClientRect();
    menuTab = tabName;
    menuX = bounds.left;
    menuY = bounds.bottom;
    menuTrigger = trigger;
    await tick();
    menuButton?.focus();
  }

  function dismissRenameMenu(restoreTriggerFocus = false) {
    menuTab = null;
    if (restoreTriggerFocus) {
      menuTrigger?.focus();
    }
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && menuTab) {
      event.preventDefault();
      dismissRenameMenu(true);
    }
  }

  function handleWindowClick(event: MouseEvent) {
    if (menuTab && !(event.target as HTMLElement).closest(".buffer-rename-menu")) {
      dismissRenameMenu();
    }
  }

  async function startRename() {
    if (!menuTab) {
      return;
    }
    renamingTab = menuTab;
    renameDraft = menuTab;
    renameError = null;
    dismissRenameMenu();
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  function handleTabDblClick(tabName: string) {
    if (!isLocked) {
      return;
    }
    const actualName = getActualBufferName(tabName);
    if (getEditorOverlayVisible()) {
      setOverlayActiveFile(actualName);
      return;
    }
    const bufferPath = bufferPathMap[actualName];
    if (bufferPath) {
      transport.postMessage({
        type: 'navigateToBuffer',
        payload: { bufferPath, shaderPath }
      });
    }
  }

  // Reactive statement to get the current active tab's config
  // Provides default empty config when no config file exists
  let activeTabConfig = $derived.by(() => {
    const actualBufferName = getActualBufferName(activeTab);

    if (activeTab === "Image") {
      // Return actual config or default empty ImagePass
      return config?.passes?.Image || { inputs: {} };
    } else {
      // Return actual buffer config or default empty BufferPass
      return config?.passes?.[actualBufferName] || { path: "", inputs: {} };
    }
  });
</script>

<svelte:window onkeydown={handleWindowKeyDown} onclick={handleWindowClick} />

<div class="config-panel" class:visible={isVisible}>
  <div class="config-content">
    <!-- Tab Navigation - Always visible -->
    <div class="tab-navigation">
      {#each allTabs as tabName (tabName)}
        {#if renamingTab === tabName}
          <div class="tab-rename">
            <input
              class="tab-rename-input"
              type="text"
              aria-label="Rename {tabName}"
              bind:this={renameInput}
              bind:value={renameDraft}
            />
            {#if config}
              <span
                class="tab-close"
                role="button"
                tabindex="0"
                onclick={(event) => {
                  event.stopPropagation();
                  removeBuffer(tabName);
                }}
                onkeydown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    removeBuffer(tabName);
                  }
                }}
                title="Remove {tabName}"
                aria-label="Remove {tabName}"
              >
                ×
              </span>
            {/if}
            {#if renameError}
              <p class="tab-rename-error" role="alert">{renameError}</p>
            {/if}
          </div>
        {:else}
          <button
            class="tab-button {activeTab === tabName ? 'active' : ''}"
            onclick={() => switchTab(tabName)}
            ondblclick={() => handleTabDblClick(tabName)}
            oncontextmenu={(event) => openRenameMenu(tabName, event, event.currentTarget)}
            onkeydown={(event) => handleTabKeyDown(tabName, event)}
          >
            <span class="tab-label">{tabName}</span>
            {#if tabName !== "Image" && config}
              <span
                class="tab-close"
                role="button"
                tabindex="0"
                onclick={(event) => {
                  event.stopPropagation();
                  removeBuffer(tabName);
                }}
                onkeydown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    removeBuffer(tabName);
                  }
                }}
                title="Remove {tabName}"
                aria-label="Remove {tabName}"
              >
                ×
              </span>
            {/if}
          </button>
        {/if}
      {/each}

      <div class="add-tab-dropdown">
        <button class="add-tab-btn" title="Add new pass">+ New</button>
        <div class="dropdown-content">
          <button class="dropdown-item" onclick={() => addBuffer()}>Buffer</button>
          {#if !config?.passes?.common}
            <button class="dropdown-item" onclick={() => addCommonBuffer()}>Common</button>
          {/if}
          {#if !(config && config.script !== undefined)}
            <button class="dropdown-item" onclick={() => addScript()}>Script</button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      {#if activeTab === "Script"}
        <ScriptInfo
          filename={scriptInfo?.filename || config?.script || ''}
          uniforms={scriptInfo?.uniforms || []}
          uniformValues={customUniformValues}
          {uniformActualFps}
          pollingFps={config?.scriptMaxPollingFps ?? 30}
          actualFps={actualPollFps}
          onPollingFpsChange={handleScriptPollingFpsChange}
          onPathChange={handleScriptPathChange}
          suggestedPath={configManager?.generateScriptPath() || ''}
          fileExists={scriptInfo ? scriptInfo.fileExists !== false : false}
          {shaderPath}
          postMessage={(msg) => transport.postMessage(msg)}
          onMessage={(handler) => transport.onMessage(handler)}
        />
      {:else if activeTab === "Image"}
        <BufferConfig
          bufferName={activeTab}
          config={activeTabConfig}
          onUpdate={(_passName, updatedConfig) => {
            configManager?.updateImagePass(updatedConfig as ImagePass);
          }}
          {getWebviewUri}
          isImagePass={true}
          postMessage={(msg) => transport.postMessage(msg)}
          onMessage={(handler) => transport.onMessage(handler)}
          {shaderPath}
          {audioVideoController}
          {globalMuted}
          {availableBufferNames}
        />
      {:else}
        <BufferConfig
          bufferName={getActualBufferName(activeTab)}
          config={activeTabConfig}
          onUpdate={(bufferName, updatedConfig) => {
            configManager?.updateBuffer(
              bufferName,
              updatedConfig as BufferPass,
            );
          }}
          {getWebviewUri}
          suggestedPath={configManager?.generateBufferPath(getActualBufferName(activeTab)) || ''}
          postMessage={(msg) => transport.postMessage(msg)}
          onMessage={(handler) => transport.onMessage(handler)}
          {shaderPath}
          {audioVideoController}
          {globalMuted}
          {availableBufferNames}
        />
      {/if}
    </div>
  </div>
</div>

{#if menuTab}
  <div class="buffer-rename-menu" role="menu" style:left="{menuX}px" style:top="{menuY}px">
    <button bind:this={menuButton} role="menuitem" onclick={startRename}>Rename</button>
  </div>
{/if}

<style>
  .config-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--vscode-editor-background);
  }

  .config-panel.visible {
    display: flex;
  }

  .config-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .tab-navigation {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    height: auto;
    min-height: 28px;
  }

  .tab-navigation :global(.tab-button),
  .tab-navigation :global(.add-tab-btn) {
    padding: 2px 12px;
    min-height: 28px;
  }

  .tab-navigation :global(.tab-close) {
    width: 14px;
    height: 14px;
    font-size: 13px;
  }

  .tab-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
  }

  .buffer-rename-menu {
    position: fixed;
    z-index: 1000;
    min-width: 120px;
    padding: 4px;
    background: var(--vscode-menu-background);
    border: 1px solid var(--vscode-menu-border);
    box-shadow: 0 2px 8px var(--vscode-widget-shadow);
  }

  .buffer-rename-menu button {
    width: 100%;
    padding: 5px 20px;
    color: var(--vscode-menu-foreground);
    background: transparent;
    border: 0;
    text-align: left;
  }

  .buffer-rename-menu button:hover,
  .buffer-rename-menu button:focus-visible {
    color: var(--vscode-menu-selectionForeground);
    background: var(--vscode-menu-selectionBackground);
    outline: none;
  }

  .tab-rename {
    display: flex;
    align-items: center;
    min-height: 28px;
    padding: 2px 8px;
    color: var(--vscode-tab-activeForeground);
    background: var(--vscode-tab-activeBackground);
  }

  .tab-rename-input {
    width: 100px;
    min-width: 0;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-focusBorder);
  }

  .tab-rename-error {
    margin: 2px 0 0;
    color: var(--vscode-inputValidation-errorForeground);
    font-size: 11px;
  }
</style>
