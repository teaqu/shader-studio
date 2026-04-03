<script lang="ts">
  export let canvasWidth: number;
  export let canvasHeight: number;
  export let currentTime: number;
  export let onRecord: (config: { format: "gif"; duration: number; startTime: number; fps: number; width: number; height: number; maxColors?: number; loopCount?: number; quality?: number }) => void;

  let gifDuration = 3;
  let gifStartMode: "current" | "zero" | "custom" = "current";
  let gifCustomStartTime = "";
  let gifFps = 15;
  let gifCustomFps = "";
  let gifResPreset: "current" | "480p" | "720p" | "1080p" | "custom" = "current";
  let customResW = "";
  let customResH = "";
  let gifMaxColors = 256;
  let gifCustomColors = "";
  let gifLoopCount = -1;
  let gifQuality = 100;
  let gifCustomQuality = "";

  $: activeGifFps = gifCustomFps ? (parseInt(gifCustomFps) || gifFps) : gifFps;
  $: activeGifQuality = gifCustomQuality ? Math.max(1, Math.min(100, parseInt(gifCustomQuality) || gifQuality)) : gifQuality;
  $: activeGifColors = gifCustomColors ? Math.max(2, Math.min(256, parseInt(gifCustomColors) || gifMaxColors)) : gifMaxColors;
  $: gifFrames = Math.ceil(gifDuration * activeGifFps);
  $: gifResolution = getResolution(gifResPreset);
  $: gifEstimatedKB = Math.round((gifFrames * gifResolution.w * gifResolution.h * 0.3 * (activeGifQuality / 100) * (activeGifColors / 256)) / 1024);

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
      case "current": return currentTime;
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

  function selectGifColors(c: number) {
    gifMaxColors = c;
    gifCustomColors = "";
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
      maxColors: activeGifColors,
      loopCount: gifLoopCount,
      quality: activeGifQuality,
    });
  }
</script>

<div class="resolution-section">
  <h4>Duration</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={gifDuration === 2 * Math.PI} on:click={() => (gifDuration = 2 * Math.PI)}>2&pi;</button>
    <button class="resolution-option menu-title" class:active={gifDuration === 3} on:click={() => (gifDuration = 3)}>3s</button>
    <button class="resolution-option menu-title" class:active={gifDuration === 5} on:click={() => (gifDuration = 5)}>5s</button>
    <button class="resolution-option menu-title" class:active={gifDuration === 10} on:click={() => (gifDuration = 10)}>10s</button>
    <div class="recording-custom-fps" class:active={![2 * Math.PI, 3, 5, 10].includes(gifDuration)}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={gifDuration} placeholder="s" min="0.5" max="30" step="0.5" />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Start Time</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={gifStartMode === "current"} on:click={() => (gifStartMode = "current")}>{currentTime.toFixed(1)}s</button>
    <button class="resolution-option menu-title" class:active={gifStartMode === "zero"} on:click={() => (gifStartMode = "zero")}>0</button>
    <div class="recording-custom-fps" class:active={gifStartMode === "custom"}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={gifCustomStartTime} placeholder="s" step="0.1" min="0" on:focus={() => (gifStartMode = "custom")} />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Frame Rate</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={!gifCustomFps && gifFps === 10} on:click={() => selectGifFps(10)}>10</button>
    <button class="resolution-option menu-title" class:active={!gifCustomFps && gifFps === 15} on:click={() => selectGifFps(15)}>15</button>
    <button class="resolution-option menu-title" class:active={!gifCustomFps && gifFps === 24} on:click={() => selectGifFps(24)}>24</button>
    <button class="resolution-option menu-title" class:active={!gifCustomFps && gifFps === 30} on:click={() => selectGifFps(30)}>30</button>
    <div class="recording-custom-fps" class:active={!!gifCustomFps}>
      <input type="number" class="recording-custom-fps-input" bind:value={gifCustomFps} placeholder="fps" min="1" max="60" step="1" />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Resolution</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={gifResPreset === "current"} on:click={() => (gifResPreset = "current")}>{canvasWidth}&times;{canvasHeight}</button>
    <button class="resolution-option menu-title" class:active={gifResPreset === "480p"} on:click={() => (gifResPreset = "480p")}>480p</button>
    <button class="resolution-option menu-title" class:active={gifResPreset === "720p"} on:click={() => (gifResPreset = "720p")}>720p</button>
    <button class="resolution-option menu-title" class:active={gifResPreset === "1080p"} on:click={() => (gifResPreset = "1080p")}>1080p</button>
    <div class="recording-custom-res" class:active={gifResPreset === "custom"} on:click={() => (gifResPreset = "custom")} on:keydown={() => (gifResPreset = "custom")} role="button" tabindex="0">
      <input type="number" class="recording-custom-res-input" bind:value={customResW} placeholder={String(canvasWidth)} min="1" step="1" on:focus={() => (gifResPreset = "custom")} />
      <span class="recording-custom-res-sep">&times;</span>
      <input type="number" class="recording-custom-res-input" bind:value={customResH} placeholder={String(canvasHeight)} min="1" step="1" on:focus={() => (gifResPreset = "custom")} />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Colors</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={!gifCustomColors && gifMaxColors === 32} on:click={() => selectGifColors(32)}>32</button>
    <button class="resolution-option menu-title" class:active={!gifCustomColors && gifMaxColors === 64} on:click={() => selectGifColors(64)}>64</button>
    <button class="resolution-option menu-title" class:active={!gifCustomColors && gifMaxColors === 128} on:click={() => selectGifColors(128)}>128</button>
    <button class="resolution-option menu-title" class:active={!gifCustomColors && gifMaxColors === 256} on:click={() => selectGifColors(256)}>256</button>
    <div class="recording-custom-fps" class:active={!!gifCustomColors}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={gifCustomColors} placeholder="2-256" min="2" max="256" step="1" on:change={() => {
        if (gifCustomColors) {
          const v = Math.max(2, Math.min(256, parseInt(gifCustomColors) || 256)); gifCustomColors = String(v); 
        } 
      }} />
    </div>
  </div>
</div>
<div class="resolution-section">
  <h4>Loop</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={gifLoopCount === -1} on:click={() => (gifLoopCount = -1)}>Infinite</button>
    <button class="resolution-option menu-title" class:active={gifLoopCount === 0} on:click={() => (gifLoopCount = 0)}>Once</button>
  </div>
</div>
<div class="resolution-section">
  <h4>Quality</h4>
  <div class="scale-buttons">
    <button class="resolution-option menu-title" class:active={!gifCustomQuality && gifQuality === 50} on:click={() => selectGifQuality(50)}>50</button>
    <button class="resolution-option menu-title" class:active={!gifCustomQuality && gifQuality === 80} on:click={() => selectGifQuality(80)}>80</button>
    <button class="resolution-option menu-title" class:active={!gifCustomQuality && gifQuality === 100} on:click={() => selectGifQuality(100)}>100</button>
    <div class="recording-custom-fps" class:active={!!gifCustomQuality}>
      <input type="number" class="recording-custom-fps-input recording-duration-input" bind:value={gifCustomQuality} placeholder="1-100" min="1" max="100" step="1" on:change={() => {
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
  <div class="scale-buttons"><button class="recording-submit resolution-option menu-title active" on:click={handleGifRecord}>Record</button></div>
</div>
