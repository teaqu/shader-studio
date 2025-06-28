<script lang="ts">
  import { onMount } from 'svelte';
  import { piRenderer } from './lib/pilibs/src/piRenderer';
  import { getRealTime, piCreateFPSCounter } from './lib/pilibs/src/piWebUtils';

  // --- Core State ---
  let glCanvas: HTMLCanvasElement;
  let renderer: any;
  let initialized = false;
  let running = false;
  let paused = false;
  let pausedTime = 0;
  let lastRealTime = 0;
  let resetTime = 0;
  let frame = 0;
  let mouse = new Float32Array([0, 0, 0, 0]);
  let isMouseDown = false;
  let keyHeld = new Uint8Array(256);
  let keyPressed = new Uint8Array(256);
  let keyToggled = new Uint8Array(256);
  let keyboardBuffer = new Uint8Array(256 * 3); // Combined buffer for texture upload
  const vscode = acquireVsCodeApi();
  let shaderName = '';
  let fpsCounter = piCreateFPSCounter();
  let currentFPS = 0;
  let lastEvent: MessageEvent | null = null;
  let isLocked = false;
  let uniforms = {
    res: new Float32Array([0, 0, 0]),
    time: 0,
    mouse: new Float32Array([0, 0, 0, 0]),
    frame: 0
  };

  // --- piLibs Resource State ---
  let keyboardTexture: any = null;
  let defaultTexture: any = null;
  
  type PassConfig = {
    name: string;
    shaderSrc: string;
    inputs: Record<string, any>;
    path?: string;
  };
  let passes: PassConfig[] = [];
  let passShaders: Record<string, any> = {};
  let passBuffers: Record<string, { front: any, back: any }> = {};
  let imageTextureCache: Record<string, any> = {};
  let isHandlingMessage = false;
  let currentShaderRenderID = 0;

  // --- Pause/Resume Functions ---
  function togglePause() {
    if (paused) {
      // Resume: calculate how long we were paused and adjust the offset
      const currentTime = performance.now() * 0.001;
      pausedTime += currentTime - lastRealTime;
      paused = false;
    } else {
      // Pause: record the current time (absolute time, not relative to resetTime)
      lastRealTime = performance.now() * 0.001;
      paused = true;
    }
  }

  function toggleLock() {
    vscode.postMessage({ type: 'toggleLock' });
  }

  // --- ShaderToy Compatibility ---
  function wrapShaderToyCode(code: string): { wrappedCode: string, headerLineCount: number } {
    const injectChannels = ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3']
      .filter(ch => !new RegExp(`uniform\\s+sampler2D\\s+${ch}\\s*;`).test(code))
      .map(ch => `uniform sampler2D ${ch};`)
      .join('\n');
    const injectMouse = !/uniform\s+vec4\s+iMouse\s*;/.test(code) ? `uniform vec4 iMouse;\n` : '';
    const injectFrame = !/uniform\s+int\s+iFrame\s*;/.test(code) ? `uniform int iFrame;\n` : '';

    const header = `
    precision highp float;
    out vec4 fragColor;

    uniform vec3 iResolution;
    uniform float iTime;
    ${injectChannels}
    ${injectMouse}
    ${injectFrame}`;

    const wrappedCode = `${header}

${code}

void main() {
  mainImage(fragColor, gl_FragCoord.xy);
}`;

    const headerLineCount = (header.match(/\n/g) || []).length + 2;
    return { wrappedCode, headerLineCount };
  }

  // --- Main Setup ---
  onMount(async () => {
    const gl = glCanvas.getContext('webgl2');
    if (!gl) {
      vscode.postMessage({ type: 'error', payload: ['❌ WebGL2 not supported'] });
      return;
    }

    try {
      renderer = piRenderer();
      const success = await renderer.Initialize(gl);
      if (!success) {
        vscode.postMessage({ type: 'error', payload: ['❌ piRenderer could not initialize'] });
        return;
      }

      defaultTexture = renderer.CreateTexture(renderer.TEXTYPE.T2D, 1, 1, renderer.TEXFMT.C4I8, renderer.FILTER.NONE, renderer.TEXWRP.CLAMP, new Uint8Array([0, 0, 0, 255]));

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.keyCode >= 256) return;
        // If key was not previously held, it's a "just pressed" event
        if (keyHeld[e.keyCode] === 0) {
          keyPressed[e.keyCode] = 255;
          // Toggle state only changes on initial press
          keyToggled[e.keyCode] = keyToggled[e.keyCode] === 255 ? 0 : 255;
        }
        // Set key as held
        keyHeld[e.keyCode] = 255;
      };

      const onKeyUp = (e: KeyboardEvent) => {
        if (e.keyCode >= 256) return;
        // Unset key as held
        keyHeld[e.keyCode] = 0;
      };

      const onMouseDown = (e: MouseEvent) => {
        isMouseDown = true;
        const rect = glCanvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / rect.width * glCanvas.width);
        const y = Math.floor(glCanvas.height - (e.clientY - rect.top) / rect.height * glCanvas.height);
        mouse[0] = x;
        mouse[1] = y;
        mouse[2] = x;
        mouse[3] = y;
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!isMouseDown) return;
        const rect = glCanvas.getBoundingClientRect();
        mouse[0] = Math.floor((e.clientX - rect.left) / rect.width * glCanvas.width);
        mouse[1] = Math.floor(glCanvas.height - (e.clientY - rect.top) / rect.height * glCanvas.height);
      };

      const onMouseUp = () => {
        isMouseDown = false;
        // Negate z and w to indicate mouse is up, following ShaderToy convention.
        mouse[2] = -Math.abs(mouse[2]);
        mouse[3] = -Math.abs(mouse[3]);
      };

      glCanvas.addEventListener('mousedown', onMouseDown);
      glCanvas.addEventListener('mouseup', onMouseUp);
      glCanvas.addEventListener('mousemove', onMouseMove);

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('message', handleShaderMessage);

     const container = glCanvas.parentElement!;
    function resizeCanvasToFit16x9() {
      const container = glCanvas.parentElement!;
      const styles = getComputedStyle(container);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);

      const w = container.clientWidth - paddingX;
      const h = container.clientHeight;
      const aspect = 16 / 9;

      let newWidth, newHeight;
      if (w / h > aspect) {
        newHeight = h;
        newWidth = h * aspect;
      } else {
        newWidth = w;
        newHeight = w / aspect;
      }

      glCanvas.style.width = `${newWidth}px`;
      glCanvas.style.height = `${newHeight}px`;
      // Set internal resolution based on devicePixelRatio for high-DPI rendering
      const scaleFactor = window.devicePixelRatio;
      updateCanvasSize(newWidth * scaleFactor, newHeight * scaleFactor);
    }

    const resizeObserver = new ResizeObserver(resizeCanvasToFit16x9);
    resizeObserver.observe(container);
    resizeCanvasToFit16x9();
      
      initialized = true;
      vscode.postMessage({ type: 'debug', payload: ['Svelte with piLibs initialized'] });

    } catch (err) {
        vscode.postMessage({ type: 'error', payload: ['❌ Renderer initialization failed:', err.message] });
    }
  });

  function updateCanvasSize(width: number, height: number) {
    const newWidth = Math.round(width);
    const newHeight = Math.round(height);

    if (!renderer || (glCanvas.width === newWidth && glCanvas.height === newHeight)) {
        return;
    }

    glCanvas.width = newWidth;
    glCanvas.height = newHeight;

    const oldPassBuffers = passBuffers;
    passBuffers = {};

    // Create a temporary shader to copy buffer contents.
    const vs = `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const fs = `
        precision highp float;
        out vec4 fragColor;
        uniform sampler2D srcTex;
        uniform vec3 iResolution;
        void main() {
            vec2 uv = gl_FragCoord.xy / iResolution.xy;
            fragColor = texture(srcTex, uv);
        }
    `;
    const copyShader = renderer.CreateShader(vs, fs);

    for (const pass of passes) {
        if (pass.name !== "Image") {
            const newBuffers = createPingPongBuffers(newWidth, newHeight);
            // If there was an old buffer for this pass, copy its content to preserve state.
            if (oldPassBuffers[pass.name] && copyShader && copyShader.mResult) {
                renderer.AttachShader(copyShader);
                const posLoc = renderer.GetAttribLocation(copyShader, 'position');
                renderer.SetShaderTextureUnit('srcTex', 0);

                // Copy the 'front' buffer which holds the previous frame's state.
                renderer.SetRenderTarget(newBuffers.front);
                renderer.SetViewport([0, 0, newWidth, newHeight]);
                renderer.SetShaderConstant3FV("iResolution", new Float32Array([newWidth, newHeight, newWidth / newHeight]));
                renderer.AttachTextures(1, oldPassBuffers[pass.name].front.mTex0);
                renderer.DrawUnitQuad_XY(posLoc);
            }
            passBuffers[pass.name] = newBuffers;
        }
    }

    if (copyShader) renderer.DestroyShader(copyShader);

    // Clean up the old, now unused, buffers.
    for (const key in oldPassBuffers) {
        renderer.DestroyRenderTarget(oldPassBuffers[key].front);
        renderer.DestroyRenderTarget(oldPassBuffers[key].back);
        renderer.DestroyTexture(oldPassBuffers[key].front.mTex0);
        renderer.DestroyTexture(oldPassBuffers[key].back.mTex0);
    }

     // Redraw the final image pass to prevent a black screen flicker.
    const imagePass = passes.find(p => p.name === "Image");
    if (imagePass && running) {
        const res = new Float32Array([glCanvas.width, glCanvas.height, glCanvas.width / glCanvas.height]);
        const t = (performance.now()) * 0.001;
        const uniforms = { res, time: t, mouse, frame };
        drawPass(imagePass, null, uniforms);
    }
  }

  // --- Resource Management using piRenderer ---

  async function fetchShaderSource(url: string): Promise<string> {
    const res = await fetch(url);
    return await res.text();
  }

  function loadTextureFromUrl(url: string, opts: { filter?: string; wrap?: string; vflip?: boolean } = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.crossOrigin = '';
      image.onload = () => {
        let piFilter = renderer.FILTER.MIPMAP;
        if (opts.filter === 'linear') piFilter = renderer.FILTER.LINEAR;
        if (opts.filter === 'nearest') piFilter = renderer.FILTER.NONE;
        
        let piWrap = renderer.TEXWRP.REPEAT;
        if (opts.wrap === 'clamp') piWrap = renderer.TEXWRP.CLAMP;

        const vflip = opts.vflip !== undefined ? opts.vflip : true;
        const texture = renderer.CreateTextureFromImage(renderer.TEXTYPE.T2D, image, renderer.TEXFMT.C4I8, piFilter, piWrap, vflip);
        resolve(texture);
      };
      image.onerror = reject;
      image.src = url;
    });
  }

  function updateKeyboardTexture() {
    // Combine the three states into one buffer for uploading
    // Row 0: Held states
    keyboardBuffer.set(keyHeld, 0);
    // Row 1: Pressed states
    keyboardBuffer.set(keyPressed, 256);
    // Row 2: Toggled states
    keyboardBuffer.set(keyToggled, 512);

    if (!keyboardTexture) {
      // Create a 256x3 texture, where each row corresponds to a state
      keyboardTexture = renderer.CreateTexture(renderer.TEXTYPE.T2D, 256, 3, renderer.TEXFMT.C1I8, renderer.FILTER.NONE, renderer.TEXWRP.CLAMP, keyboardBuffer);
    } else {
      // Update the entire texture
      renderer.UpdateTexture(keyboardTexture, 0, 0, 256, 3, keyboardBuffer);
    }
  }

  function createPingPongBuffers(width: number, height: number) {
    // In WebGL2, linear filtering on float textures is a standard feature.
    // The library's check is for WebGL1, so we can override it here.
    const filter = renderer.FILTER.LINEAR;
    
    const frontTex = renderer.CreateTexture(renderer.TEXTYPE.T2D, width, height, renderer.TEXFMT.C4F32, filter, renderer.TEXWRP.CLAMP, null);
    const backTex = renderer.CreateTexture(renderer.TEXTYPE.T2D, width, height, renderer.TEXFMT.C4F32, filter, renderer.TEXWRP.CLAMP, null);

    const frontRT = renderer.CreateRenderTarget(frontTex, null, null, null, null, false);
    const backRT = renderer.CreateRenderTarget(backTex, null, null, null, null, false);

    return { front: frontRT, back: backRT };
  }

  async function handleShaderMessage(event: MessageEvent) {
    
  let { type, code, config, name, buffers = {}, isLocked: incomingLocked } = event.data;
  currentShaderRenderID++;

  if (type !== 'shaderSource' || !initialized || isHandlingMessage) return;

  // Update lock state from extension
  if (incomingLocked !== undefined) {
    isLocked = incomingLocked;
  }

  if (shaderName !== name) {
    shaderName = name;
    cleanup();
  }
  
  isHandlingMessage = true;
  try {
    running = false;

    // Keep track of old resources to clean up later by creating shallow copies
    const oldPassShaders = { ...passShaders };
    const oldPassBuffers = { ...passBuffers };
    const oldImageTextureCache = { ...imageTextureCache };

    // Prepare for the new state
    let newPasses: PassConfig[] = [];
    let newPassShaders: Record<string, any> = {};
    let newPassBuffers: Record<string, any> = {};
    let newImageTextureCache: Record<string, any> = {};
    let hasError = false;

    const usedConfig = config ?? {};
    const passNames = usedConfig ? Object.keys(usedConfig).filter(k => k !== "version") : [];

    if (passNames.length === 0) {
      newPasses.push({ name: "Image", shaderSrc: code, inputs: {}, path: undefined });
    } else {
      for (const passName of passNames) {
        const pass = usedConfig[passName];
        // Use buffer content from the message if available, otherwise use main shader code
        const shaderSrc = buffers[passName] || (passName === "Image" ? code : "");
        
        newPasses.push({
          name: passName,
          shaderSrc, 
          inputs: pass.inputs ?? {},
          path: pass.path,
        });
      }
    }


    const vs = `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    for (const pass of newPasses) {
      const { wrappedCode: fs, headerLineCount: svelteHeaderLines } = wrapShaderToyCode(pass.shaderSrc);
      const shader = renderer.CreateShader(vs, fs);
      if (!shader.mResult) {
        hasError = true;
        const err = shader.mInfo.replace(/ERROR: 0:(\d+):/g, (m, p1) => {
            const totalHeaderLines = renderer.GetShaderHeaderLines(1) + svelteHeaderLines;
            const userLine = Math.max(1, parseInt(p1, 10) - totalHeaderLines);
            return `ERROR: 0:${userLine}:`;
        });
        vscode.postMessage({ type: 'error', payload: [`${pass.name}: ${err}`] });
        break; 
      }
      newPassShaders[pass.name] = shader;

      if (pass.name !== "Image") {
        if (oldPassBuffers[pass.name]) {
          newPassBuffers[pass.name] = oldPassBuffers[pass.name];
          delete oldPassBuffers[pass.name];
        } else {
          newPassBuffers[pass.name] = createPingPongBuffers(glCanvas.width, glCanvas.height);
        }
      }
    }

    if (hasError) {
      for (const key in newPassShaders) renderer.DestroyShader(newPassShaders[key]);
      running = true;
      requestAnimationFrame(render);
      return;
    }

    passes = newPasses;
    passShaders = newPassShaders;
    passBuffers = newPassBuffers;

    for (const key in oldPassShaders) renderer.DestroyShader(oldPassShaders[key]);
    for (const key in oldPassBuffers) {
      renderer.DestroyRenderTarget(oldPassBuffers[key].front);
      renderer.DestroyRenderTarget(oldPassBuffers[key].back);
      renderer.DestroyTexture(oldPassBuffers[key].front.mTex0);
      renderer.DestroyTexture(oldPassBuffers[key].back.mTex0);
    }

    for (const pass of passes) {
      for (let i = 0; i < 4; i++) {
        const input = pass.inputs[`iChannel${i}`];
        if (input && input.type === 'image' && input.path) {
          if (oldImageTextureCache[input.path]) {
            newImageTextureCache[input.path] = oldImageTextureCache[input.path];
            delete oldImageTextureCache[input.path];
          } else {
            newImageTextureCache[input.path] = await loadTextureFromUrl(input.path, input.opts);
          }
        }
      }
    }
    imageTextureCache = newImageTextureCache;
    for (const key in oldImageTextureCache) renderer.DestroyTexture(oldImageTextureCache[key]);

    running = true;
    vscode.postMessage({ type: 'log', payload: [`Shader compiled and linked`] });
    requestAnimationFrame(render);
    lastEvent = event;
  } finally {
    isHandlingMessage = false;
  }
}

