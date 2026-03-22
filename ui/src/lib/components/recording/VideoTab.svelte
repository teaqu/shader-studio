<script lang="ts">
  export let canvasWidth: number;
  export let canvasHeight: number;
  export let currentTime: number;
  export let onRecord: (config: { format: "webm" | "mp4"; duration: number; startTime: number; fps: number; width: number; height: number }) => void;

  let videoFormat: "webm" | "mp4" = "mp4";
  let videoDuration = 5;
  let videoStartMode: "current" | "zero" | "custom" = "current";
  let videoCustomStartTime = "";
  let videoFps = 30;
  let videoCustomFps = "";
  let videoResPreset: "current" | "720p" | "1080p" | "4k" | "custom" = "current";
  let customResW = "";
  let customResH = "";

  $: activeVideoFps = videoCustomFps ? (parseInt(videoCustomFps) || videoFps) : videoFps;

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
    <button class="resolution-option menu-title" class:active={videoFormat === "mp4"} on:click={() => (videoFormat = "mp4")}>MP4</button>
    <button class="resolution-option menu-title" class:active={videoFormat === "webm"} on:click={() => (videoFormat = "webm")}>WebM</button>
  </div>
</div>
<div class="resolution-section">
  <h4>Duration</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={videoDuration === 2 * Math.PI} on:click={() => (videoDuration = 2 * Math.PI)}>2&pi;</button>
    <button class="resolution-option menu-title" class:active={videoDuration === 5} on:click={() => (videoDuration = 5)}>5s</button>
    <button class="resolution-option menu-title" class:active={videoDuration === 10} on:click={() => (videoDuration = 10)}>10s</button>
    <button class="resolution-option menu-title" class:active={videoDuration === 30} on:click={() => (videoDuration = 30)}>30s</button>
    <button class="resolution-option menu-title" class:active={videoDuration === 60} on:click={() => (videoDuration = 60)}>60s</button>
    <div class="recording-custom-fps" class:active={![2 * Math.PI, 5, 10, 30, 60].includes(videoDuration)}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={videoDuration} placeholder="s" min="0.5" max="120" step="0.5" />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Start Time</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={videoStartMode === "current"} on:click={() => (videoStartMode = "current")}>{currentTime.toFixed(1)}s</button>
    <button class="resolution-option menu-title" class:active={videoStartMode === "zero"} on:click={() => (videoStartMode = "zero")}>0</button>
    <div class="recording-custom-fps" class:active={videoStartMode === "custom"}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={videoCustomStartTime} placeholder="s" step="0.1" min="0" on:focus={() => (videoStartMode = "custom")} />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Frame Rate</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={!videoCustomFps && videoFps === 24} on:click={() => selectVideoFps(24)}>24</button>
    <button class="resolution-option menu-title" class:active={!videoCustomFps && videoFps === 30} on:click={() => selectVideoFps(30)}>30</button>
    <button class="resolution-option menu-title" class:active={!videoCustomFps && videoFps === 60} on:click={() => selectVideoFps(60)}>60</button>
    <div class="recording-custom-fps" class:active={!!videoCustomFps}>
      <input type="number" class="recording-custom-fps-input" bind:value={videoCustomFps} placeholder="fps" min="1" max="120" step="1" />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Resolution</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={videoResPreset === "current"} on:click={() => (videoResPreset = "current")}>{canvasWidth}&times;{canvasHeight}</button>
    <button class="resolution-option menu-title" class:active={videoResPreset === "720p"} on:click={() => (videoResPreset = "720p")}>720p</button>
    <button class="resolution-option menu-title" class:active={videoResPreset === "1080p"} on:click={() => (videoResPreset = "1080p")}>1080p</button>
    <button class="resolution-option menu-title" class:active={videoResPreset === "4k"} on:click={() => (videoResPreset = "4k")}>4K</button>
    <div class="recording-custom-res" class:active={videoResPreset === "custom"} on:click={() => (videoResPreset = "custom")} on:keydown={() => (videoResPreset = "custom")} role="button" tabindex="0">
      <input type="number" class="recording-custom-res-input" bind:value={customResW} placeholder={String(canvasWidth)} min="1" step="1" on:focus={() => (videoResPreset = "custom")} />
      <span class="recording-custom-res-sep">&times;</span>
      <input type="number" class="recording-custom-res-input" bind:value={customResH} placeholder={String(canvasHeight)} min="1" step="1" on:focus={() => (videoResPreset = "custom")} />
    </div>
  </div>
</div>
<div class="resolution-section">
  <div class="scale-buttons"><button class="recording-submit resolution-option menu-title active" on:click={handleVideoRecord}>Record</button></div>
</div>
