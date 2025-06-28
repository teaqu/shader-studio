export class ShaderCompiler {
  public wrapShaderToyCode(
    code: string,
  ): { wrappedCode: string; headerLineCount: number } {
    const injectChannels = ["iChannel0", "iChannel1", "iChannel2", "iChannel3"]
      .filter((ch) =>
        !new RegExp(`uniform\\s+sampler2D\\s+${ch}\\s*;`).test(code)
      )
      .map((ch) => `uniform sampler2D ${ch};`)
      .join("\n");
    const injectMouse = !/uniform\s+vec4\s+iMouse\s*;/.test(code)
      ? `uniform vec4 iMouse;\n`
      : "";
    const injectFrame = !/uniform\s+int\s+iFrame\s*;/.test(code)
      ? `uniform int iFrame;\n`
      : "";

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

  public compileShader(renderer: any, shaderSrc: string): any {
    const vs =
      `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const { wrappedCode: fs } = this.wrapShaderToyCode(shaderSrc);
    return renderer.CreateShader(vs, fs);
  }

  public formatShaderError(
    error: string,
    renderer: any,
    headerLineCount: number,
  ): string {
    return error.replace(/ERROR: 0:(\d+):/g, (m: any, p1: any) => {
      const totalHeaderLines = renderer.GetShaderHeaderLines(1) +
        headerLineCount;
      const userLine = Math.max(1, parseInt(p1, 10) - totalHeaderLines);
      return `ERROR: 0:${userLine}:`;
    });
  }
}
