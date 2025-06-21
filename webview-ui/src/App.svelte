<script lang="ts">
  import { onMount } from 'svelte';

  let glCanvas: HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let program: WebGLProgram | null = null;
  let resLoc: WebGLUniformLocation;
  let timeLoc: WebGLUniformLocation;
  let mouseLoc: WebGLUniformLocation;
  let tex: WebGLTexture;
  let fragShaderSrc = '';
  let running = false;
  let mouse = [0, 0, 0, 0];
  let isMouseDown = false;
  let buffer: WebGLBuffer;

  // Hold up to 4 channel textures
  let channelTextures: (WebGLTexture | null)[] = [null, null, null, null];

  let keyboardState = new Uint8Array(256); // 256 keys
  let keyboardTexture: WebGLTexture | null = null;

  const vscode = acquireVsCodeApi();
  vscode.postMessage({ type: 'debug', payload: ['Svelte loaded'] });

  // --- Texture loader ---
  function loadTextureFromUrl(
    gl: WebGL2RenderingContext,
    url: string,
    opts: { filter?: string; wrap?: string; vflip?: boolean } = {}
  ): Promise<WebGLTexture> {
    // Set defaults
    const filter = opts.filter ?? "mipmap";
    const wrap = opts.wrap ?? "repeat";
    const vflip = opts.vflip !== undefined ? opts.vflip : true;

    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.crossOrigin = '';
      image.onload = () => {
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Vertical flip
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, vflip);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        // Filter
        if (filter === "nearest") {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        } else if (filter === "linear") {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        } else { // mipmap (default)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.generateMipmap(gl.TEXTURE_2D);
        }

        // Wrap
        if (wrap === "clamp") {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } else { // repeat (default)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        }

        resolve(texture);
      };
      image.onerror = reject;
      image.src = url;
    });
  }

  function wrapShaderToyCode(code: string): string {
    code = code.replace(/vec3\s+([a-zA-Z0-9_]+)\s*=\s*iResolution\s*;/g, 'vec3 $1 = vec3(iResolution, 1.0);');

    const injectChannels = ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3']
      .filter(ch => !new RegExp(`uniform\\s+sampler2D\\s+${ch}\\s*;`).test(code))
      .map(ch => `uniform sampler2D ${ch};`)
      .join('\n');

    const injectMouse = !/uniform\s+vec4\s+iMouse\s*;/.test(code) ? `uniform vec4 iMouse;\n` : '';
    const injectFrame = !/uniform\s+int\s+iFrame\s*;/.test(code) ? `uniform int iFrame;\n` : '';

    return `#version 300 es
    precision highp float;

    uniform vec2 iResolution;
    uniform float iTime;
    ${injectChannels}
    ${injectMouse}
    ${injectFrame}

    out vec4 fragColor;

    ${code}

    void main() {
      mainImage(fragColor, gl_FragCoord.xy);
    }`;
  }

  function createShader(gl: WebGL2RenderingContext, type: number, src: string) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      let err = gl.getShaderInfoLog(shader) ?? "";
      const BOILERPLATE_LINES = 16;
      err = err.replace(/ERROR: 0:(\d+):/g, (m, p1) => {
        const userLine = Math.max(0, parseInt(p1, 10) - BOILERPLATE_LINES);
        return `ERROR: 0:${userLine}:`;
      });
      err = err.slice(0, -1);
      vscode.postMessage({ type: 'error', payload: [`${err}`] });
      return null;
    }
    return shader;
  }

  let frame = 0;
  let frameLoc: WebGLUniformLocation;

  function startRenderLoop() {
    if (running) return;
    running = true;
    requestAnimationFrame(multipassDraw); // Use multipassDraw, not draw
  }

  function updateKeyboardTexture(gl: WebGL2RenderingContext) {
    if (!keyboardTexture) {
        keyboardTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, keyboardTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, keyboardState);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
        gl.bindTexture(gl.TEXTURE_2D, keyboardTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, keyboardState);
    }
  }

  onMount(() => {
    gl = glCanvas.getContext('webgl2')!;
    if (!gl) {
      vscode.postMessage({ type: 'error', payload: ['❌ WebGL2 not supported'] });
      return;
    }

    tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    glCanvas.addEventListener('mousedown', () => {
      isMouseDown = true;
    });

    glCanvas.addEventListener('mouseup', () => {
      isMouseDown = false;
    });

    glCanvas.addEventListener('mousemove', (e) => {
      if (!isMouseDown) return;
      const rect = glCanvas.getBoundingClientRect();
      mouse[0] = e.clientX - rect.left;
      mouse[1] = glCanvas.height - (e.clientY - rect.top);
      mouse[2] = mouse[0];
      mouse[3] = mouse[1];
    });

    window.addEventListener('keydown', (e) => {
      if (e.keyCode < 256) {
        if (keyboardState[e.keyCode] !== 255) {
          keyboardState[e.keyCode] = 255;
          vscode.postMessage({ type: 'debug', payload: [`KeyDown: code=${e.keyCode}`] });
        } else {
          keyboardState[e.keyCode] = 0;
        }
      }
    });
   

    window.addEventListener('message', async (event) => {
      const { type, code, config } = event.data;
      if (type === 'shaderSource') {
        fragShaderSrc = code;
        if (config) {
          vscode.postMessage({ type: 'debug', payload: [`Received config: ${JSON.stringify(config)}`] });
        }
        const usedConfig = config ?? {};

        // Build passes
        buildPasses(usedConfig);

        // Fetch shader sources for buffer passes
        for (const pass of passes) {
          if (pass.path) {
            pass.shader = await fetchShaderSource(pass.path);
          } else {
            pass.shader = fragShaderSrc;
          }
        }

        // Create programs and framebuffers/textures for each pass
        for (const pass of passes) {
          const vs = createShader(gl, gl.VERTEX_SHADER, `#version 300 es
            in vec2 position;
            void main() {
              gl_Position = vec4(position, 0.0, 1.0);
            }
          `);
          const fs = createShader(gl, gl.FRAGMENT_SHADER, wrapShaderToyCode(pass.shader));
          if (!vs || !fs) continue;
          const prog = gl.createProgram()!;
          gl.attachShader(prog, vs);
          gl.attachShader(prog, fs);
          gl.linkProgram(prog);
          passPrograms[pass.name] = prog;

          // Set up uniforms for each program
          passUniforms[pass.name] = {
            resLoc: gl.getUniformLocation(prog, 'iResolution')!,
            timeLoc: gl.getUniformLocation(prog, 'iTime')!,
            mouseLoc: gl.getUniformLocation(prog, 'iMouse')!,
            frameLoc: gl.getUniformLocation(prog, 'iFrame')!,
          };

          if (pass.name !== "Image") {
            passBuffers[pass.name] = createPingPongBuffers(gl, glCanvas.width, glCanvas.height);
            // Store the initial texture reference
            passTextures[pass.name] = passBuffers[pass.name].front.tex;
          } else {
            vscode.postMessage({ type: 'log', payload: [`Shader compiled and linked`] });
          }
        }

        // Preload image textures before rendering
        for (const pass of passes) {
          for (let i = 0; i < 4; i++) {
            const input = pass.inputs[`iChannel${i}`];
            if (input && input.type === 'image' && input.path && !imageTextureCache[input.path]) {
              imageTextureCache[input.path] = await loadTextureFromUrl(gl, input.path);
            }
          }
        }

        // Now start the multipass render loop
        frame = 0;
        startRenderLoop();
      }
    });
  });

  type PassConfig = {
    name: string;
    shader: string;
    inputs: Record<string, any>;
    path?: string;
  };

  let passes: PassConfig[] = [];
  let passPrograms: Record<string, WebGLProgram> = {};
  let passTextures: Record<string, WebGLTexture> = {};
  let passFramebuffers: Record<string, WebGLFramebuffer> = {};

  // Add these declarations near the other state variables
  type BufferPair = {
    front: { tex: WebGLTexture, fb: WebGLFramebuffer },
    back: { tex: WebGLTexture, fb: WebGLFramebuffer }
  };

  let passBuffers: Record<string, BufferPair> = {};

  function buildPasses(config: any) {
    passes = [];
    // If config is missing or has no passes, create a default Image pass
    const passNames = config ? Object.keys(config).filter(k => k !== "version") : [];
    if (passNames.length === 0) {
      passes.push({
        name: "Image",
        shader: fragShaderSrc,
        inputs: {},
        path: undefined,
      });
      return;
    }
    for (const passName of passNames) {
      const pass = config[passName];
      let shader = "";
      if (pass.path) {
        shader = ""; // Will be fetched later
      } else {
        shader = fragShaderSrc;
      }
      passes.push({
        name: passName,
        shader,
        inputs: pass.inputs ?? {},
        path: pass.path,
      });
    }
  }


  async function fetchShaderSource(url: string): Promise<string> {
    const res = await fetch(url);
    return await res.text();
  }

  function createBufferTarget(gl: WebGL2RenderingContext, width: number, height: number) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    return { tex, fb };
  }

  function createPingPongBuffers(gl: WebGL2RenderingContext, width: number, height: number): BufferPair {
    return {
      front: createBufferTarget(gl, width, height),
      back: createBufferTarget(gl, width, height)
    };
  }

  let imageTextureCache: Record<string, WebGLTexture> = {};
  let passUniforms: Record<string, { resLoc: WebGLUniformLocation, timeLoc: WebGLUniformLocation, mouseLoc: WebGLUniformLocation, frameLoc: WebGLUniformLocation }> = {};

  async function multipassDraw(time: number) {
    if (!running) return;

    // --- Render all buffer passes ---
    for (const pass of passes) {
      if (pass.name === "Image") continue;

      const buffers = passBuffers[pass.name];
      // Render to the back buffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffers.back.fb);
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.useProgram(passPrograms[pass.name]);

      // Setup vertex attribs for this program
      const posLoc = gl.getAttribLocation(passPrograms[pass.name], 'position');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      // Bind inputs
      for (let i = 0; i < 4; i++) {
        const chanLoc = gl.getUniformLocation(passPrograms[pass.name], `iChannel${i}`);
        let texToBind = tex;
        const input = pass.inputs[`iChannel${i}`];
        if (input) {
          if (input.type === 'image' && input.path) {
            texToBind = imageTextureCache[input.path];
          } else if (input.type && input.type.toLowerCase() === 'keyboard') {
            updateKeyboardTexture(gl);
            texToBind = keyboardTexture!;
          } else if (input.type && input.type.toLowerCase() === 'buffer') {
            if (input.source === pass.name) {
              // If reading from self, use the front buffer
              texToBind = buffers.front.tex;
            } else {
              // If reading from another buffer, use its current texture
              texToBind = passTextures[input.source];
            }
          }
        }
        if (chanLoc) {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, texToBind);
          gl.uniform1i(chanLoc, i);
        }
      }

      // Set uniforms for this program
      const uniforms = passUniforms[pass.name];
      gl.uniform2f(uniforms.resLoc, glCanvas.width, glCanvas.height);
      gl.uniform1f(uniforms.timeLoc, time * 0.001);
      gl.uniform4fv(uniforms.mouseLoc, mouse);
      gl.uniform1i(uniforms.frameLoc, frame++);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Swap front and back buffers
      const temp = buffers.front;
      buffers.front = buffers.back;
      buffers.back = temp;
      // Update the texture reference for other passes to use
      passTextures[pass.name] = buffers.front.tex;
    }

    // --- Render final Image pass to screen ---
    const imagePass = passes.find(p => p.name === "Image");
    if (imagePass) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.useProgram(passPrograms["Image"]);

      // Setup vertex attribs for this program
      const posLoc = gl.getAttribLocation(passPrograms["Image"], 'position');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      for (let i = 0; i < 4; i++) {
        const chanLoc = gl.getUniformLocation(passPrograms["Image"], `iChannel${i}`);
        let texToBind = tex;
        const input = imagePass.inputs[`iChannel${i}`];
        if (input) {
          if (input.type === 'image' && input.path) {
            texToBind = imageTextureCache[input.path];
          } else if (input.type && input.type.toLowerCase() === 'keyboard') {
            updateKeyboardTexture(gl);
            texToBind = keyboardTexture!;
          } else if (input.type && input.type.toLowerCase() === 'buffer' && input.source) {
            texToBind = passTextures[input.source];
          }
        }
        if (chanLoc) {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, texToBind);
          gl.uniform1i(chanLoc, i);
        }
      }

      // Set uniforms for this program
      const uniforms = passUniforms["Image"];
      gl.uniform2f(uniforms.resLoc, glCanvas.width, glCanvas.height);
      gl.uniform1f(uniforms.timeLoc, time * 0.001);
      gl.uniform4fv(uniforms.mouseLoc, mouse);
      gl.uniform1i(uniforms.frameLoc, frame++);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    requestAnimationFrame(multipassDraw);
  }

  function cleanup() {
    for (const [passName, buffers] of Object.entries(passBuffers)) {
      gl.deleteFramebuffer(buffers.front.fb);
      gl.deleteFramebuffer(buffers.back.fb);
      gl.deleteTexture(buffers.front.tex);
      gl.deleteTexture(buffers.back.tex);
    }
    passBuffers = {};
  }
</script>

<canvas bind:this={glCanvas} width={800} height={600} style="background-color: black;"></canvas>