<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { ConfigManager } from "../../ConfigManager";
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
    console.log("ConfigPanel component mounted");
    configManager = new ConfigManager(
      transport,
      (updatedConfig) => {
        console.log("Config updated in component:", updatedConfig);
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
    if (!configManager) return;
    configManager.setConfig(config);
  });

  $effect(() => {
    if (!configManager || !pathMap) return;
    configManager.setPathMap(pathMap);
  });

  $effect(() => {
    if (!configManager || !shaderPath) return;
    configManager.setShaderPath(shaderPath);
  });

  function addCommonBuffer() {
    const success = configManager?.addCommonBuffer();
    if (success) {
      config = configManager.getConfig();
      if (config) {
        onConfigChange(config);
      }
      switchTab("Common");
    }
  }

  function addBuffer() {
    const bufferName = configManager?.addBuffer();
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

  // Reactive statement to ensure tabs update when config changes
  let allTabs = $derived.by(() => {
    const tabs = ["Image"];
    if (config?.passes) {
      for (const name of Object.keys(config.passes)) {
        if (name === "Image") {
          continue;
        }
        tabs.push(name === "common" ? "Common" : name);
      }
    }
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
              onclick={(e) => { e.stopPropagation(); removeBuffer(tabName); }}
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
