<svelte:options runes={true} />
<script lang="ts">
  import { getVrNavigationSettings, updateVrNavigationSettings } from '../../state/vrPreviewState.svelte';
  import { getVrPreviewState, toggleVrPreview, toggleImmersiveVr, setVrPanelVisible } from '../../state/vrPreviewState.svelte';
  const settings = $derived(getVrNavigationSettings());
  const state = $derived(getVrPreviewState());
  const navigationEnabled = $derived(settings.movement);
  function handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      setVrPanelVisible(false);
    }
  }
</script>
<svelte:window onkeydown={handleKey} />

  <div class="panel" role="region" aria-label="VR settings">
    <header><strong>VR</strong><a class="help" href="https://teaqu.github.io/shader-studio/docs/help/shadertoy-compatibility/#optional-shader-studio-controller-inputs" target="_blank" rel="noopener noreferrer" aria-label="VR documentation" title="VR documentation">?</a><button aria-label="Close VR settings" onclick={() => setVrPanelVisible(false)}>×</button></header>
    <div class="setting">
      <label class="toggle"><input type="checkbox" checked={state.enabled} disabled={!state.available || state.immersive || state.busy}
        aria-describedby="vr-desktop-help" onchange={toggleVrPreview} /> <span>Desktop preview</span></label>
      <small id="vr-desktop-help">Look around on screen using mouse drag or IJKL. Move with WASD/QE. Hold Shift to move faster.</small>
    </div>
    {#if state.supported}
      <button disabled={state.busy} onclick={toggleImmersiveVr}>{state.immersive ? 'Exit VR' : 'Enter VR'}</button>
    {:else if !state.available}
      <p>Open a fullscreen GLSL shader defining mainVR to use VR.</p>
    {:else}
      <p>Headset unavailable. Use a WebXR browser with a connected headset.</p>
    {/if}
    {#if state.error}<span role="status">{state.error}</span>{/if}
    <strong>Headset navigation</strong>
    <div class="setting">
      <label class="toggle"><input type="checkbox" checked={navigationEnabled} aria-describedby="vr-navigation-help"
        onchange={event => updateVrNavigationSettings({ movement: event.currentTarget.checked })} /> <span>Enable headset navigation</span></label>
      <small id="vr-navigation-help">Move where you look with the left stick, including up and down. Hold the left trigger to move faster.</small>
    </div>
    <label class="field">Movement speed (m/s)
      <input type="number" min="0.1" max="10" step="0.1" value={settings.movementSpeed} disabled={!settings.movement}
        onchange={event => updateVrNavigationSettings({ movementSpeed: event.currentTarget.valueAsNumber })} />
    </label>
    <label class="field">Right stick turning
      <select disabled={!navigationEnabled} value={settings.turning} onchange={event => updateVrNavigationSettings({ turning: event.currentTarget.value as typeof settings.turning })}>
        <option value="off">Off</option><option value="snap">Snap</option><option value="smooth">Smooth</option>
      </select>
    </label>
    {#if settings.turning === 'snap'}
      <label class="field">Snap angle (degrees)
        <input type="number" min="15" max="90" step="15" disabled={!navigationEnabled} value={settings.snapAngle}
          onchange={event => updateVrNavigationSettings({ snapAngle: event.currentTarget.valueAsNumber })} />
      </label>
    {:else if settings.turning === 'smooth'}
      <label class="field">Turn speed (degrees/s)
        <input type="number" min="15" max="180" step="15" disabled={!navigationEnabled} value={settings.turnSpeed}
          onchange={event => updateVrNavigationSettings({ turnSpeed: event.currentTarget.valueAsNumber })} />
      </label>
    {/if}
    <small>{!navigationEnabled ? 'Headset navigation is disabled.' : settings.turning === 'snap' ? 'Turn in steps. Release the right stick before the next turn.' : settings.turning === 'smooth' ? 'Turn continuously while holding the right stick.' : 'The right stick does not turn the camera.'}</small>
    <p>Off by default. Controller inputs remain available to your shader in every mode.</p>
    <button onclick={() => updateVrNavigationSettings({ movement: false, movementSpeed: 2, turning: 'off', snapAngle: 30, turnSpeed: 90 })}>Reset VR settings</button>
  </div>

<style>
  header { display: flex; justify-content: space-between; align-items: center; }
  .panel { box-sizing: border-box; height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 14px; font-size: 12px; background: var(--vscode-editor-background, #202020); color: var(--vscode-foreground, #ddd); }
  .setting { display: grid; gap: 5px; }
  .toggle { display: flex; align-items: center; justify-content: flex-start; gap: 8px; }
  .toggle input { margin: 0; flex: 0 0 auto; width: 16px; height: 16px; accent-color: var(--vscode-button-background, #007acc); }
  .setting small { margin-left: 24px; }
  .field { display: grid; grid-template-columns: minmax(0, 1fr) 85px; align-items: center; gap: 12px; max-width: 300px; }
  input[type='number'] { width: 100%; box-sizing: border-box; }
  input, select, button { color: inherit; background: var(--vscode-input-background, #333); border: 1px solid var(--vscode-input-border, #888); border-radius: 3px; padding: 4px; }
  p { margin: 0; font-size: 11px; opacity: 0.8; }
  small { font-size: 11px; line-height: 1.5; color: var(--vscode-descriptionForeground, #777); }
  input:disabled { opacity: 0.5; }
  .help { margin-left: auto; display: grid; place-items: center; width: 20px; height: 20px; border: 1px solid currentColor; border-radius: 50%; color: inherit; text-decoration: none; }
  header button { margin-left: 8px; }
</style>
