<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ConfigManager } from "../../ConfigManager";
  import type { ShaderConfig, BufferPass } from "@shader-studio/types";
  import type { Transport } from "../../transport/MessageTransport";
  import BufferConfig from "./BufferConfig.svelte";

  export let config: ShaderConfig | null = null;
  export let pathMap: Record<string, string> = {};
  export let transport: Transport;
  export let isVisible: boolean = true;

  let configManager: ConfigManager;
  let activeTab: string = "Image";

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
    if (config && configManager) {
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
  }

  // Reactive statement to get the current active tab's config
  $: activeTabConfig = (() => {
    if (!configManager || !config) return null;

    const actualBufferName = getActualBufferName(activeTab);

    if (activeTab === "Image") {
      return config.passes.Image;
    } else {
      return configManager.getBuffer(actualBufferName);
    }
  })();
</script>

<div class="config-panel" class:visible={isVisible}>
  {#if config}
    <div class="config-content">
      <!-- Tab Navigation -->
      <div class="tab-navigation">
        {#each allTabs as tabName}
          <div class="tab-wrapper">
            <button
              class="tab-button {activeTab === tabName ? 'active' : ''}"
              on:click={() => switchTab(tabName)}
            >
              {tabName}
            </button>
            {#if tabName !== "Image"}
              <button
                class="remove-tab-btn"
                on:click={() => removeBuffer(tabName)}
                title="Remove {tabName}"
              >
                ×
              </button>
            {/if}
          </div>
        {/each}

        {#if config && (["BufferA", "BufferB", "BufferC", "BufferD"].some((buffer) => !config?.passes[buffer as keyof typeof config.passes]) || !config?.passes.common)}
          <div class="add-tab-dropdown">
            <button class="add-tab-btn" title="Add Buffer">Add Buffer</button>
            <div class="dropdown-content">
              {#if !config?.passes.common}
                <button
                  class="dropdown-item"
                  on:click={() => addCommonBuffer()}
                >
                  Common
                </button>
              {/if}
              {#each ["BufferA", "BufferB", "BufferC", "BufferD"] as bufferName}
                {#if !config?.passes[bufferName as keyof typeof config.passes]}
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
        {#if activeTabConfig}
          {#if activeTab === "Image"}
            <BufferConfig
              bufferName={activeTab}
              config={activeTabConfig}
              onUpdate={(passName, updatedConfig) => {
                configManager?.updateImagePass(updatedConfig);
              }}
              {getWebviewUri}
              isImagePass={true}
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
            />
          {/if}
        {/if}
      </div>
    </div>
  {:else}
    <div class="loading">
      <div class="placeholder">
        <p>No configuration available</p>
        <p class="hint">Open a shader file to view its configuration</p>
      </div>
    </div>
  {/if}
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

  .loading {
    padding: 20px;
    text-align: center;
  }

  .placeholder {
    color: var(--vscode-descriptionForeground);
  }

  .hint {
    font-size: 0.9em;
    margin-top: 8px;
    opacity: 0.7;
  }
</style>
