<script lang="ts">
  import { untrack } from "svelte";
  import {
    getGifCapturePreferences,
    updateGifCapturePreferences,
  } from "../../state/capturePreferences.svelte";

  interface Props {
    canvasWidth: number;
    canvasHeight: number;
    onRecord: (config: { format: "gif"; duration: number; startTime: number; fps: number; width: number; height: number; loopCount?: number; quality?: number }) => void;
  }

  let {
    canvasWidth,
    canvasHeight,
    onRecord,
  }: Props = $props();

  const saved = getGifCapturePreferences();
  let gifDuration = $state(saved.duration);
  let gifStartMode: "zero" | "custom" = $state(saved.startMode);
  let gifCustomStartTime = $state(saved.customStartTime);
  let gifFps = $state(saved.fps);
  let gifCustomFps = $state(saved.customFps);
  let gifResPreset: "current" | "480p" | "720p" | "1080p" | "custom" = $state(saved.resolution);
  let customResW = $state(saved.customWidth);
  let customResH = $state(saved.customHeight);
  let gifLoopCount = $state(saved.loopCount);
  let gifQuality = $state(saved.quality);
  let gifCustomQuality = $state(saved.customQuality);

  $effect(() => {
    const next = {
      duration: gifDuration,
      startMode: gifStartMode,
      customStartTime: gifCustomStartTime,
      fps: gifFps,
      customFps: gifCustomFps,
      resolution: gifResPreset,
      customWidth: customResW,
      customHeight: customResH,
      loopCount: gifLoopCount,
      quality: gifQuality,
      customQuality: gifCustomQuality,
    };
    untrack(() => updateGifCapturePreferences(next));
  });

  let activeGifFps = $derived(gifCustomFps ? (parseInt(gifCustomFps) || gifFps) : gifFps);
  let activeGifQuality = $derived(gifCustomQuality ? Math.max(1, Math.min(100, parseInt(gifCustomQuality) || gifQuality)) : gifQuality);
  let gifFrames = $derived(Math.ceil(gifDuration * activeGifFps));
  let gifResolution = $derived(getResolution(gifResPreset));
  let gifEstimatedKB = $derived(Math.round((gifFrames * gifResolution.w * gifResolution.h * 0.3 * (activeGifQuality / 100)) / 1024));

  function getResolution(preset: typeof gifResPreset): { w: number; h: number } {
    switch (preset) {
      case "480p": return { w: 854, h: 480 };
      case "720p": return { w: 1280, h: 720 };
      case "1080p": return { w: 1920, h: 1080 };
      case "custom": {
        const w = parseInt(customResW) || canvasWidth;
        const h = parseInt(customResH) || canvasHeight;
        return { w, h };
      }
      default: return { w: canvasWidth, h: canvasHeight };
    }
  }

  function getStartTime(mode: typeof gifStartMode): number {
    switch (mode) {
      case "zero": return 0;
      case "custom": return parseFloat(gifCustomStartTime) || 0;
    }
  }

  function selectGifFps(fps: number) {
    gifFps = fps;
    gifCustomFps = "";
  }

  function selectGifQuality(q: number) {
    gifQuality = q;
    gifCustomQuality = "";
  }

  function handleGifRecord() {
    const res = getResolution(gifResPreset);
    onRecord({
      format: "gif",
      duration: gifDuration,
      startTime: getStartTime(gifStartMode),
      fps: activeGifFps,
      width: res.w,
      height: res.h,
      loopCount: gifLoopCount,
      quality: activeGifQuality,
    });
  }
</script>

