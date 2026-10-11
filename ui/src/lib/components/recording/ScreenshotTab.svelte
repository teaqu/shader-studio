<script lang="ts">
  import { untrack } from "svelte";
  import {
    getScreenshotCapturePreferences,
    updateScreenshotCapturePreferences,
  } from "../../state/capturePreferences.svelte";

  interface Props {
    canvasWidth: number;
    canvasHeight: number;
    onScreenshot: (config: { mode: "live" | "render"; format: "png" | "jpeg"; time?: number; width: number; height: number }) => void;
  }

  let {
    canvasWidth,
    canvasHeight,
    onScreenshot,
  }: Props = $props();

  const saved = getScreenshotCapturePreferences();
  let screenshotFormat: "png" | "jpeg" = $state(saved.format);
  let captureMode: "live" | "render" = $state(saved.mode);
  let screenshotStartMode: "zero" | "custom" = $state(saved.startMode);
  let screenshotCustomTime = $state(saved.customTime);
  let screenshotResPreset: "current" | "480p" | "720p" | "1080p" | "4k" | "custom" = $state(saved.resolution);
  let customResW = $state(saved.customWidth);
  let customResH = $state(saved.customHeight);

  $effect(() => {
    const next = {
      format: screenshotFormat,
      mode: captureMode,
      startMode: screenshotStartMode,
      customTime: screenshotCustomTime,
      resolution: screenshotResPreset,
      customWidth: customResW,
      customHeight: customResH,
    };
    untrack(() => updateScreenshotCapturePreferences(next));
  });

  function getResolution(preset: typeof screenshotResPreset): { w: number; h: number } {
    switch (preset) {
      case "480p": return { w: 854, h: 480 };
      case "720p": return { w: 1280, h: 720 };
      case "1080p": return { w: 1920, h: 1080 };
      case "4k": return { w: 3840, h: 2160 };
      case "custom": {
        const w = parseInt(customResW) || canvasWidth;
        const h = parseInt(customResH) || canvasHeight;
        return { w, h };
      }
      default: return { w: canvasWidth, h: canvasHeight };
    }
  }

  function getStartTime(mode: typeof screenshotStartMode): number {
    switch (mode) {
      case "zero": return 0;
      case "custom": return parseFloat(screenshotCustomTime) || 0;
    }
  }

  function handleScreenshot() {
    const res = getResolution(screenshotResPreset);
    onScreenshot({
      mode: captureMode,
      format: screenshotFormat,
      time: captureMode === "render" ? getStartTime(screenshotStartMode) : undefined,
      width: captureMode === "live" ? canvasWidth : res.w,
      height: captureMode === "live" ? canvasHeight : res.h,
    });
  }
</script>

<div class="resolution-section">
  <h4>Format</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={screenshotFormat === "png"} onclick={() => (screenshotFormat = "png")}>PNG</button>
    <button class="resolution-option" class:active={screenshotFormat === "jpeg"} onclick={() => (screenshotFormat = "jpeg")}>JPEG</button>
  </div>
</div>
<div class="resolution-section">
  <h4>Mode</h4>
  <div class="scale-buttons" role="group" aria-label="Screenshot capture mode">
    <button class="resolution-option" class:active={captureMode === "live"} onclick={() => (captureMode = "live")}>Live</button>
    <button class="resolution-option" class:active={captureMode === "render"} onclick={() => (captureMode = "render")}>Render</button>
  </div>
</div>
{#if captureMode === "render"}
  <div class="resolution-section">
    <h4>Capture frame at:</h4>
    <div class="scale-buttons">
      <button class="resolution-option" class:active={screenshotStartMode === "zero"} onclick={() => (screenshotStartMode = "zero")}>0</button>
      <div class="recording-custom-fps" class:active={screenshotStartMode === "custom"}>
        <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={screenshotCustomTime} placeholder="s" step="0.1" min="0" onfocus={() => (screenshotStartMode = "custom")} />
      </div>
    </div>
    <p class="recording-info-text">Renders preceding frames before capturing this frame.</p>
  </div>
  <div class="resolution-section">
    <h4>Resolution</h4>
    <div class="scale-buttons">
      <button class="resolution-option" class:active={screenshotResPreset === "current"} onclick={() => (screenshotResPreset = "current")}>{canvasWidth}&times;{canvasHeight}</button>
      <button class="resolution-option" class:active={screenshotResPreset === "720p"} onclick={() => (screenshotResPreset = "720p")}>720p</button>
      <button class="resolution-option" class:active={screenshotResPreset === "1080p"} onclick={() => (screenshotResPreset = "1080p")}>1080p</button>
      <button class="resolution-option" class:active={screenshotResPreset === "4k"} onclick={() => (screenshotResPreset = "4k")}>4K</button>
      <div class="recording-custom-res" class:active={screenshotResPreset === "custom"} onclick={() => (screenshotResPreset = "custom")} onkeydown={() => (screenshotResPreset = "custom")} role="button" tabindex="0">
        <input type="number" class="recording-custom-res-input" bind:value={customResW} placeholder={String(canvasWidth)} min="1" step="1" onfocus={() => (screenshotResPreset = "custom")} />
        <span class="recording-custom-res-sep">&times;</span>
        <input type="number" class="recording-custom-res-input" bind:value={customResH} placeholder={String(canvasHeight)} min="1" step="1" onfocus={() => (screenshotResPreset = "custom")} />
      </div>
    </div>
  </div>
{/if}
<div class="resolution-section">
  <div class="scale-buttons">
    <button class="export-action-btn" onclick={handleScreenshot}>Capture screenshot</button>
  </div>
</div>
