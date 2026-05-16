<script lang="ts">
  interface Props {
    canvasWidth: number;
    canvasHeight: number;
    currentTime: number;
    onRecord: (config: { format: "webm" | "mp4"; duration: number; startTime: number; fps: number; width: number; height: number }) => void;
  }

  let {
    canvasWidth,
    canvasHeight,
    currentTime,
    onRecord,
  }: Props = $props();

  let videoFormat: "webm" | "mp4" = $state("mp4");
  let videoDuration = $state(5);
  let videoStartMode: "current" | "zero" | "custom" = $state("current");
  let videoCustomStartTime = $state("");
  let videoFps = $state(30);
  let videoCustomFps = $state("");
  let videoResPreset: "current" | "720p" | "1080p" | "4k" | "custom" = $state("current");
  let customResW = $state("");
  let customResH = $state("");

  let activeVideoFps = $derived(videoCustomFps ? (parseInt(videoCustomFps) || videoFps) : videoFps);

  function getResolution(preset: typeof videoResPreset): { w: number; h: number } {
    switch (preset) {
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

  function getStartTime(mode: typeof videoStartMode): number {
    switch (mode) {
      case "current": return currentTime;
      case "zero": return 0;
      case "custom": return parseFloat(videoCustomStartTime) || 0;
    }
  }

  function selectVideoFps(fps: number) {
    videoFps = fps;
    videoCustomFps = "";
  }

  function handleVideoRecord() {
    const res = getResolution(videoResPreset);
    onRecord({
      format: videoFormat,
      duration: videoDuration,
      startTime: getStartTime(videoStartMode),
      fps: activeVideoFps,
      width: res.w,
      height: res.h,
    });
  }
</script>

<div class="resolution-section">
  <h4>Format</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={videoFormat === "mp4"} onclick={() => (videoFormat = "mp4")}>MP4</button>
    <button class="resolution-option" class:active={videoFormat === "webm"} onclick={() => (videoFormat = "webm")}>WebM</button>
  </div>
</div>
<div class="resolution-section">
  <h4>Duration</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={videoDuration === 2 * Math.PI} onclick={() => (videoDuration = 2 * Math.PI)}>2&pi;</button>
    <button class="resolution-option" class:active={videoDuration === 5} onclick={() => (videoDuration = 5)}>5s</button>
    <button class="resolution-option" class:active={videoDuration === 10} onclick={() => (videoDuration = 10)}>10s</button>
    <button class="resolution-option" class:active={videoDuration === 30} onclick={() => (videoDuration = 30)}>30s</button>
    <button class="resolution-option" class:active={videoDuration === 60} onclick={() => (videoDuration = 60)}>60s</button>
    <div class="recording-custom-fps" class:active={![2 * Math.PI, 5, 10, 30, 60].includes(videoDuration)}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={videoDuration} placeholder="s" min="0.5" max="120" step="0.5" />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Start Time</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={videoStartMode === "current"} onclick={() => (videoStartMode = "current")}>{currentTime.toFixed(1)}s</button>
    <button class="resolution-option" class:active={videoStartMode === "zero"} onclick={() => (videoStartMode = "zero")}>0</button>
    <div class="recording-custom-fps" class:active={videoStartMode === "custom"}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={videoCustomStartTime} placeholder="s" step="0.1" min="0" onfocus={() => (videoStartMode = "custom")} />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Frame Rate</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={!videoCustomFps && videoFps === 24} onclick={() => selectVideoFps(24)}>24</button>
    <button class="resolution-option" class:active={!videoCustomFps && videoFps === 30} onclick={() => selectVideoFps(30)}>30</button>
    <button class="resolution-option" class:active={!videoCustomFps && videoFps === 60} onclick={() => selectVideoFps(60)}>60</button>
    <div class="recording-custom-fps" class:active={!!videoCustomFps}>
      <input type="number" class="recording-custom-fps-input" bind:value={videoCustomFps} placeholder="fps" min="1" max="120" step="1" />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Resolution</h4>
  <div class="scale-buttons">
    <button class="resolution-option" class:active={videoResPreset === "current"} onclick={() => (videoResPreset = "current")}>{canvasWidth}&times;{canvasHeight}</button>
    <button class="resolution-option" class:active={videoResPreset === "720p"} onclick={() => (videoResPreset = "720p")}>720p</button>
    <button class="resolution-option" class:active={videoResPreset === "1080p"} onclick={() => (videoResPreset = "1080p")}>1080p</button>
    <button class="resolution-option" class:active={videoResPreset === "4k"} onclick={() => (videoResPreset = "4k")}>4K</button>
    <div class="recording-custom-res" class:active={videoResPreset === "custom"} onclick={() => (videoResPreset = "custom")} onkeydown={() => (videoResPreset = "custom")} role="button" tabindex="0">
      <input type="number" class="recording-custom-res-input" bind:value={customResW} placeholder={String(canvasWidth)} min="1" step="1" onfocus={() => (videoResPreset = "custom")} />
      <span class="recording-custom-res-sep">&times;</span>
      <input type="number" class="recording-custom-res-input" bind:value={customResH} placeholder={String(canvasHeight)} min="1" step="1" onfocus={() => (videoResPreset = "custom")} />
    </div>
  </div>
</div>
<div class="resolution-section">
  <div class="scale-buttons">
    <button class="export-action-btn" onclick={handleVideoRecord}>Record</button>
  </div>
</div>
