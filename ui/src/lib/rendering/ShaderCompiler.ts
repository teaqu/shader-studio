import type { PiRenderer } from "../types/piRenderer";

export class ShaderCompiler {
  constructor(private renderer: PiRenderer) {}

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

  public createCopyShader(): any {
    const vs = `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const fs = `
    precision highp float;
    uniform sampler2D srcTex;
    out vec4 fragColor;
    void main() {
      fragColor = texture(srcTex, gl_FragCoord.xy / vec2(textureSize(srcTex, 0)));
    }
  `;
    return this.renderer.CreateShader(vs, fs);
  }

  public compileShader(shaderSrc: string): any {
    const vs =
      `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const { wrappedCode: fs } = this.wrapShaderToyCode(shaderSrc);
    return this.renderer.CreateShader(vs, fs);
  }
}
