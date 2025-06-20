<script lang="ts">
  import { onMount } from 'svelte';

  let glCanvas: HTMLCanvasElement;
  let fragShaderSrc = '';

  function wrapShaderToyCode(code: string): string {
  const hasMainImage = /void\s+mainImage\s*\(/.test(code);

  return `
    precision mediump float;
    uniform vec2 iResolution;
    uniform float iTime;

    ${code}

    void main() {
      vec4 fragColor;
      mainImage(fragColor, gl_FragCoord.xy);
      gl_FragColor = fragColor;
    }
  `;
}

  function createShader(gl: WebGLRenderingContext, type: number, src: string) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader);
      console.error("🛑 Shader compile error:\n", err);
      console.error("📝 Shader source:\n" + src);
    }
    return shader;
  }

  function renderShader(gl: WebGLRenderingContext) {
    const vs = createShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `);

    const fs = createShader(gl, gl.FRAGMENT_SHADER, wrapShaderToyCode(fragShaderSrc));
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    const linkStatus = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linkStatus) {
      console.error("🧨 Shader program link error:", gl.getProgramInfoLog(program));
    }

    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, 'position');
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1, 1,   1, -1,  1, 1
    ]), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const resLoc = gl.getUniformLocation(program, 'iResolution');
    const timeLoc = gl.getUniformLocation(program, 'iTime');

    function draw(t: number) {
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(resLoc, glCanvas.width, glCanvas.height);
      gl.uniform1f(timeLoc, t * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  }

  function startRender() {
    const gl = glCanvas.getContext('webgl')!;
    renderShader(gl);
  }

  onMount(() => {
    window.addEventListener('message', (event) => {
      const { type, code } = event.data;
      if (type === 'shaderSource') {
        fragShaderSrc = code;
        startRender();
      }
        console.log("✅ Svelte app mounted!");
    });
  });
</script>

<canvas bind:this={glCanvas} width={800} height={600} style="background-color: black;"></canvas>