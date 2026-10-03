<script lang="ts">
  import type { AudioVideoController } from '../../AudioVideoController';
  import { drawLiveInputPreview } from './LiveInputPreview';

  interface Props {
    type: 'webcam' | 'microphone';
    audioVideoController?: AudioVideoController;
  }
  let { type, audioVideoController }: Props = $props();
  let canvas: HTMLCanvasElement | undefined = $state();
  let active = $state(false);

  $effect(() => {
    const controller = audioVideoController;
    const ctx = canvas?.getContext('2d');
    const inputType = type;
    active = false;
    if (!controller || !ctx) {
      return;
    }
    const draw = () => {
      active = drawLiveInputPreview(ctx, inputType, controller.getLiveInputPreview(inputType));
    };
    draw();
    // Small tiles do not need the shader's full frame rate.
    const timer = setInterval(draw, 100);
    return () => clearInterval(timer);
  });
</script>

<div class="live-preview">
  <canvas bind:this={canvas} width="160" height="120" aria-label={type === 'webcam' ? 'Live webcam preview' : 'Live microphone preview'} class:active></canvas>
  {#if !active}
    <div class="fallback">
      <i class="codicon" class:codicon-device-camera={type === 'webcam'} class:codicon-mic={type === 'microphone'}></i>
      <span>{type === 'webcam' ? 'Webcam' : 'Microphone'}</span>
    </div>
  {/if}
</div>

<style>
  .live-preview { width: 100%; height: 100%; position: relative; }
  canvas { width: 100%; height: 100%; display: block; visibility: hidden; }
  canvas.active { visibility: visible; }
  .fallback { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: var(--vscode-descriptionForeground, #888); }
  .fallback span { font-size: 10px; }
</style>
