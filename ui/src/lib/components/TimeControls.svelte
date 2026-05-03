<script lang="ts">
  interface Props {
    timeManager?: any;
    currentTime?: number;
    disabled?: boolean;
  }

  let {
    timeManager = undefined as any,
    currentTime = 0.0,
    disabled = false,
  }: Props = $props();

  let timeSpeed = $state(timeManager?.getSpeed() ?? 1.0);
  let loopEnabled = $state(timeManager?.isLoopEnabled() ?? false);
  let scrubDuration = $state(timeManager?.getLoopDuration() ?? 60);
  let isScrubbing = $state(false);
  let scrubMax = $state(0);
  let rangeMax = $state(60);
  let showTimeMenu = $state(false);

  $effect(() => {
    if (!isScrubbing) {
      rangeMax = Math.min(300, Math.max(rangeMax, currentTime));
    }
  });

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
        timeManager.setLoopDuration(scrubDuration);
      }
    }
  }

  function handleScrubDurationSelect(duration: number) {
    scrubDuration = duration;
    if (timeManager && loopEnabled) {
      timeManager.setLoopDuration(duration);
    }
  }

  function handleTimeScubStart() {
    scrubMax = rangeMax;
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
    if (showTimeMenu &&
      !target.closest(".time-menu-container") &&
      !target.closest(".menu-bar button")) {
      showTimeMenu = false;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="time-menu-container">
  <button
    class="menu-title time-button"
    onclick={handleTimeClick}
    aria-label="Time settings"
    {disabled}
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
            onclick={handleLoopToggle}
            aria-label={loopEnabled ? "Disable loop" : "Enable loop"}
            title={loopEnabled ? "Disable loop" : "Enable loop"}
          >
            <i class="codicon codicon-sync"></i>
          </button>
        </div>
        <div class="scrub-control">
          <input
            type="range"
            min="0"
            max={loopEnabled ? scrubDuration : (isScrubbing ? scrubMax : rangeMax)}
            step="0.01"
            value={loopEnabled ? currentTime % scrubDuration : currentTime}
            onmousedown={handleTimeScubStart}
            oninput={handleTimeScrub}
            onmouseup={handleTimeScrubEnd}
            ontouchstart={handleTimeScubStart}
            ontouchend={handleTimeScrubEnd}
            class="time-scrub-slider"
          />
          <div class="scrub-duration-buttons">
            <button
              class="scrub-duration-option menu-title"
              class:active={Math.abs(scrubDuration - Math.PI * 2) < 0.01}
              onclick={() => handleScrubDurationSelect(Math.PI * 2)}
              disabled={!loopEnabled}
            >
              2π
            </button>
            <button
              class="scrub-duration-option menu-title"
              class:active={scrubDuration === 10}
              onclick={() => handleScrubDurationSelect(10)}
              disabled={!loopEnabled}
            >
              10s
            </button>
            <button
              class="scrub-duration-option menu-title"
              class:active={scrubDuration === 30}
              onclick={() => handleScrubDurationSelect(30)}
              disabled={!loopEnabled}
            >
              30s
            </button>
            <button
              class="scrub-duration-option menu-title"
              class:active={scrubDuration === 60}
              onclick={() => handleScrubDurationSelect(60)}
              disabled={!loopEnabled}
            >
              1m
            </button>
            <button
              class="scrub-duration-option menu-title"
              class:active={scrubDuration === 120}
              onclick={() => handleScrubDurationSelect(120)}
              disabled={!loopEnabled}
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
            oninput={handleSpeedChange}
            class="speed-slider"
          />
          <div class="speed-presets">
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 0.25}
              onclick={() => {
                timeSpeed = 0.25;
                if (timeManager) {
                  timeManager.setSpeed(0.25);
                }
              }}
            >
              0.25×
            </button>
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 0.5}
              onclick={() => {
                timeSpeed = 0.5;
                if (timeManager) {
                  timeManager.setSpeed(0.5);
                }
              }}
            >
              0.5×
            </button>
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 1.0}
              onclick={() => {
                timeSpeed = 1.0;
                if (timeManager) {
                  timeManager.setSpeed(1.0);
                }
              }}
            >
              1×
            </button>
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 2.0}
              onclick={() => {
                timeSpeed = 2.0;
                if (timeManager) {
                  timeManager.setSpeed(2.0);
                }
              }}
            >
              2×
            </button>
            <button
              class="speed-preset menu-title"
              class:active={timeSpeed === 4.0}
              onclick={() => {
                timeSpeed = 4.0;
                if (timeManager) {
                  timeManager.setSpeed(4.0);
                }
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