function reset() {
    if (!initialized) return;
    cleanup();
    if (lastEvent) {
      handleShaderMessage(lastEvent);
    } else {
      vscode.postMessage({ type: 'error', payload: ['❌ No shader to reset'] });
    }
  }

  function cleanup() {
    running = false;
    for (const key in passShaders) renderer.DestroyShader(passShaders[key]);
    for (const key in passBuffers) {
      renderer.DestroyRenderTarget(passBuffers[key].front);
      renderer.DestroyRenderTarget(passBuffers[key].back);
      renderer.DestroyTexture(passBuffers[key].front.mTex0);
      renderer.DestroyTexture(passBuffers[key].back.mTex0);
    }
    for (const key in imageTextureCache) renderer.DestroyTexture(imageTextureCache[key]);
    if (keyboardTexture) {
      renderer.DestroyTexture(keyboardTexture);
      keyboardTexture = null;
    }
    passes = [];
    passShaders = {};
    passBuffers = {};
    imageTextureCache = {};
    frame = 0;
    currentShaderRenderID++;
    
    const currentTime = performance.now() * 0.001;
    resetTime = currentTime;
    pausedTime = 0;
    
    if (paused) {
      lastRealTime = resetTime;
    } else {
      lastRealTime = 0;
    }
    
    uniforms = {
      res: new Float32Array([0, 0, 0]),
      time: 0,
      mouse: new Float32Array([0, 0, 0, 0]),
      frame: 0
    };
  }

  // --- Render Loop using piRenderer ---
  function render(time: number, renderID = currentShaderRenderID) {
    if (!running || renderID !== currentShaderRenderID) return;

    if (frame === 0) {
      fpsCounter.Reset(time);
    }

    if (fpsCounter.Count(time)) {
      currentFPS = fpsCounter.GetFPS();
    }

    uniforms.res = new Float32Array([glCanvas.width, glCanvas.height, glCanvas.width / glCanvas.height]);
    uniforms.time = paused ? (lastRealTime - resetTime) - pausedTime : (time * 0.001 - resetTime) - pausedTime;
    uniforms.mouse = mouse;
    uniforms.frame = frame;

    // --- Render all buffer passes ---
    for (const pass of passes) {
      if (pass.name === "Image") continue;
      const buffers = passBuffers[pass.name];
      drawPass(pass, buffers.back, uniforms);
      
      const temp = buffers.front;
      buffers.front = buffers.back;
      buffers.back = temp;
    }

    // --- Render final Image pass to screen ---
    const imagePass = passes.find(p => p.name === "Image");
    if (imagePass) {
      drawPass(imagePass, null, uniforms);
    }

    // Clear the "just pressed" state for the next frame
    keyPressed.fill(0);

    frame++;
    requestAnimationFrame((t) => render(t, renderID)); // ✅ forward renderID
  }

  function drawPass(pass: PassConfig, target: any, uniforms: {res: Float32Array, time: number, mouse: Float32Array, frame: number}) {
    const shader = passShaders[pass.name];
    if (!shader) return;

    if (target) {
      renderer.SetViewport([0, 0, target.mTex0.mXres, target.mTex0.mYres]);
    } else {
      renderer.SetViewport([0, 0, glCanvas.width, glCanvas.height]);
    }

    renderer.SetRenderTarget(target);
    renderer.AttachShader(shader);

    renderer.SetShaderConstant3FV("iResolution", uniforms.res);
    renderer.SetShaderConstant1F("iTime", uniforms.time);
    renderer.SetShaderConstant4FV("iMouse", uniforms.mouse);
    renderer.SetShaderConstant1I("iFrame", uniforms.frame);

    let texturesToBind = [defaultTexture, defaultTexture, defaultTexture, defaultTexture];
    for (let i = 0; i < 4; i++) {
      const input = pass.inputs[`iChannel${i}`];
      if (input) {
        if (input.type === 'image' && input.path) {
          texturesToBind[i] = imageTextureCache[input.path] || defaultTexture;
        } else if (input.type === 'keyboard') {
          updateKeyboardTexture();
          texturesToBind[i] = keyboardTexture || defaultTexture;
        } else if (input.type === 'buffer') {
          if (input.source === pass.name) {
            texturesToBind[i] = passBuffers[pass.name].front.mTex0;
          } else if (passBuffers[input.source]) {
            texturesToBind[i] = passBuffers[input.source].front.mTex0;
          }
        }
      }
    }
    renderer.AttachTextures(4, texturesToBind[0], texturesToBind[1], texturesToBind[2], texturesToBind[3]);
    renderer.SetShaderTextureUnit('iChannel0', 0);
    renderer.SetShaderTextureUnit('iChannel1', 1);
    renderer.SetShaderTextureUnit('iChannel2', 2);
    renderer.SetShaderTextureUnit('iChannel3', 3);

    const posLoc = renderer.GetAttribLocation(shader, 'position');
    renderer.DrawUnitQuad_XY(posLoc);
  }
