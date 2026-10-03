<script lang="ts">
  import CaptureError from './CaptureError.svelte';
  import { onMount } from 'svelte';
  import type { AudioVideoController } from '../../AudioVideoController';

  interface Props { audioVideoController?: AudioVideoController; type?: 'microphone' | 'system-audio' }
  let { audioVideoController, type = 'system-audio' }: Props = $props();
  let source = $state('default');
  let devices: MediaDeviceInfo[] = $state([]);
  let busy = $state(false);
  let active = $state(false);
  let ready = $state(false);
  let message = $state('');
  let unavailable = $state('');

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
      message = await (type === 'microphone'
        ? audioVideoController.controlAudioInput('start', source)
        : audioVideoController.controlSystemAudio('start')) ?? '';
      if (type === 'microphone') {
        await refreshDevices();
      }
    } catch {
      message = 'Audio capture could not start. Check browser and system permissions.';
    } finally {
      busy = false;
    }
  }

  async function stop() {
    if (type === 'microphone') {
      await audioVideoController?.controlAudioInput('stop');
    } else {
      await audioVideoController?.controlSystemAudio('stop');
    }
  }

  onMount(() => {
    if (type === 'microphone') {
      void refreshDevices();
    }
  });
  $effect(() => {
    const controller = audioVideoController;
    let lastDeviceId: string | undefined;
    const update = () => {
      const preview = controller?.getLiveInputPreview?.(type);
      if (type === 'microphone' && preview?.deviceId && preview.deviceId !== lastDeviceId) {
        source = preview.deviceId;
        lastDeviceId = preview.deviceId;
      }
      unavailable = type === 'system-audio' ? preview?.unsupportedReason ?? '' : '';
      active = !!preview?.frequency;
      ready = !!preview?.ready;
    };
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  });
</script>

<div class="system-audio-controls">
  {#if type === "microphone"}
  <label for="system-audio-source">Audio device</label>
  <select id="system-audio-source" bind:value={source} disabled={busy}>
    <option value="default">Browser-selected microphone</option>
    {#each devices as device, index (device.deviceId)}
      <option value={device.deviceId}>{device.label || `Audio input ${index + 1}`}</option>
    {/each}
  </select>
  {/if}
  <div class="actions">
    <button onclick={start} disabled={busy || !!unavailable || !audioVideoController || !ready}>{busy ? 'Connecting…' : type === 'microphone' ? (active ? 'Change device' : 'Start mic') : (active ? 'Change sharing' : 'Start sharing')}</button>
    {#if active}<button onclick={stop}>{type === 'microphone' ? 'Stop mic' : 'Stop sharing'}</button>{/if}
    {#if type === "microphone"}<button onclick={refreshDevices} disabled={busy}>Refresh devices</button>{/if}
  </div>
  {#if unavailable || message}
    <CaptureError title={unavailable ? 'Browser Audio unavailable' : type === 'microphone' ? 'Mic capture failed' : 'Browser Audio failed'} message={unavailable || message} />
  {/if}
  {#if type === "microphone"}
    <p>Choose your microphone here or in your browser’s permission controls. To capture music from Spotify or Apple Music, route playback into a loopback input and select it here.</p>
  {:else}
    <p>Choose a browser tab and enable sharing audio. The browser may require a screen or tab selection; video is discarded. If no audio is offered, use a loopback device in Audio instead.</p>
  {/if}
  <p>Only audio is used by the shader. Sound is never replayed through your speakers. Device choices are session-only. Browser sharing needs reconnecting after reload.</p>
</div>

<style>
  .system-audio-controls { display: flex; flex-direction: column; gap: 8px; }
  select { max-width: 100%; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .actions button {
    flex: 0 0 auto;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    line-height: 16px;
  }
  .actions button:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #007acc);
    outline-offset: 2px;
  }
  p { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
</style>
