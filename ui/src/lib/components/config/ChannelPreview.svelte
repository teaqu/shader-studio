<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";

  export let channelInput: ConfigInput | undefined;
  export let getWebviewUri: (path: string) => string | undefined;

  let imageError = false;
  let imageElement: HTMLImageElement | null = null;

  // Use resolved_path (webview URI) for image display, fall back to pathMap lookup or raw path
  $: imageSrc = channelInput && (channelInput.type === "texture" || channelInput.type === "cubemap") && channelInput.path
    ? channelInput.resolved_path || getWebviewUri(channelInput.path) || channelInput.path
    : "";

  // Apply vflip: Shadertoy convention is vflip=true (default), so flip when vflip is false/unchecked
  $: isFlipped = channelInput && channelInput.type === "texture" && channelInput.vflip === false;
  $: isGrayscale = channelInput && channelInput.type === "texture" && channelInput.grayscale === true;

  // Build CSS transform/filter string
  $: imageStyle = [
    isFlipped ? 'transform: scaleY(-1)' : '',
    isGrayscale ? 'filter: grayscale(100%)' : '',
  ].filter(Boolean).join('; ');

  function handleImageError() {
    imageError = true;
  }

  onDestroy(() => {
    // Clean up image element
    if (imageElement) {
      imageElement.src = "";
      imageElement = null;
    }
  });
</script>

<div class="channel-preview-container">
  {#if !channelInput}
    <!-- Empty/Unconfigured state -->
    <div class="empty-preview">
      <div class="empty-icon">+</div>
    </div>
  {:else if channelInput.type === "texture"}
    <!-- Texture preview -->
    <div class="texture-preview">
      {#if imageSrc}
        <img
          bind:this={imageElement}
          src={imageSrc}
          alt="Texture preview"
          on:error={handleImageError}
          class="preview-image"
          style={imageStyle}
        />
      {/if}
      {#if imageError || !imageSrc}
        <div class="preview-fallback">
          <div class="texture-icon-grid">
            <div class="texture-square"></div>
            <div class="texture-square"></div>
            <div class="texture-square"></div>
            <div class="texture-square"></div>
          </div>
          <div class="fallback-text">Texture</div>
        </div>
      {:else}
        <div class="preview-overlay">
          <span class="preview-label">Texture</span>
        </div>
      {/if}
    </div>
  {:else if channelInput.type === "video"}
    <!-- Video preview -->
    <div class="video-preview">
      <div class="video-icon-container">
        <div class="video-play-button">
          <div class="play-triangle"></div>
        </div>
        <div class="video-label">Video</div>
      </div>
      <div class="preview-overlay">
        <span class="preview-label">Video</span>
      </div>
    </div>
  {:else if channelInput.type === "buffer"}
    <!-- Buffer preview -->
    <div class="buffer-preview">
      <div class="buffer-layers">
        <div class="buffer-layer layer-1"></div>
        <div class="buffer-layer layer-2"></div>
        <div class="buffer-layer layer-3"></div>
      </div>
      <div class="buffer-name">{channelInput.source || "Buffer"}</div>
    </div>
  {:else if channelInput.type === "cubemap"}
    <!-- Cubemap preview -->
    <div class="texture-preview">
      {#if imageSrc}
        <img
          bind:this={imageElement}
          src={imageSrc}
          alt="Cubemap preview"
          on:error={handleImageError}
          class="preview-image"
        />
      {/if}
      {#if imageError || !imageSrc}
        <div class="preview-fallback">
          <svg viewBox="0 0 24 24" fill="currentColor" width="36" height="36" opacity="0.4"><path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.36.2-.8.2-1.14 0l-7.9-4.44A.99.99 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.36-.2.8-.2 1.14 0l7.9 4.44c.32.17.53.5.53.88v9zM12 4.15L5 8.09v7.82l7 3.94 7-3.94V8.09l-7-3.94z"/></svg>
          <div class="fallback-text">Cubemap</div>
        </div>
      {:else}
        <div class="preview-overlay">
          <span class="preview-label">Cubemap</span>
        </div>
      {/if}
    </div>
  {:else if channelInput.type === "keyboard"}
    <!-- Keyboard preview -->
    <div class="keyboard-preview">
      <div class="keyboard-grid">
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
      </div>
      <div class="keyboard-label">Keyboard</div>
    </div>
  {/if}
</div>

<style>
  .channel-preview-container {
    width: 100%;
    aspect-ratio: 4/3;
    position: relative;
    overflow: hidden;
    background: var(--vscode-editor-background, #1e1e1e);
    border-radius: 4px 4px 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Empty state */
  .empty-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--vscode-descriptionForeground, #888);
    height: 100%;
  }

  .empty-icon {
    font-size: 24px;
    opacity: 0.5;
  }

  /* Texture preview */
  .texture-preview {
    width: 100%;
    height: 100%;
    position: relative;
    background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
  }

  .preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Fallback states */
  .preview-fallback {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .fallback-text {
    font-size: 10px;
    color: var(--vscode-descriptionForeground, #888);
  }

  /* Texture icon grid */
  .texture-icon-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    width: 36px;
    height: 36px;
  }

  .texture-square {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 2px;
  }

  .texture-square:nth-child(1) {
    background: rgba(255, 255, 255, 0.3);
  }

  .texture-square:nth-child(2) {
    background: rgba(255, 255, 255, 0.15);
  }

  .texture-square:nth-child(3) {
    background: rgba(255, 255, 255, 0.15);
  }

  .texture-square:nth-child(4) {
    background: rgba(255, 255, 255, 0.25);
  }

  /* Buffer preview */
  .buffer-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .buffer-layers {
    position: relative;
    width: 36px;
    height: 28px;
  }

  .buffer-layer {
    position: absolute;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 2px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  .buffer-layer.layer-1 {
    top: 0;
    left: 0;
    transform: rotate(-5deg);
    opacity: 0.5;
  }

  .buffer-layer.layer-2 {
    top: 2px;
    left: 2px;
    transform: rotate(0deg);
    opacity: 0.7;
  }

  .buffer-layer.layer-3 {
    top: 4px;
    left: 4px;
    transform: rotate(3deg);
    opacity: 0.9;
  }

  .buffer-name {
    font-size: 11px;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  /* Video preview */
  .video-preview {
    width: 100%;
    height: 100%;
    position: relative;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .video-icon-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .video-play-button {
    width: 36px;
    height: 36px;
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.8);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .play-triangle {
    width: 0;
    height: 0;
    border-left: 12px solid rgba(255, 255, 255, 0.9);
    border-top: 7px solid transparent;
    border-bottom: 7px solid transparent;
    margin-left: 3px;
  }

  .video-label {
    font-size: 11px;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  /* Keyboard preview */
  .keyboard-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  }

  .keyboard-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    padding: 6px;
  }

  .keyboard-key {
    width: 12px;
    height: 12px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 2px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .keyboard-label {
    font-size: 11px;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  /* Preview overlay (bottom gradient with label) */
  .preview-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 4px 6px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .preview-label {
    color: white;
    font-size: 9px;
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
</style>
