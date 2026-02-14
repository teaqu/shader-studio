<script lang="ts">
  import loopIcon from "../../assets/refresh.svg?raw";

  export let timeManager: any;
  export let currentTime: number = 0.0;
  export let onTogglePause: () => void = () => {};

  // Initialize state from timeManager
  let timeSpeed = timeManager?.getSpeed() ?? 1.0;
  let loopEnabled = timeManager?.isLoopEnabled() ?? false;
  let scrubDuration = timeManager?.getLoopDuration() ?? 60;
  let isScrubbing = false;
  let showTimeMenu = false;

  function handleTimeClick() {
    showTimeMenu = !showTimeMenu;
  }

  function handleSpeedChange(event: Event) {
    const target = event.target as HTMLInputElement;
    timeSpeed = parseFloat(target.value);
    if (timeManager) {
      timeManager.setSpeed(timeSpeed);
    }
  }

  function handleLoopToggle() {
    loopEnabled = !loopEnabled;
    if (timeManager) {
      timeManager.setLoopEnabled(loopEnabled);
      if (loopEnabled) {
        // Sync loop duration with scrub duration
        timeManager.setLoopDuration(scrubDuration);
      }
    }
  }

  function handleScrubDurationSelect(duration: number) {
    scrubDuration = duration;
    // If loop is enabled, update loop duration to match
    if (timeManager && loopEnabled) {
      timeManager.setLoopDuration(duration);
    }
  }

  function handleTimeScubStart() {
    isScrubbing = true;
  }

  function handleTimeScrub(event: Event) {
    const target = event.target as HTMLInputElement;
    const newTime = parseFloat(target.value);
    if (timeManager) {
      timeManager.setTime(newTime);
    }
  }

  function handleTimeScrubEnd() {
    isScrubbing = false;
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // Don't close if clicking on time menu container or menu bar buttons
    if (showTimeMenu &&
        !target.closest(".time-menu-container") &&
        !target.closest(".menu-bar button")) {
      showTimeMenu = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="time-menu-container">
  <button
    class="menu-title time-button"
    on:click={handleTimeClick}
    aria-label="Time settings"
  >
    {currentTime.toFixed(2)}s
  </button>
  {#if showTimeMenu}
    <div class="time-menu">
      <div class="time-section">
        <div class="time-section-header">
          <h4>Time Range</h4>
          <button
            class="loop-toggle-button"
            class:active={loopEnabled}
            on:click={handleLoopToggle}
            aria-label={loopEnabled ? "Disable loop" : "Enable loop"}
            title={loopEnabled ? "Disable loop" : "Enable loop"}
          >
            {@html loopIcon}
          </button>
        </div>
        <div class="scrub-control">
          <input
            type="range"
            min="0"
            max={scrubDuration}
            step="0.01"
            value={currentTime % scrubDuration}
            on:mousedown={handleTimeScubStart}
            on:input={handleTimeScrub}
            on:mouseup={handleTimeScrubEnd}
            on:touchstart={handleTimeScubStart}
            on:touchend={handleTimeScrubEnd}
            class="time-scrub-slider"
          />
          <div class="scrub-duration-buttons">
            <button
              class="scrub-duration-option menu-title"
              class:active={Math.abs(scrubDuration - Math.PI * 2) < 0.01}
              on:click={() => handleScrubDurationSelect(Math.PI * 2)}
            >
              2π
            </button>
            <button
              class="scrub-duration-option menu-title"
              class:active={scrubDuration === 10}
              on:click={() => handleScrubDurationSelect(10)}
            >
              10s
            </button>
            <button
              class="scrub-duration-option menu-title"
              class:active={scrubDuration === 30}
              on:click={() => handleScrubDurationSelect(30)}
            >
              30s
            </button>
            <button
              class="scrub-duration-option menu-title"
              class:active={scrubDuration === 60}
              on:click={() => handleScrubDurationSelect(60)}
            >
              1m
            </button>
            <button
              class="scrub-duration-option menu-title"
              class:active={scrubDuration === 120}
              on:click={() => handleScrubDurationSelect(120)}
            >
              2m
            </button>
          </div>
        </div>
      </div>

      <div class="time-section">
        <h4>Speed</h4>
        <div class="speed-control">
          <label for="speed-slider">Speed: {timeSpeed.toFixed(2)}×</label>
          <input
            id="speed-slider"
            type="range"
            min="0.25"
            max="4.0"
            step="0.25"
            bind:value={timeSpeed}
            on:input={handleSpeedChange}
            class="speed-slider"
          />
          <div class="speed-presets">
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 0.25}
              on:click={() => {
                timeSpeed = 0.25;
                if (timeManager) timeManager.setSpeed(0.25);
              }}
            >
              0.25×
            </button>
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 0.5}
              on:click={() => {
                timeSpeed = 0.5;
                if (timeManager) timeManager.setSpeed(0.5);
              }}
            >
              0.5×
            </button>
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 1.0}
              on:click={() => {
                timeSpeed = 1.0;
                if (timeManager) timeManager.setSpeed(1.0);
              }}
            >
              1×
            </button>
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 2.0}
              on:click={() => {
                timeSpeed = 2.0;
                if (timeManager) timeManager.setSpeed(2.0);
              }}
            >
              2×
            </button>
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 4.0}
              on:click={() => {
                timeSpeed = 4.0;
                if (timeManager) timeManager.setSpeed(4.0);
              }}
            >
              4×
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
