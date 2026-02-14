<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";

  export let channelInput: ConfigInput | undefined;
  export let getWebviewUri: (path: string) => string | undefined;

  let imageLoaded = false;
  let imageError = false;
  let imageElement: HTMLImageElement | null = null;

  // Get the webview URI for the image path
  $: imageSrc = channelInput && channelInput.type === "texture" && channelInput.path
    ? getWebviewUri(channelInput.path) || channelInput.path
    : "";

  function handleImageLoad() {
    imageLoaded = true;
    imageError = false;
  }

  function handleImageError() {
    imageError = true;
    imageLoaded = false;
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
          loading="lazy"
          on:load={handleImageLoad}
          on:error={handleImageError}
          class="preview-image"
          class:loaded={imageLoaded}
        />
        {#if imageError}
          <div class="preview-fallback">
            <div class="texture-icon-grid">
              <div class="texture-square"></div>
              <div class="texture-square"></div>
              <div class="texture-square"></div>
              <div class="texture-square"></div>
            </div>
            <div class="fallback-text">Texture</div>
          </div>
        {/if}
      {:else}
        <div class="preview-fallback">
          <div class="texture-icon-grid">
            <div class="texture-square"></div>
            <div class="texture-square"></div>
            <div class="texture-square"></div>
            <div class="texture-square"></div>
          </div>
          <div class="fallback-text">Texture</div>
        </div>
      {/if}
      <div class="preview-overlay">
        <span class="preview-label">Texture</span>
      </div>
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
      <div class="preview-overlay">
        <span class="preview-label">Buffer</span>
      </div>
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
      <div class="preview-overlay">
        <span class="preview-label">Keyboard</span>
      </div>
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
    border-radius: 4px;
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
    gap: 8px;
    color: var(--vscode-descriptionForeground, #888);
    height: 100%;
  }

  .empty-icon {
    font-size: 48px;
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
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .preview-image.loaded {
    opacity: 1;
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
    gap: 8px;
  }

  .fallback-text {
    font-size: 14px;
    color: var(--vscode-descriptionForeground, #888);
  }

  /* Texture icon grid */
  .texture-icon-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    width: 80px;
    height: 80px;
  }

  .texture-square {
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-radius: 4px;
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
    gap: 16px;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .buffer-layers {
    position: relative;
    width: 80px;
    height: 60px;
  }

  .buffer-layer {
    position: absolute;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .buffer-layer.layer-1 {
    top: 0;
    left: 0;
    transform: rotate(-5deg);
    opacity: 0.5;
  }

  .buffer-layer.layer-2 {
    top: 4px;
    left: 4px;
    transform: rotate(0deg);
    opacity: 0.7;
  }

  .buffer-layer.layer-3 {
    top: 8px;
    left: 8px;
    transform: rotate(3deg);
    opacity: 0.9;
  }

  .buffer-name {
    font-size: 16px;
    font-weight: 600;
    color: white;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
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
    gap: 16px;
  }

  .video-play-button {
    width: 80px;
    height: 80px;
    background: rgba(255, 255, 255, 0.2);
    border: 3px solid rgba(255, 255, 255, 0.8);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .play-triangle {
    width: 0;
    height: 0;
    border-left: 24px solid rgba(255, 255, 255, 0.9);
    border-top: 14px solid transparent;
    border-bottom: 14px solid transparent;
    margin-left: 6px;
  }

  .video-label {
    font-size: 16px;
    font-weight: 600;
    color: white;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  /* Keyboard preview */
  .keyboard-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  }

  .keyboard-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    padding: 12px;
  }

  .keyboard-key {
    width: 24px;
    height: 24px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 3px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .keyboard-label {
    font-size: 16px;
    font-weight: 600;
    color: white;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  /* Preview overlay (bottom gradient with label) */
  .preview-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 8px 12px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .preview-label {
    color: white;
    font-size: 12px;
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
</style>