</script>

<div class="main-container">
    <div class="canvas-container">
        <canvas bind:this={glCanvas}></canvas>
    </div>
<div class="menu-bar">
  <div class="left-group">
    <button on:click={reset}> 
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <rect x="2" y="5" width="2" height="14" />
        <path d="M20 5L8 12L20 19V5Z" />
      </svg>
    </button>
    <button on:click={togglePause}>
      {#if paused}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="5" width="4" height="14" />
          <rect x="14" y="5" width="4" height="14" />
        </svg>
      {/if}
    </button>
   <div class="menu-title">{uniforms.time.toFixed(2)}</div>
    <div class="menu-title">{currentFPS.toFixed(1)} FPS</div>
    <div class="menu-title">{glCanvas?.width} x {glCanvas?.height}</div>
  </div>
  <div class="right-group">
    <button on:click={toggleLock}>
      {#if isLocked}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" stroke="none" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      </svg>
      {/if}
    </button>
  </div>
</div>
</div>

<style>
    :global(html, body) {
        margin: 0;
        padding: 0;
        overflow: hidden;
        height: 100%;
        width: 100%;
        display: flex;
    }

    .main-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
    }

    .canvas-container {
      flex-grow: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      /* padding: 0 2rem; */
      width: 100%;
      height: 100%;
    }

    canvas {
        display: block;
        background-color: black;
        
    }

  .menu-bar {
    background-color: var(--vscode-sideBar-background);
    color: var(--vscode-sideBar-foreground);
    padding: 0.4rem 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--vscode-panel-border);
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000; /* Ensure it stays on top */
  }

  .left-group, .right-group {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .menu-title {
    font-size: var(--vscode-font-size, 13px);
    font-family: var(--vscode-font-family, sans-serif);
    font-weight: var(--vscode-font-weight, normal);
    color: var(--vscode-editor-foreground);
    user-select: none;
  }

  button {
    all: unset;
    cursor: pointer;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    color: var(--vscode-editor-foreground);
  }

  button:hover {
    background-color: var(--vscode-list-hoverBackground);
  }
/* 
  .status-text {
    font-size: var(--vscode-font-size, 12px);
    opacity: 0.7;
    user-select: none;
  } */
</style>