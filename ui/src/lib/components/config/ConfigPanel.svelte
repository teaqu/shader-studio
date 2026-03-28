<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ConfigManager } from "../../ConfigManager";
  import type { ShaderConfig, BufferPass, ImagePass } from "@shader-studio/types";
  import type { Transport } from "../../transport/MessageTransport";
  import BufferConfig from "./BufferConfig.svelte";
  import ScriptInfo from "./ScriptInfo.svelte";

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
  export let scriptInfo: { filename: string; uniforms: { name: string; type: string }[]; fileExists?: boolean } | null = null;
  export let customUniformValues: Record<string, number | number[] | boolean> = {};
  export let actualPollFps: number = 0;
  export let uniformActualFps: Record<string, number> = {};

  let configManager: ConfigManager;
  let activeTab: string = "Image";

  // Sync activeTab when parent changes selectedBuffer
  // Don't override if user is on the Script tab (it has no corresponding buffer)
  $: {
    const displayName = selectedBuffer === "common" ? "Common" : selectedBuffer;
    if (displayName !== activeTab && activeTab !== "Script") {
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
  $: if (configManager) {
    configManager.setConfig(config);
  }

  $: if (configManager && pathMap) {
    configManager.setPathMap(pathMap);
  }

  $: if (configManager && shaderPath) {
    configManager.setShaderPath(shaderPath);
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

  function addScript() {
    if (!configManager) return;
    configManager.setScript("");
    config = configManager.getConfig();
    switchTab("Script");
  }

  function removeScript() {
    if (!configManager) return;
    if (activeTab === "Script") {
      activeTab = "Image";
    }
    configManager.removeScript();
    config = configManager.getConfig();
  }

  function handleScriptPathChange(newPath: string) {
    if (!configManager) return;
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

  // Reactive statement to ensure tabs update when config changes
  $: allTabs = (() => {
    const tabs = ["Image"];
    if (config?.passes) {
      for (const name of Object.keys(config.passes)) {
        if (name === "Image") continue;
        tabs.push(name === "common" ? "Common" : name);
      }
    }
    if (config && config.script !== undefined) {
      tabs.push("Script");
    }
    return tabs;
  })();

  function switchTab(tabName: string) {
    activeTab = tabName;
    if (tabName !== "Script") {
      const actualName = getActualBufferName(tabName);
      onFileSelect(actualName);
    }
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
              tabindex="0"
              on:click|stopPropagation={() => removeBuffer(tabName)}
              on:keydown={(event) => {
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

      <div class="add-tab-dropdown">
        <button class="add-tab-btn" title="Add new pass">+ New</button>
        <div class="dropdown-content">
          <button class="dropdown-item" on:click={() => addBuffer()}>Buffer</button>
          {#if !config?.passes?.common}
            <button class="dropdown-item" on:click={() => addCommonBuffer()}>Common</button>
          {/if}
          {#if !(config && config.script !== undefined)}
            <button class="dropdown-item" on:click={() => addScript()}>Script</button>
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
