<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ConfigEditor } from '../ConfigEditor';
  import type { ShaderConfig, BufferPass } from '../types/ShaderConfig';
  import BufferConfig from './BufferConfig.svelte';
  import Preview from './Preview.svelte';

  let config: ShaderConfig | null = null;
  let error: string | null = null;
  let configEditor: ConfigEditor;
  let activeTab: string = 'Image';

  onMount(() => {
    console.log('ConfigEditor component mounted');
    // Initialize the config editor with callback functions
    configEditor = new ConfigEditor(
      (newConfig) => { 
        console.log('Config updated in component:', newConfig);
        config = newConfig; 
      },
      (newError) => { 
        console.log('Error updated in component:', newError);
        error = newError; 
      }
    );
    
    configEditor.initialize();
    
    // Add a small delay to ensure VS Code API is ready
    setTimeout(() => {
      console.log('ConfigEditor initialization complete, config:', !!config);
    }, 100);
  });

  onDestroy(() => {
    if (configEditor) {
      configEditor.dispose();
    }
  });

  function addSpecificBuffer(bufferName: string) {
    console.log('Adding specific buffer:', bufferName);
    const success = configEditor?.addSpecificBuffer(bufferName);
    console.log('Add buffer success:', success);
    if (success) {
      activeTab = bufferName;
      console.log('Switched to tab:', activeTab);
    }
  }

  function removeBuffer(bufferName: string) {
    if (bufferName === activeTab) {
      activeTab = 'Image';
    }
    configEditor?.removeBuffer(bufferName);
  }

  function getAllTabs(): string[] {
    const tabs = ['Image'];
    console.log('Getting all tabs from configEditor:', configEditor);
    console.log('Config available:', !!config);
    if (config && configEditor) {
      const bufferList = configEditor.getBufferList();
      console.log('Buffer list from configEditor.getBufferList():', bufferList);
      tabs.push(...bufferList);
    }
    console.log('Final tabs array:', tabs);
    return tabs;
  }

  // Reactive statement to ensure tabs update when config changes
  $: allTabs = (() => {
    const tabs = ['Image'];
    console.log('Reactive getAllTabs - config available:', !!config);
    console.log('Reactive getAllTabs - configEditor available:', !!configEditor);
    if (config && configEditor) {
      const bufferList = configEditor.getBufferList();
      console.log('Reactive buffer list:', bufferList);
      tabs.push(...bufferList);
    }
    console.log('Reactive final tabs:', tabs);
    return tabs;
  })();

  function switchTab(tabName: string) {
    activeTab = tabName;
  }

  // Reactive statement to get the current active tab's config
  $: activeTabConfig = (() => {
    if (!configEditor || !config) return null;
    
    if (activeTab === 'Image') {
      return config.Image;
    } else {
      return configEditor.getBuffer(activeTab);
    }
  })();
</script>

<div class="config-editor">
  <div class="header">
    <h1>Shader Configuration</h1>
    <p class="subtitle">Click the "JSON" button in the status bar to edit the raw JSON directly</p>
  </div>

  {#if error}
    <div class="error">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if config}
    <div class="config-content">
      <!-- Tab Navigation -->
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
            {#if tabName !== 'Image'}
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
        
        {#if config && ['BufferA', 'BufferB', 'BufferC', 'BufferD'].some(buffer => !config![buffer as keyof ShaderConfig])}
          <div class="add-tab-dropdown">
            <button class="add-tab-btn" title="Add Buffer">
              +
            </button>
            <div class="dropdown-content">
              {#each ['BufferA', 'BufferB', 'BufferC', 'BufferD'] as bufferName}
                {#if !config || !config[bufferName as keyof ShaderConfig]}
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
        {#if activeTab === 'Image'}
          {#if activeTabConfig}
            <BufferConfig 
              bufferName={activeTab} 
              config={activeTabConfig} 
              onUpdate={(passName, updatedConfig) => {
                configEditor?.updateImagePass(updatedConfig);
              }}
              isImagePass={true}
            />
          {/if}
        {:else}
          {#if activeTabConfig && activeTab !== 'Image'}
            <BufferConfig 
              bufferName={activeTab} 
              config={activeTabConfig} 
              onUpdate={(bufferName, updatedConfig) => {
                configEditor?.updateBuffer(bufferName, updatedConfig as BufferPass);
              }} 
            />
          {/if}
        {/if}
      </div>
    </div>
  {:else if !error}
    <div class="loading">
      <div class="placeholder">
        <h2>🚧 Config Editor</h2>
        <p>Loading configuration...</p>
      </div>
    </div>
  {/if}
</div>
