<script lang="ts">
  import { onMount } from 'svelte';
  import type { AudioVideoController } from '../../AudioVideoController';

  interface Props { audioVideoController?: AudioVideoController }
  let { audioVideoController }: Props = $props();
  let source = $state('browser');
  let devices: MediaDeviceInfo[] = $state([]);
  let busy = $state(false);
  let active = $state(false);
  let ready = $state(false);
  let message = $state('');

  async function refreshDevices() {
    try {
      devices = (await navigator.mediaDevices?.enumerateDevices() ?? []).filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default');
    } catch {
      message = 'Audio devices are unavailable. Check browser microphone permissions.';
    }
  }

  async function start() {
    if (!audioVideoController || busy) {
      return;
    }
    busy = true;
    message = '';
    try {
      // Invoke capture directly in the click handler, before awaiting anything.
      message = await audioVideoController.controlSystemAudio('start', source === 'browser' ? undefined : source) ?? '';
      await refreshDevices();
    } catch {
      message = 'Audio capture could not start. Check browser and system permissions.';
    } finally {
      busy = false;
    }
  }

  async function stop() {
    await audioVideoController?.controlSystemAudio('stop');
  }

  onMount(() => {
    void refreshDevices();
  });
  $effect(() => {
    const controller = audioVideoController;
    const update = () => {
      const preview = controller?.getLiveInputPreview('system-audio');
      active = !!preview?.frequency;
      ready = !!preview?.ready;
    };
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  });
</script>

<div class="system-audio-controls">
  <label for="system-audio-source">Audio source</label>
  <select id="system-audio-source" bind:value={source} disabled={busy}>
    <option value="browser">Browser tab / system sharing</option>
    <option value="default">Default audio input device</option>
    {#each devices as device, index (device.deviceId)}
      <option value={device.deviceId}>{device.label || `Audio input ${index + 1}`}</option>
    {/each}
  </select>
  <div class="actions">
    <button onclick={start} disabled={busy || !audioVideoController || !ready}>{busy ? 'Connecting…' : active ? 'Change sharing' : 'Start sharing'}</button>
    {#if active}<button onclick={stop}>Stop sharing</button>{/if}
    <button onclick={refreshDevices} disabled={busy}>Refresh devices</button>
  </div>
  <p>For music in a browser, choose its tab and enable sharing audio. System or app audio options depend on your browser and OS. For Spotify or Apple Music, you can also route audio into a virtual input device, then select that device here.</p>
  <p>Only audio is used by the shader. Sound is never replayed through your speakers. Reconnect after reloading or switching shaders.</p>
  {#if message}<p role="status">{message}</p>{/if}
</div>

<style>
  .system-audio-controls { display: flex; flex-direction: column; gap: 8px; }
  select { max-width: 100%; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  p { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
</style>
