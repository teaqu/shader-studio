<script lang="ts">
  import { portal } from '../actions/portal';
  import { computeMenuPos } from '../utils/menuPos';

  interface TimeManagerLike {
    getSpeed?: () => number;
    setSpeed?: (speed: number) => void;
    isLoopEnabled?: () => boolean;
    setLoopEnabled?: (enabled: boolean) => void;
    getLoopDuration?: () => number;
    setLoopDuration?: (duration: number) => void;
    setTime?: (time: number) => void;
  }

  interface Props {
    timeManager?: TimeManagerLike;
    currentTime?: number;
    disabled?: boolean;
  }

  let { timeManager = undefined, currentTime = 0.0, disabled = false }: Props = $props();

  let timeSpeed = $state(1.0);
  let loopEnabled = $state(false);
  let scrubDuration = $state(60);
  let isScrubbing = $state(false);
  let scrubMax = $state(0);
  let rangeMax = $state(60);
  let showTimeMenu = $state(false);
  let triggerEl = $state<HTMLElement | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  let menuPos = $state({ top: 0, left: 0 });
  let menuVisible = $state(false);
  let initializedTimeManager = $state<TimeManagerLike | undefined>(undefined);

  const durationPresets = [Math.PI * 2, 10, 30, 60, 120];
  const speedPresets = [0.25, 0.5, 1, 2, 4];
  const customDurationActive = $derived(!durationPresets.some(duration => Math.abs(scrubDuration - duration) < 0.01));
  const customSpeedActive = $derived(!speedPresets.includes(timeSpeed));

  $effect(() => {
    if (timeManager === initializedTimeManager) {
      return;
    }

    initializedTimeManager = timeManager;
    timeSpeed = timeManager?.getSpeed?.() ?? 1.0;
    loopEnabled = timeManager?.isLoopEnabled?.() ?? false;
    scrubDuration = timeManager?.getLoopDuration?.() ?? 60;
  });

  $effect(() => {
    if (!showTimeMenu) {
      menuVisible = false;
    }
  });
  $effect(() => {
    if (showTimeMenu && menuEl && triggerEl) {
      menuPos = computeMenuPos(triggerEl, menuEl, 'below-left');
      menuVisible = true;
    }
  });

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
    handleSpeedSelect(parseFloat(target.value));
  }

  function handleSpeedSelect(speed: number) {
    if (!Number.isFinite(speed)) {
      return;
    }

    timeSpeed = speed;
    timeManager?.setSpeed?.(speed);
  }

  function handleLoopToggle() {
    loopEnabled = !loopEnabled;
    timeManager?.setLoopEnabled?.(loopEnabled);
    if (loopEnabled) {
      timeManager?.setLoopDuration?.(scrubDuration);
    }
  }

  function handleScrubDurationSelect(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    scrubDuration = duration;
    if (loopEnabled) {
      timeManager?.setLoopDuration?.(duration);
    }
  }

  function handleCustomDurationInput(event: Event) {
    const target = event.target as HTMLInputElement;
    handleScrubDurationSelect(parseFloat(target.value));
  }

  function handleTimeScubStart() {
    scrubMax = rangeMax;
    isScrubbing = true;
  }

  function handleTimeScrub(event: Event) {
    const target = event.target as HTMLInputElement;
    const newTime = parseFloat(target.value);
    timeManager?.setTime?.(newTime);
  }

  function handleTimeScrubEnd() {
    isScrubbing = false;
  }

  let mouseDownTarget: HTMLElement | null = null;

  function handleWindowMouseDown(event: MouseEvent) {
    mouseDownTarget = event.target as HTMLElement;
  }

  function handleClickOutside(event: MouseEvent) {
    if (!showTimeMenu) {
      return; 
    }
    const clickTarget = event.target as HTMLElement;
    const inTrigger = clickTarget.closest(".time-menu-container") || mouseDownTarget?.closest(".time-menu-container");
    const inMenu = menuEl?.contains(clickTarget) || menuEl?.contains(mouseDownTarget);
    if (!inTrigger && !inMenu) {
      showTimeMenu = false;
    }
    mouseDownTarget = null;
  }
</script>

<svelte:window onclick={handleClickOutside} onmousedown={handleWindowMouseDown} />

<div class="time-menu-container">
  <button
    bind:this={triggerEl}
    class="menu-title time-button"
    onclick={handleTimeClick}
    aria-label="Time settings"
    {disabled}
  >
    {currentTime.toFixed(2)}s
  </button>
</div>

{#if showTimeMenu}
  <div
    use:portal
    bind:this={menuEl}
    class="time-menu"
    style="top: {menuPos.top}px; left: {menuPos.left}px; visibility: {menuVisible ? 'visible' : 'hidden'};"
  >
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
          <input
            type="number"
            class="scrub-duration-option custom-time-input menu-title"
            class:active={customDurationActive}
            aria-label="Custom loop duration in seconds"
            placeholder="s"
            min="0.01"
            step="0.01"
            value={scrubDuration}
            oninput={handleCustomDurationInput}
            disabled={!loopEnabled}
          />
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
            onclick={() => handleSpeedSelect(0.25)}
          >
            0.25×
          </button>
          <button
            class="speed-preset menu-title"
            class:active={timeSpeed === 0.5}
            onclick={() => handleSpeedSelect(0.5)}
          >
            0.5×
          </button>
          <button
            class="speed-preset menu-title"
            class:active={timeSpeed === 1.0}
            onclick={() => handleSpeedSelect(1.0)}
          >
            1×
          </button>
          <button
            class="speed-preset menu-title"
            class:active={timeSpeed === 2.0}
            onclick={() => handleSpeedSelect(2.0)}
          >
            2×
          </button>
          <button
            class="speed-preset menu-title"
            class:active={timeSpeed === 4.0}
            onclick={() => handleSpeedSelect(4.0)}
          >
            4×
          </button>
          <input
            type="number"
            class="speed-preset custom-speed-input menu-title"
            class:active={customSpeedActive}
            aria-label="Custom speed multiplier"
            placeholder="×"
            step="0.01"
            value={timeSpeed}
            oninput={handleSpeedChange}
          />
        </div>
      </div>
    </div>
  </div>
{/if}
