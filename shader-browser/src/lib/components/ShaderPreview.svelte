<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ShaderFile } from '../types/ShaderFile';
  import { RenderingEngine } from '@shader-studio/rendering/RenderingEngine';

  let { shader, width = 320, height = 180, vscodeApi }: {
    shader: ShaderFile;
    width?: number;
    height?: number;
    vscodeApi: any;
  } = $props();

  let canvas: HTMLCanvasElement;
  let renderingEngine: RenderingEngine | null = null;
  let isHovering = $state(false);
  let shaderCode: string = '';
  let shaderConfig: any = null;
  let shaderBuffers: Record<string, string> = {};

  onMount(async () => {
    await loadShaderCode();
  });

  async function loadShaderCode() {
    if (!vscodeApi || shaderCode) return;

    try {
      vscodeApi.postMessage({
        type: 'requestShaderCode',
        path: shader.path
      });

      const handleMessage = async (event: MessageEvent) => {
        const message = event.data;
        if (message.type === 'shaderCode' && message.path === shader.path) {
          window.removeEventListener('message', handleMessage);
          
          shaderCode = message.code;
          shaderConfig = message.config || null;
          shaderBuffers = message.buffers || {};
          
          await initializeRendering();
        }
      };

      window.addEventListener('message', handleMessage);
    } catch (err) {
      console.error('Failed to load shader code:', err);
    }
  }

  async function initializeRendering() {
    if (!shaderCode || !canvas || renderingEngine) return;

    try {
      renderingEngine = new RenderingEngine();
      renderingEngine.initialize(canvas);
      
      const result = await renderingEngine.compileShaderPipeline(
        shaderCode,
        shaderConfig,
        shader.path,
        shaderBuffers
      );

      if (result?.success) {
        // Automatically starts rendering, so pause it
        await new Promise((resolve) => setTimeout(resolve, 100));
        renderingEngine.togglePause();
      } else {
        console.error('Failed to compile shader:', shader.name, result?.error);
      }
    } catch (err) {
      console.error('Failed to initialize rendering:', err);
    }
  }

  function handleMouseEnter() {
    isHovering = true;
    if (renderingEngine) {
      renderingEngine.togglePause(); // Unpause
    }
  }

  function handleMouseLeave() {
    isHovering = false;
    if (renderingEngine) {
      renderingEngine.togglePause(); // Pause
    }
  }

  onDestroy(() => {
    if (renderingEngine) {
      renderingEngine.stopRenderLoop();
      renderingEngine.dispose();
    }
  });
</script>

<div class="shader-preview-container">
  <canvas
    bind:this={canvas}
    {width}
    {height}
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
    class="shader-preview"
  ></canvas>
</div>

<style>
  .shader-preview-container {
    width: 100%;
    height: 100%;
    display: block;
    position: relative;
    background: #000;
  }
  
  .shader-preview {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
</style>
