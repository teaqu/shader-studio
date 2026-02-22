import type { PiRenderer, PiShader } from "./types/piRenderer";

export class ShaderCompiler {
  constructor(private renderer: PiRenderer) { }

  public wrapShaderToyCode(
    code: string,
    commonCode?: string,
  ): { wrappedCode: string; headerLineCount: number; commonCodeLineCount: number } {
    let header = `
precision highp float;
out vec4 fragColor;
#define HW_PERFORMANCE 1
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec3 iChannelResolution[4];
uniform vec4 iMouse;
uniform int iFrame;
uniform vec4 iDate;
`;

    let commonCodeLineCount = 0;
    if (commonCode) {
      commonCodeLineCount = (commonCode.match(/\n/g) || []).length + 1;
      header += commonCode + "\n";
    }

    const shaderCode = header + code + "\nvoid main() {\n mainImage(fragColor, gl_FragCoord.xy);\n}";
    const headerLineCount = (header.match(/\n/g) || []).length;
    return { wrappedCode: shaderCode, headerLineCount, commonCodeLineCount };
  }

  public compileShader(shaderSrc: string, commonCode?: string): PiShader | null {
    const vs =
      `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const { wrappedCode: fs } = this.wrapShaderToyCode(shaderSrc, commonCode);
    return this.renderer.CreateShader(vs, fs);
  }
}
