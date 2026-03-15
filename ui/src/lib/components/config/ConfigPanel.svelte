<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ConfigManager } from "../../ConfigManager";
  import type { ShaderConfig, BufferPass, ImagePass } from "@shader-studio/types";
  import type { Transport } from "../../transport/MessageTransport";
  import BufferConfig from "./BufferConfig.svelte";

  export let config: ShaderConfig | null = null;
  export let pathMap: Record<string, string> = {};
  export let bufferPathMap: Record<string, string> = {};
  export let transport: Transport;
  export let shaderPath: string = "";
  export let isVisible: boolean = true;
  export let onFileSelect: (bufferName: string) => void = () => {};
  export let selectedBuffer: string = "Image";
  export let isLocked: boolean = false;
  import type { AudioVideoController } from "../../AudioVideoController";
  export let audioVideoController: AudioVideoController | undefined = undefined;
  export let globalMuted: boolean = false;

  let configManager: ConfigManager;
  let activeTab: string = "Image";

  // Sync activeTab when parent changes selectedBuffer
  $: {
    const displayName = selectedBuffer === "common" ? "Common" : selectedBuffer;
    if (displayName !== activeTab) {
      activeTab = displayName;
    }
  }

  onMount(() => {
    console.log("ConfigPanel component mounted");
    // Initialize the config manager with transport and callback
    configManager = new ConfigManager(
      transport,
      (updatedConfig) => {
        console.log("Config updated in component:", updatedConfig);
        // Update will be handled by parent via transport messages
      }
    );
  });

  onDestroy(() => {
    if (configManager) {
      configManager.dispose();
    }
  });

  // Update config manager when props change
  $: if (configManager && config) {
    configManager.setConfig(config);
  }

  $: if (configManager && pathMap) {
    configManager.setPathMap(pathMap);
  }

  $: if (configManager && shaderPath) {
    configManager.setShaderPath(shaderPath);
  }

  function handleCreateFile(bufferName: string) {
    if (!configManager) return;
    const filePath = configManager.generateBufferPath(bufferName);
    if (!filePath) return;

    // Update the buffer path in config
    configManager.updateBufferPath(bufferName, filePath);

    // Send message to extension to create the file
    configManager.createBufferFile(bufferName, filePath);
  }

  function addCommonBuffer() {
    const success = configManager?.addCommonBuffer();
    if (success) {
      config = configManager.getConfig();
      switchTab("Common");
    }
  }

  function addBuffer() {
    const bufferName = configManager?.addBuffer();
    if (bufferName) {
      config = configManager.getConfig();
      switchTab(bufferName);
    }
  }

  function removeBuffer(bufferName: string) {
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

  // Reactive statement to ensure tabs update when config changes
  $: allTabs = (() => {
    const tabs = ["Image"];
    if (config?.passes) {
      for (const name of Object.keys(config.passes)) {
        if (name === "Image") continue;
        tabs.push(name === "common" ? "Common" : name);
      }
    }
    return tabs;
  })();

  function switchTab(tabName: string) {
    activeTab = tabName;
    const actualName = getActualBufferName(tabName);
    onFileSelect(actualName);
  }

  function handleTabDblClick(tabName: string) {
    if (!isLocked) return;
    const actualName = getActualBufferName(tabName);
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
  $: activeTabConfig = (() => {
    const actualBufferName = getActualBufferName(activeTab);

    if (activeTab === "Image") {
      // Return actual config or default empty ImagePass
      return config?.passes?.Image || { inputs: {} };
    } else {
      // Return actual buffer config or default empty BufferPass
      return config?.passes?.[actualBufferName] || { path: "", inputs: {} };
    }
  })();
</script>

<div class="config-panel" class:visible={isVisible}>
  <div class="config-content">
    <!-- Tab Navigation - Always visible -->
    <div class="tab-navigation">
      {#each allTabs as tabName}
        <button
          class="tab-button {activeTab === tabName ? 'active' : ''}"
          on:click={() => switchTab(tabName)}
          on:dblclick={() => handleTabDblClick(tabName)}
        >
          <span class="tab-label">{tabName}</span>
          {#if tabName !== "Image" && config}
            <span
              class="tab-close"
              role="button"
              tabindex="-1"
              on:click|stopPropagation={() => removeBuffer(tabName)}
              title="Remove {tabName}"
            >
              ×
            </span>
          {/if}
        </button>
      {/each}

      <div class="add-tab-dropdown">
        <button class="add-tab-btn" title="Add new pass">+ New</button>
        <div class="dropdown-content">
          <button class="dropdown-item" on:click={() => addBuffer()}>Buffer</button>
          {#if !config?.passes?.common}
            <button class="dropdown-item" on:click={() => addCommonBuffer()}>Common</button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      {#if activeTab === "Image"}
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
          onCreateFile={handleCreateFile}
          suggestedPath={configManager?.generateBufferPath(getActualBufferName(activeTab)) || ''}
          postMessage={(msg) => transport.postMessage(msg)}
          onMessage={(handler) => transport.onMessage(handler)}
          {shaderPath}
          {audioVideoController}
          {globalMuted}
        />
      {/if}
    </div>
  </div>
</div>

<style>
  .config-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--vscode-editor-background);
  }

  .config-panel.visible {
    display: flex;
  }
</style>