<div class="resolution-section">
  <h4>Duration</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={gifDuration === 2 * Math.PI} onclick={() => (gifDuration = 2 * Math.PI)}>2&pi;</button>
    <button class="resolution-option" class:active={gifDuration === 3} onclick={() => (gifDuration = 3)}>3s</button>
    <button class="resolution-option" class:active={gifDuration === 5} onclick={() => (gifDuration = 5)}>5s</button>
    <button class="resolution-option" class:active={gifDuration === 10} onclick={() => (gifDuration = 10)}>10s</button>
    <div class="recording-custom-fps" class:active={![2 * Math.PI, 3, 5, 10].includes(gifDuration)}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={gifDuration} placeholder="s" min="0.5" max="30" step="0.5" />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Start recording at:</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={gifStartMode === "zero"} onclick={() => (gifStartMode = "zero")}>0</button>
    <div class="recording-custom-fps" class:active={gifStartMode === "custom"}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={gifCustomStartTime} placeholder="s" step="0.1" min="0" onfocus={() => (gifStartMode = "custom")} />
    </div>
  </div>
  <p class="recording-info-text">Renders preceding frames before recording begins.</p>
</div>
<div class="resolution-section">
  <h4>Frame Rate</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={!gifCustomFps && gifFps === 10} onclick={() => selectGifFps(10)}>10</button>
    <button class="resolution-option" class:active={!gifCustomFps && gifFps === 15} onclick={() => selectGifFps(15)}>15</button>
    <button class="resolution-option" class:active={!gifCustomFps && gifFps === 24} onclick={() => selectGifFps(24)}>24</button>
    <button class="resolution-option" class:active={!gifCustomFps && gifFps === 30} onclick={() => selectGifFps(30)}>30</button>
    <div class="recording-custom-fps" class:active={!!gifCustomFps}>
      <input type="number" class="recording-custom-fps-input" bind:value={gifCustomFps} placeholder="fps" min="1" max="60" step="1" />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Resolution</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={gifResPreset === "current"} onclick={() => (gifResPreset = "current")}>{canvasWidth}&times;{canvasHeight}</button>
    <button class="resolution-option" class:active={gifResPreset === "480p"} onclick={() => (gifResPreset = "480p")}>480p</button>
    <button class="resolution-option" class:active={gifResPreset === "720p"} onclick={() => (gifResPreset = "720p")}>720p</button>
    <button class="resolution-option" class:active={gifResPreset === "1080p"} onclick={() => (gifResPreset = "1080p")}>1080p</button>
    <div class="recording-custom-res" class:active={gifResPreset === "custom"} onclick={() => (gifResPreset = "custom")} onkeydown={() => (gifResPreset = "custom")} role="button" tabindex="0">
      <input type="number" class="recording-custom-res-input" bind:value={customResW} placeholder={String(canvasWidth)} min="1" step="1" onfocus={() => (gifResPreset = "custom")} />
      <span class="recording-custom-res-sep">&times;</span>
      <input type="number" class="recording-custom-res-input" bind:value={customResH} placeholder={String(canvasHeight)} min="1" step="1" onfocus={() => (gifResPreset = "custom")} />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Loop</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={gifLoopCount === 0} onclick={() => (gifLoopCount = 0)}>Infinite</button>
    <button class="resolution-option" class:active={gifLoopCount === -1} onclick={() => (gifLoopCount = -1)}>Once</button>
  </div>
</div>
<div class="resolution-section">
  <h4>Quality</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={!gifCustomQuality && gifQuality === 50} onclick={() => selectGifQuality(50)}>50</button>
    <button class="resolution-option" class:active={!gifCustomQuality && gifQuality === 80} onclick={() => selectGifQuality(80)}>80</button>
    <button class="resolution-option" class:active={!gifCustomQuality && gifQuality === 100} onclick={() => selectGifQuality(100)}>100</button>
    <div class="recording-custom-fps" class:active={!!gifCustomQuality}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={gifCustomQuality} placeholder="1-100" min="1" max="100" step="1" onchange={() => {
        if (gifCustomQuality) {
          const v = Math.max(1, Math.min(100, parseInt(gifCustomQuality) || 100)); gifCustomQuality = String(v); 
        } 
      }} />
    </div>
  </div>
</div>
<div class="resolution-section recording-info-text">
  ~{gifFrames} frames, est. ~{gifEstimatedKB > 1024 ? (gifEstimatedKB / 1024).toFixed(1) + " MB" : gifEstimatedKB + " KB"}
</div>
<div class="resolution-section">
  <div class="scale-buttons">
    <button class="export-action-btn" onclick={handleGifRecord}>Record</button>
  </div>
</div>
