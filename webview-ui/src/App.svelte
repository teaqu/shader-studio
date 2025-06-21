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
  
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ type: 'log', payload: ['Hello from Svelte!'] });

  function wrapShaderToyCode(code: string): string {
    code = code.replace(/vec3\s+([a-zA-Z0-9_]+)\s*=\s*iResolution\s*;/g, 'vec3 $1 = vec3(iResolution, 1.0);');

    const injectChannels = ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3']
      .filter(ch => !new RegExp(`uniform\\s+sampler2D\\s+${ch}\\s*;`).test(code))
      .map(ch => `uniform sampler2D ${ch};`)
      .join('\n');

    const injectMouse = !/uniform\s+vec4\s+iMouse\s*;/.test(code) ? `uniform vec4 iMouse;\n` : '';

    return `#version 300 es
    precision highp float;

    uniform vec2 iResolution;
    uniform float iTime;
    ${injectChannels}
    ${injectMouse}

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
      // Adjust line numbers so mainImage is line 0
      const BOILERPLATE_LINES = 14; // Set this to the number of lines before user code
      err = err.replace(/ERROR: 0:(\d+):/g, (m, p1) => {
        const userLine = Math.max(0, parseInt(p1, 10) - BOILERPLATE_LINES);
        return `ERROR: 0:${userLine}:`;
      });

      // remove new line character at the end
      err = err.slice(0, -1);


      vscode.postMessage({ type: 'error', payload: [`${err}`] });
      return null;
    }
    return shader;
  }

  function compileAndLinkShader(code: string): boolean {
    const vs = createShader(gl, gl.VERTEX_SHADER, `#version 300 es
      in vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, wrapShaderToyCode(code));
    if (!vs || !fs) return false;

    const newProgram = gl.createProgram()!;
    gl.attachShader(newProgram, vs);
    gl.attachShader(newProgram, fs);
    gl.linkProgram(newProgram);

    if (!gl.getProgramParameter(newProgram, gl.LINK_STATUS)) {
      vscode.postMessage({ type: 'error', payload: [`🧨 Shader link error:\n${gl.getProgramInfoLog(newProgram)}`] });
      return false;
    }

    program = newProgram;
    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, 'position');
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    resLoc = gl.getUniformLocation(program, 'iResolution')!;
    timeLoc = gl.getUniformLocation(program, 'iTime')!;
    mouseLoc = gl.getUniformLocation(program, 'iMouse')!;

    for (let i = 0; i < 4; i++) {
      const chanLoc = gl.getUniformLocation(program, `iChannel${i}`);
      if (chanLoc) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(chanLoc, i);
      }
    }

    return true;
  }

  function draw(time: number) {
    if (!running || !program) return;

    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(resLoc, glCanvas.width, glCanvas.height);
    gl.uniform1f(timeLoc, time * 0.001);
    gl.uniform4fv(mouseLoc, mouse);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(draw);
  }

  function startRenderLoop() {
    if (running) return;
    running = true;
    requestAnimationFrame(draw);
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

    window.addEventListener('message', (event) => {
      const { type, code } = event.data;
      if (type === 'shaderSource') {
        fragShaderSrc = code;
        const success = compileAndLinkShader(fragShaderSrc);
        if (success) {
          vscode.postMessage({ type: 'log', payload: ['Shader compiled and linked'] });
          startRenderLoop();
        }
      }
    });
  });
</script>

<canvas bind:this={glCanvas} width={800} height={600} style="background-color: black;"></canvas>