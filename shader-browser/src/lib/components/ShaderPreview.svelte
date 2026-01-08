<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ShaderFile } from '../types/ShaderFile';
  import { RenderingEngine } from '@shader-studio/rendering/RenderingEngine';
  import { renderQueue } from '../stores/shaderStore';

  let { shader, width = 320, height = 180, vscodeApi }: {
    shader: ShaderFile;
    width?: number;
    height?: number;
    vscodeApi: any;
  } = $props();

  let canvas: HTMLCanvasElement;
  let renderingEngine: RenderingEngine | null = null;
  let capturedImage: string = $state('');
  let shaderCode: string = '';
  let shaderConfig: any = null;
  let shaderBuffers: Record<string, string> = {};
  let queueId: string = '';

  onMount(async () => {
    queueId = `${shader.path}-${Date.now()}`;
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
          
          // Queue the rendering to avoid too many concurrent WebGL contexts
          await renderQueue.enqueue(queueId, async () => {
            await initializeRendering();
          });
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
      renderingEngine.initialize(canvas, true);
      
      const result = await renderingEngine.compileShaderPipeline(
        shaderCode,
        shaderConfig,
        shader.path,
        shaderBuffers
      );

      if (result?.success) {
        // Let it render a few frames to ensure it's fully initialized
        await new Promise((resolve) => setTimeout(resolve, 100));
        
        // Capture the rendered frame as an image
        try {
          capturedImage = canvas.toDataURL('image/png');
          console.log('Captured image for shader:', shader.name, 'Image length:', capturedImage.length);
        } catch (err) {
          console.error('Failed to capture image for shader:', shader.name, err);
        }
        
        // Clean up rendering resources
        renderingEngine.stopRenderLoop();
        renderingEngine.dispose();
        renderingEngine = null;
        
        // Force WebGL context to be lost to free resources
        const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
        if (gl) {
          const loseContext = gl.getExtension('WEBGL_lose_context');
          if (loseContext) {
            loseContext.loseContext();
          }
        }
        
        // Clear shader code and buffers to free memory
        shaderCode = '';
        shaderConfig = null;
        shaderBuffers = {};
      } else {
        console.error('Failed to compile shader:', shader.name, result?.error);
        // Still clean up on failure
        if (renderingEngine) {
          renderingEngine.stopRenderLoop();
          renderingEngine.dispose();
          renderingEngine = null;
        }
      }
    } catch (err) {
      console.error('Failed to initialize rendering:', err);
    }
  }

  onDestroy(() => {
    // Remove from queue if still waiting
    if (queueId) {
      renderQueue.remove(queueId);
    }
    
    if (renderingEngine) {
      renderingEngine.stopRenderLoop();
      renderingEngine.dispose();
    }
  });
</script>

<div class="shader-preview-container">
  {#if capturedImage}
    <img
      src={capturedImage}
      alt={shader.name}
      {width}
      {height}
      class="shader-preview"
    />
  {:else}
    <canvas
      bind:this={canvas}
      {width}
      {height}
      class="shader-preview"
    ></canvas>
  {/if}
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
