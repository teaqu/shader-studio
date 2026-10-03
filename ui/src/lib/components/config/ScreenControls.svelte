<script lang="ts">
  import CaptureError from './CaptureError.svelte';
  import type { AudioVideoController } from '../../AudioVideoController';

  interface Props { audioVideoController?: AudioVideoController }
  let { audioVideoController }: Props = $props();
  let busy = $state(false);
  let active = $state(false);
  let ready = $state(false);
  let message = $state('');

  async function start() {
    if (!audioVideoController || busy) {
return;
}
    busy = true;
    message = '';
    try {
      message = await audioVideoController.controlScreen('start') ?? '';
    } catch {
      message = 'Screen capture could not start. Check browser permissions.';
    } finally {
      busy = false;
    }
  }

  async function stop() {
    message = await audioVideoController?.controlScreen('stop') ?? '';
  }

  $effect(() => {
    const controller = audioVideoController;
    const update = () => {
      const preview = controller?.getLiveInputPreview?.('screen');
      active = !!preview?.video;
      ready = !!preview?.ready;
    };
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  });
</script>

<div class="screen-controls">
  <div class="actions">
    <button onclick={start} disabled={busy || !audioVideoController || !ready}>{busy ? 'Connecting…' : active ? 'Change screen' : 'Start screen sharing'}</button>
    {#if active}<button onclick={stop}>Stop screen sharing</button>{/if}
  </div>
  {#if message}<CaptureError title="Screen sharing failed" {message} />{/if}
  <p>Choose a screen, window, or browser tab. Only the video is used by this input.</p>
</div>

<style>
  .screen-controls { display: flex; flex-direction: column; gap: 8px; }
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
