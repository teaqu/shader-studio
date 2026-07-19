<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from "svelte";
  import { ConfigManager } from "../../ConfigManager";
  import { getEditorOverlayVisible, setOverlayActiveFile } from "../../state/editorOverlayState.svelte";
  import type { ShaderConfig, BufferPass, ImagePass } from "@shader-studio/types";
  import type { Transport } from "../../transport/MessageTransport";
  import BufferConfig from "./BufferConfig.svelte";
  import ScriptInfo from "./ScriptInfo.svelte";
  import type { AudioVideoController } from "../../AudioVideoController";
  import type { ShaderLanguage } from "../../engineFactory";

  type ScriptInfoProp = { filename: string; uniforms: { name: string; type: string }[]; fileExists?: boolean } | null;

  interface Props {
    config?: ShaderConfig | null;
    language?: ShaderLanguage;
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
    language = "glsl",
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
  let addMenuOpen = $state(false);
  let addMenuPinned = $state(false);
  let addMenuContainer = $state<HTMLDivElement>();
  let addMenuTrigger = $state<HTMLButtonElement>();
  let addMenu = $state<HTMLDivElement>();

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

  function addComputePass() {
    if (!configManager) {
      return;
    }
    const computePassName = configManager.addComputePass();
    if (computePassName) {
      config = configManager.getConfig();
      switchTab(computePassName);
    }
  }

  function closeAddMenu() {
    addMenuOpen = false;
    addMenuPinned = false;
  }

  async function closeAddMenuAndRestoreFocus() {
    closeAddMenu();
    await tick();
    addMenuTrigger?.focus();
  }

  async function runAddMenuAction(action: () => void) {
    action();
    await closeAddMenuAndRestoreFocus();
  }

  async function handleAddMenuTriggerClick() {
    if (addMenuPinned) {
      await closeAddMenuAndRestoreFocus();
      return;
    }

    addMenuPinned = true;
    addMenuOpen = true;
  }

  async function handleAddMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && addMenuOpen) {
      event.preventDefault();
      await closeAddMenuAndRestoreFocus();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    if (!addMenuOpen) {
      addMenuOpen = true;
      await tick();
    }

    const items = Array.from(addMenu?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex === -1
      ? (direction === 1 ? 0 : items.length - 1)
      : (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  }

  function handleAddMenuMouseLeave() {
    const activeElement = document.activeElement;
    const menuItemHasFocus = activeElement instanceof HTMLElement
      && activeElement.matches("[role='menuitem']")
      && addMenu?.contains(activeElement);
    if (!addMenuPinned && !menuItemHasFocus) {
      closeAddMenu();
    }
  }

  function handleAddMenuFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !addMenuContainer?.contains(nextTarget)) {
      closeAddMenu();
    }
  }

  function handleWindowClick(event: MouseEvent) {
    const target = event.target;
    if (addMenuOpen && target instanceof Node && !addMenuContainer?.contains(target)) {
      closeAddMenu();
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

<svelte:window onclick={handleWindowClick} />

<div class="config-panel" class:visible={isVisible}>
  <div class="config-content">
    <!-- Tab Navigation - Always visible -->
    <div class="tab-navigation">
      {#each allTabs as tabName}
        <button
          class="tab-button {activeTab === tabName ? 'active' : ''}"
          onclick={() => switchTab(tabName)}
          ondblclick={() => handleTabDblClick(tabName)}
        >
          <span class="tab-label">{tabName}</span>
          {#if tabName !== "Image" && config}
            <span
              class="tab-close"
              role="button"
              tabindex="0"
              onclick={(e) => {
                e.stopPropagation(); removeBuffer(tabName); 
              }}
              onkeydown={(event) => {
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
      {/each}

      <div
        class="add-tab-dropdown"
        role="toolbar"
        aria-label="Add pass"
        tabindex="-1"
        bind:this={addMenuContainer}
        onmouseenter={() => addMenuOpen = true}
        onmouseleave={handleAddMenuMouseLeave}
        onfocusout={handleAddMenuFocusOut}
        onkeydown={handleAddMenuKeydown}
      >
        <button
          class="add-tab-btn"
          title="Add new pass"
          aria-haspopup="menu"
          aria-expanded={addMenuOpen}
          aria-controls="add-pass-menu"
          bind:this={addMenuTrigger}
          onclick={handleAddMenuTriggerClick}
        >+ New</button>
        {#if addMenuOpen}
          <div
            class="dropdown-content"
            id="add-pass-menu"
            role="menu"
            bind:this={addMenu}
          >
            <button class="dropdown-item" role="menuitem" onclick={() => runAddMenuAction(addBuffer)}>Buffer</button>
            {#if language === "slang"}
              <button
                class="dropdown-item"
                role="menuitem"
                aria-label="Add compute pass"
                onclick={() => runAddMenuAction(addComputePass)}
              >+ Compute</button>
            {/if}
            {#if !config?.passes?.common}
              <button class="dropdown-item" role="menuitem" onclick={() => runAddMenuAction(addCommonBuffer)}>Common</button>
            {/if}
            {#if !(config && config.script !== undefined)}
              <button class="dropdown-item" role="menuitem" onclick={() => runAddMenuAction(addScript)}>Script</button>
            {/if}
          </div>
        {/if}
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
</style>
