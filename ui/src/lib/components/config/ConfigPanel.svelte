<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ConfigManager } from "../../ConfigManager";
  import type { ShaderConfig, BufferPass } from "@shader-studio/types";
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
    console.log("Adding Common buffer");
    const success = configManager?.addCommonBuffer();
    console.log("Add Common buffer success:", success);
    if (success) {
      activeTab = "Common";
      console.log("Switched to tab:", activeTab);
    }
  }

  function addSpecificBuffer(bufferName: string) {
    console.log("Adding specific buffer:", bufferName);
    const success = configManager?.addSpecificBuffer(bufferName);
    console.log("Add buffer success:", success);
    if (success) {
      activeTab = bufferName;
      console.log("Switched to tab:", activeTab);
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
    console.log("Reactive getAllTabs - config available:", !!config);
    console.log(
      "Reactive getAllTabs - configManager available:",
      !!configManager,
    );
    // Always show at least the Image tab, even without config
    if (configManager) {
      const bufferList = configManager.getBufferList();
      console.log("Reactive buffer list:", bufferList);
      // Add common after Image, then other buffers
      const commonBuffer = bufferList.find(buffer => buffer === "common");
      const otherBuffers = bufferList.filter(buffer => buffer !== "common");
      if (commonBuffer) {
        tabs.push("Common"); // Add Common tab after Image
      }
      tabs.push(...otherBuffers);
    }
    console.log("Reactive final tabs:", tabs);
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
      return config?.passes?.Image || { path: "", inputs: {} };
    } else {
      // Return actual buffer config or default empty BufferPass
      return config?.passes?.[actualBufferName as keyof typeof config.passes] || { path: "", inputs: {} };
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

      {#if (!config || (["BufferA", "BufferB", "BufferC", "BufferD"].some((buffer) => !config?.passes[buffer as keyof typeof config.passes]) || !config?.passes.common))}
        <div class="add-tab-dropdown">
          <button class="add-tab-btn" title="Add Buffer">Add Buffer</button>
          <div class="dropdown-content">
            {#if !config?.passes?.common}
              <button
                class="dropdown-item"
                on:click={() => addCommonBuffer()}
              >
                Common
              </button>
            {/if}
            {#each ["BufferA", "BufferB", "BufferC", "BufferD"] as bufferName}
              {#if !config?.passes?.[bufferName as keyof typeof config.passes]}
                <button
                  class="dropdown-item"
                  on:click={() => addSpecificBuffer(bufferName)}
                >
                  {bufferName}
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      {#if activeTab === "Image"}
        <BufferConfig
          bufferName={activeTab}
          config={activeTabConfig}
          onUpdate={(_passName, updatedConfig) => {
            configManager?.updateImagePass(updatedConfig);
          }}
          {getWebviewUri}
          isImagePass={true}
          postMessage={(msg) => transport.postMessage(msg)}
          {shaderPath}
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
          {shaderPath}
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
