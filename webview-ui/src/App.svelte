<script lang="ts">
  import { onMount } from 'svelte';
  import { piRenderer } from './lib/pilibs/src/piRenderer';

  // --- Core State ---
  let glCanvas: HTMLCanvasElement;
  let renderer: any;
  let running = false;
  let frame = 0;
  let mouse = new Float32Array([0, 0, 0, 0]);
  let isMouseDown = false;
  let keyHeld = new Uint8Array(256);
  let keyPressed = new Uint8Array(256);
  let keyToggled = new Uint8Array(256);
  let keyboardBuffer = new Uint8Array(256 * 3); // Combined buffer for texture upload
  const vscode = acquireVsCodeApi();

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

  // --- ShaderToy Compatibility ---
  function wrapShaderToyCode(code: string): string {
    const injectChannels = ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3']
      .filter(ch => !new RegExp(`uniform\\s+sampler2D\\s+${ch}\\s*;`).test(code))
      .map(ch => `uniform sampler2D ${ch};`)
      .join('\n');
    const injectMouse = !/uniform\s+vec4\s+iMouse\s*;/.test(code) ? `uniform vec4 iMouse;\n` : '';
    const injectFrame = !/uniform\s+int\s+iFrame\s*;/.test(code) ? `uniform int iFrame;\n` : '';

    return `
    precision highp float;
    out vec4 fragColor;

    uniform vec3 iResolution;
    uniform float iTime;
    ${injectChannels}
    ${injectMouse}
    ${injectFrame}

    ${code}

    void main() {
      mainImage(fragColor, gl_FragCoord.xy);
    }`;
  }

  // --- Main Setup ---
  onMount(() => {
    const gl = glCanvas.getContext('webgl2');
    if (!gl) {
      vscode.postMessage({ type: 'error', payload: ['❌ WebGL2 not supported'] });
      return;
    }

    renderer = piRenderer();
    if (!renderer.Initialize(gl)) {
      vscode.postMessage({ type: 'error', payload: ['❌ piRenderer could not initialize'] });
      return;
    }

    defaultTexture = renderer.CreateTexture(renderer.TEXTYPE.T2D, 1, 1, renderer.TEXFMT.C4I8, renderer.FILTER.NONE, renderer.TEXWRP.CLAMP, new Uint8Array([0, 0, 0, 255]));

    glCanvas.addEventListener('mousedown', () => { isMouseDown = true; });
    glCanvas.addEventListener('mouseup', () => { isMouseDown = false; });
    glCanvas.addEventListener('mousemove', (e) => {
      if (!isMouseDown) return;
      const rect = glCanvas.getBoundingClientRect();
      mouse[0] = e.clientX - rect.left;
      mouse[1] = glCanvas.height - (e.clientY - rect.top);
      mouse[2] = mouse[0];
      mouse[3] = mouse[1];
    });

    window.addEventListener('keydown', (e) => {
      if (e.keyCode >= 256) return;
      // If key was not previously held, it's a "just pressed" event
      if (keyHeld[e.keyCode] === 0) {
        keyPressed[e.keyCode] = 255;
        // Toggle state only changes on initial press
        keyToggled[e.keyCode] = keyToggled[e.keyCode] === 255 ? 0 : 255;
      }
      // Set key as held
      keyHeld[e.keyCode] = 255;
    });

    window.addEventListener('keyup', (e) => {
      if (e.keyCode >= 256) return;
      // Unset key as held
      keyHeld[e.keyCode] = 0;
    });

    window.addEventListener('message', handleShaderMessage);
    vscode.postMessage({ type: 'debug', payload: ['Svelte with piLibs loaded'] });
  });

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
    const { type, code, config } = event.data;
    if (type !== 'shaderSource') return;

    running = false;
    cleanup();

    const usedConfig = config ?? {};
    const passNames = usedConfig ? Object.keys(usedConfig).filter(k => k !== "version") : [];

    if (passNames.length === 0) {
      passes.push({ name: "Image", shaderSrc: code, inputs: {}, path: undefined });
    } else {
      for (const passName of passNames) {
        const pass = usedConfig[passName];
        passes.push({
          name: passName,
          shaderSrc: pass.path ? "" : code,
          inputs: pass.inputs ?? {},
          path: pass.path,
        });
      }
    }

    for (const pass of passes) {
      if (pass.path) {
        pass.shaderSrc = await fetchShaderSource(pass.path);
      }
    }

    const vs = `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    for (const pass of passes) {
      const fs = wrapShaderToyCode(pass.shaderSrc);
      const shader = renderer.CreateShader(vs, fs);
      if (!shader.mResult) {
        const err = shader.mInfo.replace(/ERROR: 0:(\d+):/g, (m, p1) => {
            const userLine = Math.max(0, parseInt(p1, 10) - renderer.GetShaderHeaderLines(1)) - 15.0;
            return `ERROR: 0:${userLine}:`;
        });
        vscode.postMessage({ type: 'error', payload: [`${err}`] });
        continue;
      }
      passShaders[pass.name] = shader;

      if (pass.name !== "Image") {
        passBuffers[pass.name] = createPingPongBuffers(glCanvas.width, glCanvas.height);
      }
    }

    for (const pass of passes) {
      for (let i = 0; i < 4; i++) {
        const input = pass.inputs[`iChannel${i}`];
        if (input && input.type === 'image' && input.path && !imageTextureCache[input.path]) {
          imageTextureCache[input.path] = await loadTextureFromUrl(input.path, input.opts);
        }
      }
    }

    frame = 0;
    running = true;
    requestAnimationFrame(render);
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
  }

  // --- Render Loop using piRenderer ---
  function render(time: number) {
    if (!running) return;

    const res = new Float32Array([glCanvas.width, glCanvas.height, glCanvas.width / glCanvas.height]);
    const t = time * 0.001;

    const drawPass = (pass: PassConfig, target: any) => {
      const shader = passShaders[pass.name];
      if (!shader) return;

      renderer.SetRenderTarget(target);
      renderer.AttachShader(shader);

      renderer.SetShaderConstant3FV("iResolution", res);
      renderer.SetShaderConstant1F("iTime", t);
      renderer.SetShaderConstant4FV("iMouse", mouse);
      renderer.SetShaderConstant1I("iFrame", frame);

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
    };

    // --- Render all buffer passes ---
    for (const pass of passes) {
      if (pass.name === "Image") continue;
      const buffers = passBuffers[pass.name];
      drawPass(pass, buffers.back);
      
      const temp = buffers.front;
      buffers.front = buffers.back;
      buffers.back = temp;
    }

    // --- Render final Image pass to screen ---
    const imagePass = passes.find(p => p.name === "Image");
    if (imagePass) {
      drawPass(imagePass, null);
    }

    // Clear the "just pressed" state for the next frame
    keyPressed.fill(0);

    frame++;
    requestAnimationFrame(render);
  }
</script>

<canvas bind:this={glCanvas} width={800} height={600} style="background-color: black; width: 100%; height: 100%;"></canvas>