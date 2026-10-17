<svelte:options runes={true} />
<script lang="ts">
  import { DEFAULT_VR_NAVIGATION } from '@shader-studio/rendering';
  import { getVrNavigationSettings, updateVrNavigationSettings, getVrPreviewState, toggleVrPreview, toggleImmersiveVr, setVrPanelVisible } from '../../state/vrPreviewState.svelte';
  const settings = $derived(getVrNavigationSettings());
  const state = $derived(getVrPreviewState());
  function handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      setVrPanelVisible(false);
    }
  }
</script>
<svelte:window onkeydown={handleKey} />

<div class="panel" role="region" aria-label="VR settings">
  <header>
    <strong><span class="codicon codicon-device-camera-video" aria-hidden="true"></span>Virtual reality</strong>
    <a class="help" href="https://teaqu.github.io/shader-studio/docs/features/vr/" target="_blank" rel="noopener noreferrer" aria-label="VR documentation" title="VR documentation">?</a>
  </header>
  <div class="content">
    <div class="session-setting">
      <div class="session">
        <span class="session-state" aria-live="polite"><span class="dot" class:ready={state.supported} aria-hidden="true"></span>{state.immersive ? 'In VR' : state.busy ? 'Connecting…' : state.supported ? 'Headset ready' : 'Headset unavailable'}</span>
        <button class="enter" disabled={state.busy || (!state.supported && !state.immersive)} aria-busy={state.busy} onclick={toggleImmersiveVr}>{state.immersive ? 'Exit VR' : 'Enter VR'}</button>
      </div>
      {#if !state.available}
        <p class="hint">Open a fullscreen GLSL shader defining mainVR to use VR.</p>
      {:else if !state.supported}
        <p class="hint">Use a WebXR browser with a connected headset.</p>
      {/if}
    </div>
    {#if state.error}<p class="error" role="alert">{state.error}</p>{/if}
    <div class="setting">
      <label class="toggle"><span>Desktop preview</span><input type="checkbox" role="switch" checked={state.enabled} disabled={!state.available || state.immersive || state.busy} aria-describedby="vr-desktop-help" onchange={toggleVrPreview} /></label>
      <p id="vr-desktop-help" class="hint">Drag to look · WASD / QE · Hold Shift to move faster</p>
    </div>
    <hr />
    <div class="setting">
      <label class="toggle"><span><strong>Headset navigation</strong><small>{settings.movement ? 'Enabled' : 'Disabled'}</small></span><input type="checkbox" role="switch" aria-label="Enable headset navigation" checked={settings.movement} aria-describedby="vr-navigation-help" onchange={event => updateVrNavigationSettings({ movement: event.currentTarget.checked })} /></label>
      <p id="vr-navigation-help" class="hint">Left stick follows your gaze, including up/down. Hold the left trigger to move faster.</p>
    </div>
    <fieldset disabled={!settings.movement} aria-label="Headset navigation settings">
      <div class="speed-heading"><label for="vr-movement-speed">Movement speed</label><output for="vr-movement-speed">{settings.movementSpeed} m/s</output></div>
      <input id="vr-movement-speed" aria-label="Movement speed (m/s)" type="range" min="0.1" max="10" step="0.1" value={settings.movementSpeed} oninput={event => updateVrNavigationSettings({ movementSpeed: event.currentTarget.valueAsNumber })} />
      <div class="turn-setting">
        <span id="vr-turning-label">Right stick turning</span>
        <div class="segments" role="group" aria-labelledby="vr-turning-label">
          <button aria-pressed={settings.turning === 'snap'} onclick={() => updateVrNavigationSettings({ turning: 'snap' })}>Snap</button>
          <button aria-pressed={settings.turning === 'smooth'} onclick={() => updateVrNavigationSettings({ turning: 'smooth' })}>Smooth</button>
        </div>
      </div>
      {#if settings.turning === 'snap'}
        <label class="field">Snap angle<select aria-label="Snap angle (degrees)" value={settings.snapAngle} onchange={event => updateVrNavigationSettings({ snapAngle: Number(event.currentTarget.value) })}>
          {#each [15, 30, 45, 60, 75, 90] as angle}<option value={angle}>{angle}°</option>{/each}
        </select></label>
      {:else}
        <label class="field">Turn speed<input aria-label="Turn speed (degrees/s)" type="number" min="15" max="180" step="15" value={settings.turnSpeed} onchange={event => updateVrNavigationSettings({ turnSpeed: event.currentTarget.valueAsNumber })} /></label>
      {/if}
    </fieldset>
    {#if !settings.movement}<p class="hint shader-note">Navigation off. Buttons and sticks are free for your shader.</p>{/if}
  </div>
  <footer><button class="reset" aria-label="Reset VR settings" onclick={() => updateVrNavigationSettings({ ...DEFAULT_VR_NAVIGATION })}>Reset</button></footer>
</div>

<style>
  .panel { box-sizing: border-box; height: 100%; overflow-y: auto; display: flex; flex-direction: column; font-family: var(--vscode-font-family, inherit); font-size: 12px; color: var(--vscode-foreground, #ddd); background: var(--vscode-editor-background, #202020); }
  .panel * { box-sizing: border-box; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 18px 18px 0; gap: 12px; }
  strong { font-weight: 500; }
  header strong { display: flex; align-items: center; gap: 8px; }
  .help { display: grid; place-items: center; width: 21px; height: 21px; flex: 0 0 auto; border: 1px solid currentColor; border-radius: 50%; color: var(--vscode-descriptionForeground, #aaa); text-decoration: none; }
  .content { display: grid; gap: 16px; padding: 18px; }
  .session-setting { display: grid; gap: 7px; }
  .session, .toggle, .speed-heading, .field { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .session { flex-wrap: wrap; }
  .session-state { display: inline-flex; align-items: center; gap: 7px; color: var(--vscode-descriptionForeground, #aaa); }
  .dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--vscode-descriptionForeground, #aaa); }
  .dot.ready { background: var(--vscode-testing-iconPassed, #73c991); }
  button, select, input[type='number'] { font: inherit; color: inherit; background: var(--vscode-input-background, #333); border: 1px solid var(--vscode-input-border, #555); border-radius: 5px; padding: 6px 12px; }
  button { cursor: pointer; }
  .enter { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #007acc); border-color: transparent; }
  .enter:hover:enabled { background: var(--vscode-button-hoverBackground, #0062a3); }
  .setting { display: grid; gap: 7px; }
  .toggle { cursor: pointer; }
  input[role='switch'] { appearance: none; position: relative; flex: 0 0 auto; width: 34px; height: 20px; margin: 0; border: 1px solid var(--vscode-checkbox-border, #777); border-radius: 12px; background: var(--vscode-descriptionForeground, #777); cursor: pointer; }
  input[role='switch']::after { content: ''; position: absolute; width: 14px; height: 14px; top: 2px; left: 2px; border-radius: 50%; background: var(--vscode-editor-background, #202020); }
  input[role='switch']:checked { background: var(--vscode-button-background, #007acc); border-color: transparent; }
  input[role='switch']:checked::after { left: 16px; background: var(--vscode-button-foreground, #fff); }
  small { display: block; color: var(--vscode-descriptionForeground, #aaa); font-size: 11px; margin-top: 2px; }
  .hint { margin: 0; font-size: 11px; line-height: 1.55; color: var(--vscode-descriptionForeground, #aaa); }
  hr { margin: 0; border: 0; border-top: 1px solid var(--vscode-panel-border, #444); }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; display: grid; gap: 14px; }
  fieldset:disabled { opacity: 0.45; }
  button:disabled, input:disabled { cursor: default; }
  .enter:disabled, input[role='switch']:disabled { opacity: 0.5; }
  output { color: var(--vscode-descriptionForeground, #aaa); font-variant-numeric: tabular-nums; }
  input[type='range'] { width: 100%; margin: 0; accent-color: var(--vscode-button-background, #007acc); }
  .turn-setting { display: grid; gap: 8px; }
  .segments { display: flex; gap: 3px; padding: 3px; border: 1px solid var(--vscode-panel-border, #444); border-radius: 6px; background: var(--vscode-sideBar-background, #252526); }
  .segments button { flex: 1; border: 0; border-radius: 4px; padding: 5px 8px; color: var(--vscode-descriptionForeground, #aaa); background: transparent; }
  .segments button[aria-pressed='true'] { color: var(--vscode-foreground, #ddd); background: var(--vscode-editor-background, #202020); box-shadow: 0 1px 3px #0002; }
  .field select, .field input { width: 88px; min-width: 0; }
  footer { margin-top: auto; display: flex; align-items: center; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--vscode-panel-border, #444); color: var(--vscode-descriptionForeground, #aaa); font-size: 11px; }
  .reset { border: 0; background: transparent; padding: 3px 0 3px 8px; color: inherit; }
  .error { margin: 0; color: var(--vscode-errorForeground, #f48771); }
  button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007acc); outline-offset: 3px; }
</style>
