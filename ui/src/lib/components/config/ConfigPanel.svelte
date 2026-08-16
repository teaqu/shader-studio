<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from "svelte";
  import { ConfigManager, type BufferRenameError } from "../../ConfigManager";
  import { getEditorOverlayVisible, setOverlayActiveFile } from "../../state/editorOverlayState.svelte";
  import { portal } from "../../actions/portal";
  import type { ShaderConfig, BufferPass, ComputePass, ImagePass, StorageBufferConfig, StorageBufferSnapshot } from "@shader-studio/types";
  import type { Transport } from "../../transport/MessageTransport";
  import BufferConfig from "./BufferConfig.svelte";
  import ScriptInfo from "./ScriptInfo.svelte";
  import StoragePanel from "./StoragePanel.svelte";
  import type { ConfigFieldErrors } from "../../config/ComputeConfigMutations";
  import type { AudioVideoController } from "../../AudioVideoController";
  import type { ShaderLanguage } from "../../engineFactory";

  type ScriptInfoProp = { filename: string; uniforms: { name: string; type: string }[]; fileExists?: boolean } | null;

  interface Props {
    config?: ShaderConfig | null;
    language?: ShaderLanguage;
    pathMap?: Record<string, string>;
    bufferPathMap?: Record<string, string>;
    bufferSources?: Record<string, string>;
    onReadStorage?: (name: string, start: number, count: number) => Promise<StorageBufferSnapshot>;
    onWriteStorage?: (name: string, start: number, data: ArrayBuffer) => Promise<void>;
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
    onOpenInNewTab?: (bufferName: string, mode: "active" | "beside") => void;
  }

  let {
    config = $bindable(null),
    language = "glsl",
    pathMap = {},
    bufferPathMap = {},
    bufferSources = {},
    onReadStorage,
    onWriteStorage,
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
    onOpenInNewTab = () => {},
  }: Props = $props();

  let configManager = $state<ConfigManager | undefined>(undefined);
  let activeTab: string = $state("Image");
  let addMenuOpen = $state(false);
  let addMenuPinned = $state(false);
  let addMenuContainer = $state<HTMLDivElement>();
  let addMenuTrigger = $state<HTMLButtonElement>();
  let addMenu = $state<HTMLDivElement>();
  let menuTab = $state<string | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuElement = $state<HTMLDivElement | null>(null);
  let menuButton = $state<HTMLButtonElement | null>(null);
  let menuTrigger = $state<HTMLButtonElement | null>(null);
  let renamingTab = $state<string | null>(null);
  let renameDraft = $state("");
  let renameError = $state<string | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);
  let tabNavigationElement = $state<HTMLDivElement | null>(null);

  // Sync activeTab when parent changes selectedBuffer
  // Don't override if user is on the Script tab (it has no corresponding buffer)
  $effect(() => {
    const displayName = selectedBuffer === "common" ? "Common" : selectedBuffer;
    untrack(() => {
      if (displayName !== activeTab && activeTab !== "Script" && activeTab !== "Storage") {
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

  function addStorageBuffer(): string | null {
    return configManager?.addStorageBuffer().name ?? null;
  }

  function applyStorageBuffer(
    originalName: string,
    name: string,
    declaration: StorageBufferConfig,
  ): ConfigFieldErrors {
    const result = configManager?.applyStorageBuffer(originalName, name, declaration);
    return result && !result.ok ? result.errors : {};
  }

  function removeStorageBuffer(name: string): ConfigFieldErrors {
    const result = configManager?.removeStorageBuffer(name);
    return result && !result.ok ? result.errors : {};
  }

  function getStorageReferences(name: string): string[] {
    return configManager?.getStorageCoverReferences(name) ?? [];
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
    if (menuTab && (!(target instanceof Element) || !target.closest(".buffer-rename-menu"))) {
      dismissRenameMenu();
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

  function isComputeTab(tabName: string): boolean {
    const pass = config?.passes?.[getActualBufferName(tabName)];
    return !!pass && 'type' in pass && pass.type === "compute";
  }

  function computeEntryPoints(passName: string): string[] {
    const source = bufferSources[passName] ?? '';
    return Array.from(source.matchAll(/\[\s*shader\s*\(\s*["']compute["']\s*\)\s*\]\s*\[\s*numthreads\s*\([^)]*\)\s*\]\s*void\s+([A-Za-z_]\w*)\s*\(/gi), (match) => match[1]!);
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
    if (language === "slang") {
      tabs.push("Storage");
    }
    if (config && config.script !== undefined) {
      tabs.push("Script");
    }
    return tabs;
  });

  function switchTab(tabName: string) {
    activeTab = tabName;
    if (tabName !== "Script" && tabName !== "Storage") {
      const actualName = getActualBufferName(tabName);
      onFileSelect(actualName);
    }
  }

  function isRenameableTab(tabName: string): boolean {
    return tabName !== "Image" && tabName !== "Common" && tabName !== "Script" && tabName !== "Storage";
  }

  function canOpenTab(tabName: string): boolean {
    return tabName !== "Storage";
  }

  async function openRenameMenu(
    tabName: string,
    event: MouseEvent,
    trigger: HTMLButtonElement,
  ) {
    if (!canOpenTab(tabName)) {
      return;
    }
    event.preventDefault();
    menuTab = tabName;
    menuX = event.clientX;
    menuY = event.clientY;
    menuTrigger = trigger;
    await tick();
    clampMenuPosition();
    menuButton?.focus();
  }

  async function handleTabKeyDown(tabName: string, event: KeyboardEvent) {
    if (!canOpenTab(tabName) || (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))) {
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
    clampMenuPosition();
    menuButton?.focus();
  }

  function clampMenuPosition() {
    if (!menuElement) {
      return;
    }
    const bounds = menuElement.getBoundingClientRect();
    menuX = Math.max(0, Math.min(menuX, window.innerWidth - bounds.width));
    menuY = Math.max(0, Math.min(menuY, window.innerHeight - bounds.height));
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

  function handleWindowContextMenu() {
    if (menuTab) {
      dismissRenameMenu();
    }
  }

  function handleWindowFocusOut(event: FocusEvent) {
    const nextFocusTarget = event.relatedTarget as Node | null;
    if (menuTab && !menuElement?.contains(nextFocusTarget)) {
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

  function handleOpenTab() {
    if (!menuTab) {
      return;
    }
    let actualName: string;
    if (menuTab === "Script" && scriptInfo?.filename) {
      actualName = scriptInfo.filename;
    } else {
      actualName = getActualBufferName(menuTab);
    }
    dismissRenameMenu();
    if (getEditorOverlayVisible()) {
      setOverlayActiveFile(actualName);
    } else {
      onOpenInNewTab(actualName, "active");
    }
  }

  async function focusTab(tabName: string) {
    await tick();
    Array.from(tabNavigationElement?.querySelectorAll<HTMLButtonElement>("button.tab-button") ?? []).find(
      (tab) => tab.dataset.tabName === tabName,
    )?.focus();
  }

  function cancelRename() {
    renamingTab = null;
    renameDraft = "";
    renameError = null;
  }

  function getRenameErrorMessage(error: BufferRenameError): string {
    const messages: Record<BufferRenameError, string> = {
      "config-unavailable": "Configuration is unavailable",
      "source-not-found": "This pass no longer exists",
      "same-name": "Name is unchanged",
      "reserved-name": "That pass name is reserved",
      "invalid-identifier": "Enter a valid pass name",
      "name-taken": "That pass name is already in use",
    };
    return messages[error];
  }

  function commitRename(restoreFocus = false) {
    const oldName = renamingTab;
    if (!oldName) {
      return;
    }

    const newName = renameDraft.trim();
    if (!newName || newName === oldName) {
      cancelRename();
      if (restoreFocus) {
        void focusTab(oldName);
      }
      return;
    }

    const manager = configManager;
    if (!manager) {
      renameError = getRenameErrorMessage("config-unavailable");
      return;
    }

    const validationError = manager.validateBufferRename(oldName, newName);
    if (validationError) {
      renameError = getRenameErrorMessage(validationError);
      return;
    }

    if (!manager.renameBuffer(oldName, newName)) {
      renameError = "Unable to rename this pass";
      return;
    }

    const renamedActiveTab = activeTab === oldName;
    cancelRename();
    if (renamedActiveTab) {
      activeTab = newName;
      onFileSelect(newName);
    }
    if (restoreFocus) {
      void focusTab(newName);
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      const tabName = renamingTab;
      cancelRename();
      if (tabName) {
        void focusTab(tabName);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void commitRename(true);
    }
  }

  function handleRenameInput() {
    renameError = null;
  }

  function handleTabDblClick(tabName: string) {
    if (tabName === "Script") {
      if (!scriptInfo?.filename) {
        return;
      }
      const scriptPath = scriptInfo.filename;
      if (getEditorOverlayVisible()) {
        setOverlayActiveFile(scriptPath);
      } else {
        onOpenInNewTab(scriptPath, "active");
      }
      return;
    }
    const actualName = getActualBufferName(tabName);
    if (getEditorOverlayVisible()) {
      setOverlayActiveFile(actualName);
    } else {
      onOpenInNewTab(actualName, "active");
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

<svelte:window
  onkeydown={handleWindowKeyDown}
  onclick={handleWindowClick}
  oncontextmenu={handleWindowContextMenu}
  onfocusout={handleWindowFocusOut}
/>

<div class="config-panel" class:visible={isVisible}>
  <div class="config-content">
    <!-- Tab Navigation - Always visible -->
    <div class="tab-navigation" bind:this={tabNavigationElement}>
      {#each allTabs as tabName (tabName)}
        {#if renamingTab === tabName}
          <div class="tab-rename" class:active={activeTab === tabName}>
            <input
              class="tab-rename-input"
              type="text"
              aria-label="Rename {tabName}"
              aria-invalid={renameError ? "true" : undefined}
              aria-describedby={renameError ? "tab-rename-error" : undefined}
              bind:this={renameInput}
              bind:value={renameDraft}
              oninput={handleRenameInput}
              onkeydown={handleRenameKeyDown}
              onblur={() => commitRename()}
            />
            {#if renameError}
              <p id="tab-rename-error" class="tab-rename-error" role="alert">{renameError}</p>
            {/if}
          </div>
        {:else}
          <button
            class="tab-button {activeTab === tabName ? 'active' : ''}"
            data-tab-name={tabName}
            onclick={() => switchTab(tabName)}
            ondblclick={() => handleTabDblClick(tabName)}
            oncontextmenu={(event) => {
              if (canOpenTab(tabName)) {
                event.stopPropagation();
                openRenameMenu(tabName, event, event.currentTarget);
              }
            }}
            onkeydown={(event) => handleTabKeyDown(tabName, event)}
          >
            <span class="tab-label">{tabName}</span>
            {#if tabName !== "Image" && tabName !== "Storage" && config}
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
              >Compute</button>
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
      {:else if activeTab === "Storage"}
        <StoragePanel
          storage={config?.storage ?? {}}
          referencesFor={getStorageReferences}
          onAdd={addStorageBuffer}
          onApply={applyStorageBuffer}
          onDelete={removeStorageBuffer}
          onRead={onReadStorage}
          onWrite={onWriteStorage}
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
          {onOpenInNewTab}
        />
      {:else}
        <BufferConfig
          bufferName={getActualBufferName(activeTab)}
          config={activeTabConfig}
          {language}
          passType={isComputeTab(activeTab) ? 'compute' : 'render'}
          onUpdate={(bufferName, updatedConfig) => {
            if (isComputeTab(activeTab)) {
              configManager?.updateComputePass(bufferName, updatedConfig as ComputePass);
            } else {
              configManager?.updateBuffer(bufferName, updatedConfig as BufferPass);
            }
          }}
          {getWebviewUri}
          suggestedPath={configManager?.generateBufferPath(
            getActualBufferName(activeTab),
            language === 'slang' ? 'slang' : 'glsl',
          ) || ''}
          postMessage={(msg) => transport.postMessage(msg)}
          onMessage={(handler) => transport.onMessage(handler)}
          {shaderPath}
          {audioVideoController}
          {globalMuted}
          {availableBufferNames}
          storageNames={Object.keys(config?.storage ?? {})}
          entryPointNames={computeEntryPoints(getActualBufferName(activeTab))}
          onComputeCommit={(nextConfig) => {
            const result = configManager?.updateComputePass(getActualBufferName(activeTab), nextConfig);
            return result && !result.ok ? result.errors : {};
          }}
          {onOpenInNewTab}
        />
      {/if}
    </div>
  </div>
</div>

{#if menuTab}
  <div use:portal bind:this={menuElement} class="buffer-rename-menu" role="menu" style:left="{menuX}px" style:top="{menuY}px">
    <button bind:this={menuButton} role="menuitem" onclick={handleOpenTab}>Open</button>
    {#if isRenameableTab(menuTab)}
      <button role="menuitem" onclick={startRename}>Rename</button>
    {/if}
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
    color: var(--vscode-tab-inactiveForeground);
    background: var(--vscode-tab-inactiveBackground);
  }

  .tab-rename.active {
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
