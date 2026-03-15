<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";
  import AssetBrowser from "../AssetBrowser.svelte";
  import { VIDEO_EXTENSIONS } from "../../../constants/assetExtensions";
  import { formatTime } from "../../../util/formatTime";

  export let tempInput: ConfigInput | undefined;
  export let channelName: string;
  export let shaderPath: string;
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;
  export let onAssetSelect: (path: string, resolvedUri?: string) => void;
  export let onUpdatePath: (path: string) => void;
  export let onUpdateFilter: (filter: "linear" | "nearest" | "mipmap") => void;
  export let onUpdateWrap: (wrap: "repeat" | "clamp") => void;
  export let onUpdateVFlip: (vflip: boolean) => void;
  export let onVideoControl: ((path: string, action: string) => void) | undefined = undefined;
  export let getVideoState: ((path: string) => { paused: boolean; muted: boolean; currentTime: number; duration: number } | null) | undefined = undefined;

  // Video control state (runtime only, not persisted)
  let videoState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = null;

  // Poll video state
  let videoStateInterval: ReturnType<typeof setInterval> | undefined;
  $: if (tempInput?.type === "video" && tempInput.path && getVideoState) {
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

  onDestroy(() => {
    if (videoStateInterval) {
      clearInterval(videoStateInterval);
    }
  });
</script>

{#if postMessage}
  <AssetBrowser
    extensions={VIDEO_EXTENSIONS}
    {shaderPath}
    {postMessage}
    {onMessage}
    onSelect={onAssetSelect}
    selectedPath={(tempInput?.type === "video" && tempInput.path) || ""}
  />
{/if}

<div class="input-group">
  <label for="path-{channelName}">Path:</label>
  <input
    id="path-{channelName}"
    type="text"
    value={(tempInput?.type === "video" && tempInput.path) || ""}
    on:input={(e) => onUpdatePath(e.currentTarget.value)}
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
        on:change={(e) => onUpdateFilter(e.currentTarget.value as "linear" | "nearest" | "mipmap")}
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
        on:change={(e) => onUpdateWrap(e.currentTarget.value as "repeat" | "clamp")}
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
          on:change={(e) => onUpdateVFlip(e.currentTarget.checked)}
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
          <span class="video-timer">{formatTime(videoState.currentTime)} / {formatTime(videoState.duration)}</span>
        {/if}
      </div>
    </div>
  {/if}
{/if}

<style>
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
</style>
