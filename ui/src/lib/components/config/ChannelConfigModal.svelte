<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";
  import ChannelPreview from "./ChannelPreview.svelte";
  import AssetBrowser from "./AssetBrowser.svelte";
  import {
    TEXTURE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    AUDIO_EXTENSIONS,
    CUBEMAP_EXTENSIONS,
    VOLUME_EXTENSIONS,
  } from "../../constants/assetExtensions";
  import { getWaveformPeaks } from "../../util/waveformCache";

  export let isOpen: boolean;
  export let channelName: string;
  export let channelInput: ConfigInput | undefined;
  export let getWebviewUri: (path: string) => string | undefined;
  export let onClose: () => void;
  export let onSave: (channelName: string, input: ConfigInput) => void;
  export let onRemove: (channelName: string) => void;
  export let onRename: ((oldName: string, newName: string) => void) | undefined = undefined;
  export let existingChannelNames: string[] = [];
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;
  export let shaderPath: string = "";
  export let onVideoControl: ((path: string, action: string) => void) | undefined = undefined;
  export let getVideoState: ((path: string) => { paused: boolean; muted: boolean; currentTime: number; duration: number } | null) | undefined = undefined;
  export let onAudioControl: ((path: string, action: string) => void) | undefined = undefined;
  export let getAudioState: ((path: string) => { paused: boolean; muted: boolean; currentTime: number; duration: number } | null) | undefined = undefined;
  export let getAudioFFT: ((type: string, path?: string) => Uint8Array | null) | undefined = undefined;

  let editingName = false;
  let nameInput = "";
  let nameError = "";

  type TabName = "Misc" | "Textures" | "Cubemaps" | "Volumes" | "Videos" | "Music";
  const TABS: TabName[] = ["Misc", "Textures", "Cubemaps", "Volumes", "Videos", "Music"];

  let modalContent: HTMLElement;
  let tempInput: ConfigInput | undefined;
  let initializedWithInput: ConfigInput | undefined = undefined;
  let activeTab: TabName | null = null;

  // Map input types to tabs
  function typeToTab(type: string | undefined): TabName | null {
    switch (type) {
      case "buffer":
      case "keyboard":
        return "Misc";
      case "texture":
        return "Textures";
      case "cubemap":
        return "Cubemaps";
      case "volume":
        return "Volumes";
      case "video":
        return "Videos";
      case "audio":
        return "Music";
      default:
        return null;
    }
  }

  // Initialize temp input ONLY when modal first opens
  $: {
    if (isOpen) {
      if (channelInput !== initializedWithInput) {
        initializedWithInput = channelInput;
        if (channelInput) {
          tempInput = { ...channelInput };
          activeTab = typeToTab(channelInput.type);
        } else {
          tempInput = undefined;
          activeTab = null;
        }
      }
    } else {
      initializedWithInput = undefined;
      activeTab = null;
      editingName = false;
      nameError = "";
    }
  }

  // When parent config updates with resolved_path, merge it into tempInput
  $: if (isOpen && tempInput && channelInput && 'resolved_path' in channelInput) {
    const parentResolved = (channelInput as any).resolved_path;
    const parentPath = 'path' in channelInput ? channelInput.path : undefined;
    const tempPath = 'path' in tempInput ? tempInput.path : undefined;
    if (parentResolved && parentPath === tempPath && (tempInput as any).resolved_path !== parentResolved) {
      tempInput = { ...tempInput, resolved_path: parentResolved } as ConfigInput;
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".modal-content")) {
      onClose();
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && isOpen) {
      onClose();
    }
  }

  function handleRemove() {
    onRemove(channelName);
  }

  async function startRename() {
    nameInput = channelName;
    nameError = "";
    editingName = true;
    await tick();
    const input = modalContent?.querySelector('.name-input') as HTMLInputElement;
    input?.focus();
    input?.select();
  }

  function cancelRename() {
    editingName = false;
    nameError = "";
  }

  function submitRename() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === channelName) {
      cancelRename();
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      nameError = "Must be a valid GLSL identifier";
      return;
    }
    if (existingChannelNames.includes(trimmed)) {
      nameError = "Name already in use";
      return;
    }
    if (onRename) {
      onRename(channelName, trimmed);
    }
    editingName = false;
    nameError = "";
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelRename();
    }
  }

  function autoSave() {
    if (tempInput) {
      onSave(channelName, tempInput);
    }
  }

  function selectTab(tab: TabName) {
    activeTab = tab;
    // If the current tempInput type doesn't match the tab, create a default
    const currentTab = typeToTab(tempInput?.type);
    if (currentTab !== tab) {
      switch (tab) {
        case "Misc":
          // Default to buffer when switching to Misc
          tempInput = { type: "buffer", source: "BufferA" };
          break;
        case "Textures":
          tempInput = { type: "texture", path: "" };
          break;
        case "Cubemaps":
          tempInput = { type: "cubemap", source: "CubeA" };
          break;
        case "Volumes":
          tempInput = { type: "volume", path: "" };
          break;
        case "Videos":
          tempInput = { type: "video", path: "" };
          break;
        case "Music":
          tempInput = { type: "audio", path: "" };
          break;
      }
      autoSave();
    }
  }

  function updateInputType(newType: string) {
    if (newType === "buffer") {
      tempInput = { type: "buffer", source: "BufferA" };
    } else if (newType === "texture") {
      tempInput = { type: "texture", path: "" };
    } else if (newType === "video") {
      tempInput = { type: "video", path: "" };
    } else if (newType === "audio") {
      tempInput = { type: "audio", path: "" };
    } else if (newType === "cubemap") {
      tempInput = { type: "cubemap", source: "CubeA" };
    } else if (newType === "volume") {
      tempInput = { type: "volume", path: "" };
    } else {
      tempInput = { type: "keyboard" };
    }
    autoSave();
  }

  function updateBufferSource(source: "BufferA" | "BufferB" | "BufferC" | "BufferD") {
    if (tempInput && tempInput.type === "buffer") {
      tempInput = { ...tempInput, source };
      autoSave();
    }
  }

  function updatePath(path: string) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video" || tempInput.type === "audio" || tempInput.type === "volume")) {
      const cleanPath = extractOriginalPath(path);
      const { resolved_path, startTime, endTime, ...rest } = tempInput as any;
      // Keep startTime/endTime only if the path hasn't changed (non-audio types don't have them)
      const isPathChange = 'path' in tempInput && (tempInput as any).path !== cleanPath;
      const preserveTimes = tempInput.type === "audio" && !isPathChange;
      const updated: any = { ...rest, path: cleanPath };
      if (preserveTimes) {
        if (startTime != null) updated.startTime = startTime;
        if (endTime != null) updated.endTime = endTime;
      }
      tempInput = updated as ConfigInput;
      autoSave();
    }
  }

  function extractOriginalPath(path: string): string {
    if (path.includes('vscode-resource') || path.includes('vscode-cdn')) {
      try {
        const match = path.match(/vscode-[^/]+\.net(\/.*?)(?:[?#]|$)/);
        if (match && match[1]) {
          return decodeURIComponent(match[1]);
        }
        const decoded = decodeURIComponent(path);
        const pathMatch = decoded.match(/([A-Za-z]:[\\\/]|\/)[^?#]*/);
        if (pathMatch) {
          return pathMatch[0];
        }
      } catch (e) {
        console.warn('Failed to extract path from webview URI:', e);
      }
    }
    return path;
  }

  let lastSelectedResolvedUri: string = '';

  function handleAssetSelect(path: string, resolvedUri?: string) {
    if (resolvedUri) {
      lastSelectedResolvedUri = resolvedUri;
    }
    updatePath(path);
  }

  function updateFilter(filter: "linear" | "nearest" | "mipmap") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video" || tempInput.type === "volume")) {
      tempInput = { ...tempInput, filter };
      autoSave();
    }
  }

  function updateWrap(wrap: "repeat" | "clamp") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video" || tempInput.type === "volume")) {
      tempInput = { ...tempInput, wrap };
      autoSave();
    }
  }

  function updateVFlip(vflip: boolean) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = { ...tempInput, vflip };
      autoSave();
    }
  }

  function updateStartTime(value: string, save: boolean = true) {
    if (tempInput && tempInput.type === "audio") {
      const num = parseFloat(value);
      if (value === "" || isNaN(num)) {
        const { startTime, ...rest } = tempInput as any;
        tempInput = { ...rest } as ConfigInput;
      } else {
        tempInput = { ...tempInput, startTime: Math.max(0, num) };
      }
      if (save) autoSave();
    }
  }

  function updateEndTime(value: string, save: boolean = true) {
    if (tempInput && tempInput.type === "audio") {
      const num = parseFloat(value);
      if (value === "" || isNaN(num)) {
        const { endTime, ...rest } = tempInput as any;
        tempInput = { ...rest } as ConfigInput;
      } else {
        tempInput = { ...tempInput, endTime: Math.max(0, num) };
      }
      if (save) autoSave();
    }
  }

  function updateGrayscale(grayscale: boolean) {
    if (tempInput && tempInput.type === "texture") {
      tempInput = { ...tempInput, grayscale };
      autoSave();
    }
  }

  // Video control state (runtime only, not persisted)
  let videoState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = null;

  // Poll video state when modal is open and type is video
  let videoStateInterval: ReturnType<typeof setInterval> | undefined;
  $: if (isOpen && tempInput?.type === "video" && tempInput.path && getVideoState) {
    const path = (tempInput as any).resolved_path || tempInput.path;
    videoState = getVideoState(path);
    if (!videoStateInterval) {
      videoStateInterval = setInterval(() => {
        if (tempInput?.type === "video" && tempInput.path && getVideoState) {
          const p = (tempInput as any).resolved_path || tempInput.path;
          videoState = getVideoState(p);
        }
      }, 500);
    }
  } else {
    if (videoStateInterval) {
      clearInterval(videoStateInterval);
      videoStateInterval = undefined;
    }
    videoState = null;
  }

  function handleVideoControl(action: string) {
    if (tempInput?.type === "video" && tempInput.path && onVideoControl) {
      const path = (tempInput as any).resolved_path || tempInput.path;
      onVideoControl(path, action);
      // Update state immediately
      if (getVideoState) {
        setTimeout(() => {
          if (tempInput?.type === "video" && tempInput.path && getVideoState) {
            const p = (tempInput as any).resolved_path || tempInput.path;
            videoState = getVideoState(p);
          }
        }, 100);
      }
    }
  }

  // Audio control state (runtime only, not persisted)
  let audioState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = null;

  // Poll audio state when modal is open and type is audio
  let audioStateInterval: ReturnType<typeof setInterval> | undefined;
  $: if (isOpen && tempInput?.type === "audio" && tempInput.path && getAudioState) {
    const path = (tempInput as any).resolved_path || tempInput.path;
    audioState = getAudioState(path);
    if (!audioStateInterval) {
      audioStateInterval = setInterval(() => {
        if (tempInput?.type === "audio" && tempInput.path && getAudioState) {
          const p = (tempInput as any).resolved_path || tempInput.path;
          audioState = getAudioState(p);
        }
      }, 500);
    }
  } else {
    if (audioStateInterval) {
      clearInterval(audioStateInterval);
      audioStateInterval = undefined;
    }
    audioState = null;
  }

  function handleAudioControl(action: string) {
    if (tempInput?.type === "audio" && tempInput.path && onAudioControl) {
      const path = (tempInput as any).resolved_path || tempInput.path;
      onAudioControl(path, action);
      if (getAudioState) {
        setTimeout(() => {
          if (tempInput?.type === "audio" && tempInput.path && getAudioState) {
            const p = (tempInput as any).resolved_path || tempInput.path;
            audioState = getAudioState(p);
          }
        }, 100);
      }
    }
  }

  function formatVideoTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // --- Waveform timeline editor ---
  let waveformCanvas: HTMLCanvasElement | null = null;
  let waveformContainer: HTMLElement | null = null;
  let waveformPeaks: Float32Array | null = null;
  let dragging: 'start' | 'end' | null = null;

  $: audioUri = isOpen && tempInput?.type === 'audio' && tempInput.path
    ? (tempInput as any).resolved_path || (getWebviewUri ? getWebviewUri(tempInput.path) : null) || lastSelectedResolvedUri || ''
    : '';

  $: if (audioUri) {
    getWaveformPeaks(audioUri, 350).then(async peaks => {
      waveformPeaks = peaks;
      await tick();
      if (peaks && waveformCanvas) drawWaveformTimeline();
    });
  } else {
    waveformPeaks = null;
  }

  $: if (waveformCanvas && waveformPeaks) {
    drawWaveformTimeline();
  }

  $: audioDuration = audioState?.duration || 0;
  $: audioCurrentTime = audioState?.currentTime || 0;

  $: startPercent = tempInput?.type === 'audio' && tempInput.startTime != null && audioDuration > 0
    ? Math.min((tempInput.startTime / audioDuration) * 100, 100) : 0;
  $: endPercent = tempInput?.type === 'audio' && tempInput.endTime != null && audioDuration > 0
    ? Math.min((tempInput.endTime / audioDuration) * 100, 100) : 100;
  $: cursorPercent = audioDuration > 0
    ? Math.min((audioCurrentTime / audioDuration) * 100, 100) : 0;

  function drawWaveformTimeline() {
    if (!waveformCanvas || !waveformPeaks) return;
    const ctx = waveformCanvas.getContext('2d');
    if (!ctx) return;
    const w = waveformCanvas.width;
    const h = waveformCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const n = waveformPeaks.length;
    if (n === 0) return;
    const centerY = h / 2;
    const amplitude = centerY * 0.85;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, centerY - waveformPeaks[0] * amplitude);
    for (let i = 1; i < n; i++) {
      const prevX = ((i - 1) / (n - 1)) * w;
      const x = (i / (n - 1)) * w;
      const cpX = (prevX + x) / 2;
      ctx.bezierCurveTo(
        cpX, centerY - waveformPeaks[i - 1] * amplitude,
        cpX, centerY - waveformPeaks[i] * amplitude,
        x, centerY - waveformPeaks[i] * amplitude
      );
    }
    for (let i = n - 1; i >= 1; i--) {
      const nextX = (i / (n - 1)) * w;
      const x = ((i - 1) / (n - 1)) * w;
      const cpX = (nextX + x) / 2;
      ctx.bezierCurveTo(
        cpX, centerY + waveformPeaks[i] * amplitude,
        cpX, centerY + waveformPeaks[i - 1] * amplitude,
        x, centerY + waveformPeaks[i - 1] * amplitude
      );
    }
    ctx.closePath();
    ctx.fill();
  }

  function getTimeFromMouseEvent(event: MouseEvent): number {
    if (!waveformContainer || audioDuration <= 0) return 0;
    const rect = waveformContainer.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return Math.round(percent * audioDuration * 10) / 10;
  }

  function handleHandleMouseDown(event: MouseEvent, handle: 'start' | 'end') {
    event.preventDefault();
    event.stopPropagation();
    dragging = handle;
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragMove(event: MouseEvent) {
    if (!dragging) return;
    const time = getTimeFromMouseEvent(event);
    // Update local state without saving (no config write / shader recompile)
    if (dragging === 'start') {
      updateStartTime(time.toString(), false);
    } else {
      updateEndTime(time.toString(), false);
    }
    // Update the audio loop region live via the rendering engine
    if (tempInput?.type === 'audio' && tempInput.path && onAudioControl) {
      const path = (tempInput as any).resolved_path || tempInput.path;
      const start = (tempInput as any).startTime;
      const end = (tempInput as any).endTime;
      onAudioControl(path, `loopRegion:${start ?? ''},${end ?? ''}`);
    }
  }

  function handleDragEnd() {
    if (dragging) {
      // Now persist the config (single save on mouse-up)
      autoSave();
    }
    dragging = null;
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
  }

  function handleWaveformClick(event: MouseEvent) {
    // Don't seek if we were dragging a handle
    if (dragging) return;
    if (!waveformContainer || !audioDuration || !onAudioControl || tempInput?.type !== 'audio' || !tempInput.path) return;
    const time = getTimeFromMouseEvent(event);
    const path = (tempInput as any).resolved_path || tempInput.path;
    onAudioControl(path, `seek:${time}`);
  }

  onMount(() => {
    if (isOpen && modalContent) {
      const firstInput = modalContent.querySelector("select, input") as HTMLElement;
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
      }
    }
  });

  onDestroy(() => {
    // Clean up drag listeners if component destroyed during drag
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
  });
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if isOpen}
  <div
    class="modal-overlay"
    on:click={handleBackdropClick}
    on:keydown={handleKeyDown}
    role="presentation"
  >
    <div class="modal-content" bind:this={modalContent} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <!-- Modal Header -->
      <div class="modal-header">
        {#if editingName}
          <div class="name-edit-row">
            <input
              type="text"
              bind:value={nameInput}
              on:keydown={handleNameKeydown}
              on:blur={submitRename}
              class="name-input"
              class:name-error={nameError}
            />
            {#if nameError}
              <span class="name-error-text">{nameError}</span>
            {/if}
          </div>
        {:else}
          <h2 id="modal-title" class="channel-title">
            <span>{channelName}</span>
            <button class="rename-btn" on:click|stopPropagation={startRename} title="Rename channel">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/>
              </svg>
            </button>
          </h2>
        {/if}
      </div>

      <!-- Tab Bar -->
      <div class="tab-bar" role="tablist">
        {#each TABS as tab}
          <button
            class="tab-btn"
            class:active={activeTab === tab}
            role="tab"
            aria-selected={activeTab === tab}
            on:click={() => selectTab(tab)}
          >
            {tab}
          </button>
        {/each}
      </div>

      <!-- Modal Body -->
      <div class="modal-body">
        {#if activeTab === null}
          <div class="tab-prompt">Select a category above to configure this channel.</div>
        {:else if activeTab === "Misc"}
          <!-- Misc: Buffer + Keyboard options -->
          <div class="misc-grid">
            <div class="misc-section-label">Buffer</div>
            <div class="misc-options">
              {#each ["BufferA", "BufferB", "BufferC", "BufferD"] as buf}
                <button
                  class="misc-card"
                  class:selected={tempInput?.type === "buffer" && tempInput.source === buf}
                  on:click={() => {
                    tempInput = { type: "buffer", source: buf };
                    autoSave();
                  }}
                >
                  <ChannelPreview channelInput={{ type: "buffer", source: buf }} {getWebviewUri} />
                  <div class="misc-card-label">{buf}</div>
                </button>
              {/each}
            </div>

            <div class="misc-section-label">Other</div>
            <div class="misc-options">
              <button
                class="misc-card"
                class:selected={tempInput?.type === "keyboard"}
                on:click={() => {
                  tempInput = { type: "keyboard" };
                  autoSave();
                }}
              >
                <ChannelPreview channelInput={{ type: "keyboard" }} {getWebviewUri} />
                <div class="misc-card-label">Keyboard</div>
              </button>
            </div>

            {#if tempInput?.type === "keyboard"}
              <div class="input-note">
                Keyboard input provides key states to the shader via the iChannel texture.
              </div>
            {/if}
          </div>

        {:else if activeTab === "Textures"}
          {#if postMessage}
            <AssetBrowser
              extensions={TEXTURE_EXTENSIONS}
              {shaderPath}
              {postMessage}
              {onMessage}
              onSelect={handleAssetSelect}
              selectedPath={(tempInput?.type === "texture" && tempInput.path) || ""}
            />
          {/if}

          <div class="input-group">
            <label for="path-{channelName}">Path:</label>
            <input
              id="path-{channelName}"
              type="text"
              value={(tempInput?.type === "texture" && tempInput.path) || ""}
              on:input={(e) => updatePath(e.currentTarget.value)}
              placeholder="Path to texture file"
              class="input-text"
            />
          </div>

          {#if tempInput?.type === "texture"}
            <div class="input-row">
              <div class="input-group">
                <label for="filter-{channelName}">Filter:</label>
                <select
                  id="filter-{channelName}"
                  value={tempInput.filter || "mipmap"}
                  on:change={(e) => updateFilter(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="mipmap">Mipmap</option>
                  <option value="linear">Linear</option>
                  <option value="nearest">Nearest</option>
                </select>
              </div>

              <div class="input-group">
                <label for="wrap-{channelName}">Wrap:</label>
                <select
                  id="wrap-{channelName}"
                  value={tempInput.wrap || "repeat"}
                  on:change={(e) => updateWrap(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="repeat">Repeat</option>
                  <option value="clamp">Clamp</option>
                </select>
              </div>
            </div>

            <div class="input-row">
              <div class="input-group checkbox-group">
                <label for="vflip-{channelName}">
                  <input
                    id="vflip-{channelName}"
                    type="checkbox"
                    checked={tempInput.vflip ?? true}
                    on:change={(e) => updateVFlip(e.currentTarget.checked)}
                    class="input-checkbox"
                  />
                  Vertical Flip
                </label>
              </div>

              <div class="input-group checkbox-group">
                <label for="grayscale-{channelName}">
                  <input
                    id="grayscale-{channelName}"
                    type="checkbox"
                    checked={tempInput.grayscale ?? false}
                    on:change={(e) => updateGrayscale(e.currentTarget.checked)}
                    class="input-checkbox"
                  />
                  Grayscale
                </label>
              </div>
            </div>
          {/if}

        {:else if activeTab === "Cubemaps"}
          <div class="input-group">
            <label for="source-{channelName}">Source:</label>
            <select
              id="source-{channelName}"
              value="CubeA"
              class="input-select"
              disabled
            >
              <option value="CubeA">CubeA</option>
            </select>
          </div>
          <div class="input-note">
            Cubemap input uses the CubeA render pass as a cube texture (samplerCube).
          </div>

        {:else if activeTab === "Volumes"}
          {#if postMessage}
            <AssetBrowser
              extensions={VOLUME_EXTENSIONS}
              {shaderPath}
              {postMessage}
              onSelect={handleAssetSelect}
              selectedPath={(tempInput?.type === "volume" && tempInput.path) || ""}
            />
          {/if}

          <div class="input-group">
            <label for="path-{channelName}">Path:</label>
            <input
              id="path-{channelName}"
              type="text"
              value={(tempInput?.type === "volume" && tempInput.path) || ""}
              on:input={(e) => updatePath(e.currentTarget.value)}
              placeholder="Path to volume data file"
              class="input-text"
            />
          </div>

          {#if tempInput?.type === "volume"}
            <div class="input-row">
              <div class="input-group">
                <label for="filter-{channelName}">Filter:</label>
                <select
                  id="filter-{channelName}"
                  value={tempInput.filter || "linear"}
                  on:change={(e) => updateFilter(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="linear">Linear</option>
                  <option value="nearest">Nearest</option>
                  <option value="mipmap">Mipmap</option>
                </select>
              </div>

              <div class="input-group">
                <label for="wrap-{channelName}">Wrap:</label>
                <select
                  id="wrap-{channelName}"
                  value={tempInput.wrap || "repeat"}
                  on:change={(e) => updateWrap(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="repeat">Repeat</option>
                  <option value="clamp">Clamp</option>
                </select>
              </div>
            </div>
            <div class="input-note">
              3D texture data (sampler3D). Useful for volumetric effects and noise.
            </div>
          {/if}

        {:else if activeTab === "Videos"}
          {#if postMessage}
            <AssetBrowser
              extensions={VIDEO_EXTENSIONS}
              {shaderPath}
              {postMessage}
              {onMessage}
              onSelect={handleAssetSelect}
              selectedPath={(tempInput?.type === "video" && tempInput.path) || ""}
            />
          {/if}

          <div class="input-group">
            <label for="path-{channelName}">Path:</label>
            <input
              id="path-{channelName}"
              type="text"
              value={(tempInput?.type === "video" && tempInput.path) || ""}
              on:input={(e) => updatePath(e.currentTarget.value)}
              placeholder="Path to video file or URL"
              class="input-text"
            />
          </div>

          {#if tempInput?.type === "video"}
            <div class="input-row">
              <div class="input-group">
                <label for="filter-{channelName}">Filter:</label>
                <select
                  id="filter-{channelName}"
                  value={tempInput.filter || "linear"}
                  on:change={(e) => updateFilter(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="linear">Linear</option>
                  <option value="nearest">Nearest</option>
                  <option value="mipmap">Mipmap</option>
                </select>
              </div>

              <div class="input-group">
                <label for="wrap-{channelName}">Wrap:</label>
                <select
                  id="wrap-{channelName}"
                  value={tempInput.wrap || "clamp"}
                  on:change={(e) => updateWrap(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="clamp">Clamp</option>
                  <option value="repeat">Repeat</option>
                </select>
              </div>
            </div>

            <div class="input-row">
              <div class="input-group checkbox-group">
                <label for="vflip-{channelName}">
                  <input
                    id="vflip-{channelName}"
                    type="checkbox"
                    checked={tempInput.vflip ?? true}
                    on:change={(e) => updateVFlip(e.currentTarget.checked)}
                    class="input-checkbox"
                  />
                  Vertical Flip
                </label>
              </div>
            </div>

            {#if tempInput.path && onVideoControl}
              <div class="video-controls">
                <span class="controls-label">Playback:</span>
                <div class="controls-row">
                  <button
                    class="btn-control"
                    on:click={() => handleVideoControl(videoState?.paused ? 'play' : 'pause')}
                    title={videoState?.paused ? 'Play' : 'Pause'}
                  >
                    {videoState?.paused ? '\u25B6' : '\u23F8'}
                  </button>
                  <button
                    class="btn-control"
                    on:click={() => handleVideoControl(videoState?.muted ? 'unmute' : 'mute')}
                    title={videoState?.muted ? 'Unmute' : 'Mute'}
                  >
                    {#if videoState?.muted}
                      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    {:else}
                      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                    {/if}
                  </button>
                  <button
                    class="btn-control"
                    on:click={() => handleVideoControl('reset')}
                    title="Reset to beginning"
                  >
                    &#x21BA;
                  </button>
                  {#if videoState && videoState.duration > 0}
                    <span class="video-timer">{formatVideoTime(videoState.currentTime)} / {formatVideoTime(videoState.duration)}</span>
                  {/if}
                </div>
              </div>
            {/if}
          {/if}

        {:else if activeTab === "Music"}
          {#if postMessage}
            <AssetBrowser
              extensions={AUDIO_EXTENSIONS}
              {shaderPath}
              {postMessage}
              onSelect={handleAssetSelect}
              selectedPath={(tempInput?.type === "audio" && tempInput.path) || ""}
            />
          {/if}

          <div class="input-group">
            <label for="path-{channelName}">Path:</label>
            <input
              id="path-{channelName}"
              type="text"
              value={(tempInput?.type === "audio" && tempInput.path) || ""}
              on:input={(e) => updatePath(e.currentTarget.value)}
              placeholder="Path to audio file (.mp3, .wav, .ogg)"
              class="input-text"
            />
          </div>
          <div class="input-note">
            Audio provides a 512x2 texture: row 0 = FFT frequency data, row 1 = time-domain waveform.
          </div>

          {#if tempInput?.type === "audio" && tempInput.path}
            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
            <div class="waveform-editor" bind:this={waveformContainer} on:click={handleWaveformClick}>
              <canvas bind:this={waveformCanvas} class="waveform-editor-canvas" width="700" height="80"></canvas>
              <!-- Dim outside region -->
              <div class="waveform-dim waveform-dim-left" style="width: {startPercent}%"></div>
              <div class="waveform-dim waveform-dim-right" style="width: {100 - endPercent}%"></div>
              <!-- Playback cursor -->
              {#if audioDuration > 0}
                <div class="waveform-cursor" style="left: {cursorPercent}%"></div>
              {/if}
              <!-- Start handle -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                class="waveform-handle waveform-handle-start"
                style="left: {startPercent}%"
                on:mousedown={(e) => handleHandleMouseDown(e, 'start')}
              >
                <div class="handle-bar"></div>
              </div>
              <!-- End handle -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                class="waveform-handle waveform-handle-end"
                style="left: {endPercent}%"
                on:mousedown={(e) => handleHandleMouseDown(e, 'end')}
              >
                <div class="handle-bar"></div>
              </div>
              <!-- Time labels -->
              <div class="waveform-times">
                <span class="waveform-time-label">{tempInput.startTime != null ? formatVideoTime(tempInput.startTime) : '0:00'}</span>
                <span class="waveform-time-label">{audioDuration > 0 ? formatVideoTime(audioCurrentTime) : ''}</span>
                <span class="waveform-time-label">{tempInput.endTime != null ? formatVideoTime(tempInput.endTime) : (audioDuration > 0 ? formatVideoTime(audioDuration) : '')}</span>
              </div>
            </div>
          {/if}

          {#if tempInput?.type === "audio" && tempInput.path && onAudioControl}
            <div class="video-controls">
              <span class="controls-label">Playback:</span>
              <div class="controls-row">
                <button
                  class="btn-control"
                  on:click={() => handleAudioControl(audioState?.paused ? 'play' : 'pause')}
                  title={audioState?.paused ? 'Play' : 'Pause'}
                >
                  {audioState?.paused ? '\u25B6' : '\u23F8'}
                </button>
                <button
                  class="btn-control"
                  on:click={() => handleAudioControl(audioState?.muted ? 'unmute' : 'mute')}
                  title={audioState?.muted ? 'Unmute' : 'Mute'}
                >
                  {#if audioState?.muted}
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                  {:else}
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  {/if}
                </button>
                <button
                  class="btn-control"
                  on:click={() => handleAudioControl('reset')}
                  title="Reset to beginning"
                >
                  &#x21BA;
                </button>
                {#if audioState && audioState.duration > 0}
                  <span class="video-timer">{formatVideoTime(audioState.currentTime)} / {formatVideoTime(audioState.duration)}</span>
                {/if}
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        {#if channelInput}
          <button class="btn-remove" on:click={handleRemove}>
            Remove
          </button>
        {/if}
        <div class="footer-spacer"></div>
        <button class="btn-primary" on:click={onClose}>
          Close
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .modal-content {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    max-width: 800px;
    width: 100%;
    max-height: 90vh;
    min-height: 500px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-editor-background, #1e1e1e);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--vscode-foreground, #cccccc);
  }

  .channel-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rename-btn {
    display: flex;
    align-items: center;
    padding: 4px;
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.6;
    transition: opacity 0.15s;
  }

  .rename-btn:hover {
    opacity: 1;
    color: var(--vscode-foreground, #cccccc);
  }

  .name-edit-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .name-input {
    font-size: 18px;
    font-weight: 600;
    padding: 4px 8px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-focusBorder, #007acc);
    border-radius: 4px;
    outline: none;
    font-family: inherit;
  }

  .name-input.name-error {
    border-color: var(--vscode-inputValidation-errorBorder, #f44336);
  }

  .name-error-text {
    font-size: 12px;
    color: var(--vscode-errorForeground, #f48771);
  }

  .tab-bar {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background, #1e1e1e));
    height: 35px;
    flex-shrink: 0;
    overflow-x: auto;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    padding: 0 14px;
    background: var(--vscode-tab-inactiveBackground, transparent);
    border: none;
    border-right: 1px solid var(--vscode-tab-border, var(--vscode-panel-border, #3c3c3c));
    border-radius: 0;
    color: var(--vscode-tab-inactiveForeground, #888);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .tab-btn:hover {
    background: var(--vscode-tab-hoverBackground);
    color: var(--vscode-tab-hoverForeground, #cccccc);
  }

  .tab-btn:focus,
  .tab-btn:focus-visible,
  .tab-btn:active {
    outline: none;
    box-shadow: none;
  }

  .tab-btn.active {
    background: var(--vscode-tab-activeBackground, var(--vscode-editor-background, #1e1e1e));
    color: var(--vscode-tab-activeForeground, #cccccc);
    border-bottom: 1px solid var(--vscode-tab-activeBackground, var(--vscode-editor-background, #1e1e1e));
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
    display: flex;
    gap: 8px;
    align-items: center;
    background: var(--vscode-editor-background, #1e1e1e);
  }

  .tab-prompt {
    text-align: center;
    padding: 32px 16px;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 14px;
  }

  .hidden-content {
    display: none;
  }

  .tab-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 16px;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 14px;
    opacity: 0.7;
  }

  /* Misc tab */
  .misc-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .misc-section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground, #888);
    letter-spacing: 0.5px;
    margin-top: 4px;
  }

  .misc-options {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }

  .misc-card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.15s ease;
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 0;
  }

  .misc-card:hover {
    border-color: var(--vscode-focusBorder, #007acc);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .misc-card.selected {
    border-color: var(--vscode-focusBorder, #007acc);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
  }

  .misc-card-label {
    padding: 6px 4px;
    font-size: 11px;
    text-align: center;
    color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-tab-inactiveBackground, #2d2d2d);
    border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
  }

  /* Shared form styles */
  .input-row {
    display: flex;
    gap: 12px;
  }

  .input-row .input-group {
    flex: 1;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  .input-group label {
    font-size: 14px;
    font-weight: 500;
    color: var(--vscode-foreground, #cccccc);
  }

  .input-select,
  .input-text {
    padding: 8px 12px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    font-size: 14px;
  }

  .input-select:focus,
  .input-text:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .checkbox-group {
    flex-direction: row;
    align-items: center;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }

  .input-checkbox {
    cursor: pointer;
  }

  .footer-spacer {
    flex: 1;
  }

  .btn-primary,
  .btn-remove {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .btn-primary {
    background: var(--vscode-button-background, #007acc);
    color: var(--vscode-button-foreground, white);
  }

  .btn-primary:hover {
    background: var(--vscode-button-hoverBackground, #005a9e);
  }

  .btn-remove {
    background: transparent;
    color: var(--vscode-errorForeground, #f48771);
    border: 1px solid var(--vscode-errorForeground, #f48771);
  }

  .btn-remove:hover {
    background: var(--vscode-errorForeground, #f48771);
    color: white;
  }

  .video-controls {
    margin-bottom: 16px;
  }

  .controls-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--vscode-foreground, #cccccc);
    display: block;
    margin-bottom: 6px;
  }

  .controls-row {
    display: flex;
    gap: 8px;
  }

  .btn-control {
    padding: 6px 12px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-foreground, #cccccc);
    cursor: pointer;
    font-size: 16px;
    transition: all 0.2s ease;
    min-width: 36px;
    text-align: center;
  }

  .btn-control:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .video-timer {
    font-size: 13px;
    font-family: monospace;
    color: var(--vscode-descriptionForeground, #888);
    margin-left: 8px;
    white-space: nowrap;
    line-height: 36px;
  }

  .btn-control :global(.btn-icon) {
    width: 16px;
    height: 16px;
    vertical-align: middle;
    display: inline-block;
  }

  /* Waveform timeline editor */
  .waveform-editor {
    position: relative;
    margin-bottom: 16px;
    border-radius: 6px;
    overflow: hidden;
    background: linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%);
    cursor: pointer;
    user-select: none;
  }

  .waveform-editor-canvas {
    width: 100%;
    height: 80px;
    display: block;
  }

  .waveform-dim {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }

  .waveform-dim-left {
    left: 0;
  }

  .waveform-dim-right {
    right: 0;
  }

  .waveform-cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--vscode-focusBorder, #007acc);
    pointer-events: none;
    z-index: 2;
    box-shadow: 0 0 4px rgba(0, 122, 204, 0.6);
  }

  .waveform-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 18px;
    margin-left: -9px;
    cursor: ew-resize;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .handle-bar {
    width: 5px;
    height: 100%;
    border-radius: 3px;
  }

  .waveform-handle-start .handle-bar {
    background: var(--vscode-charts-green, #89d185);
    box-shadow: 0 0 6px rgba(137, 209, 133, 0.7), 0 0 2px rgba(137, 209, 133, 0.9);
  }

  .waveform-handle-end .handle-bar {
    background: var(--vscode-charts-red, #f48771);
    box-shadow: 0 0 6px rgba(244, 135, 113, 0.7), 0 0 2px rgba(244, 135, 113, 0.9);
  }

  .waveform-handle:hover .handle-bar {
    width: 7px;
  }

  .waveform-times {
    display: flex;
    justify-content: space-between;
    padding: 4px 6px;
    background: rgba(0, 0, 0, 0.4);
  }

  .waveform-time-label {
    font-size: 11px;
    font-family: monospace;
    color: rgba(255, 255, 255, 0.8);
  }

</style>
