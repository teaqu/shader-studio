<script lang="ts">
  import { onMount } from 'svelte';

  let glCanvas: HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let program: WebGLProgram | null = null;
  let resLoc: WebGLUniformLocation;
  let timeLoc: WebGLUniformLocation;
  let tex: WebGLTexture;
  let fragShaderSrc = '';
  let running = false;

  function wrapShaderToyCode(code: string): string {
    code = code.replace(/vec3\s+([a-zA-Z0-9_]+)\s*=\s*iResolution\s*;/g, 'vec3 $1 = vec3(iResolution, 1.0);');

    const injectChannels = ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3']
      .filter(ch => !new RegExp(`uniform\\s+sampler2D\\s+${ch}\\s*;`).test(code))
      .map(ch => `uniform sampler2D ${ch};`)
      .join('\n');

    return `#version 300 es
    precision highp float;

    uniform vec2 iResolution;
    uniform float iTime;
    ${injectChannels}

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
      const err = gl.getShaderInfoLog(shader);
      console.error("\ud83d\udea9 Shader compile error:\n", err);
      console.error("\ud83d\udcdd Shader source:\n" + src);
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
      console.error("\ud83e\uddf8 Shader link error:\n", gl.getProgramInfoLog(newProgram));
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
      console.error("\u274c WebGL2 not supported");
      return;
    }

    tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    window.addEventListener('message', (event) => {
      const { type, code } = event.data;
      if (type === 'shaderSource') {
        fragShaderSrc = code;
        const success = compileAndLinkShader(fragShaderSrc);
        if (success) {
          console.log("\u2705 Shader compiled and linked");
          startRenderLoop();
        } else {
          console.warn("\u26a0\ufe0f Shader failed to compile, skipping render loop");
        }
      }
    });
  });
</script>

<canvas bind:this={glCanvas} width={800} height={600} style="background-color: black;"></canvas>
