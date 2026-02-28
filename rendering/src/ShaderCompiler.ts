import type { PiRenderer, PiShader } from "./types/piRenderer";
import type { SlotAssignment } from "./util/InputSlotAssigner";

export class ShaderCompiler {
  constructor(private renderer: PiRenderer) { }

  public wrapShaderToyCode(
    code: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
  ): { wrappedCode: string; headerLineCount: number; commonCodeLineCount: number } {
    const channelDeclarations = this.buildChannelDeclarations(slotAssignments);

    let header = `
precision highp float;
out vec4 fragColor;
#define HW_PERFORMANCE 1
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
${channelDeclarations}
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

  public compileShader(
    shaderSrc: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
  ): PiShader | null {
    const vs =
      `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const { wrappedCode: fs } = this.wrapShaderToyCode(shaderSrc, commonCode, slotAssignments);
    return this.renderer.CreateShader(vs, fs);
  }

  private buildChannelDeclarations(slotAssignments?: SlotAssignment[]): string {
    // At least 4 slots for backwards compatibility
    const channelCount = !slotAssignments || slotAssignments.length === 0
      ? 4
      : Math.max(4, slotAssignments.length);

    let decl = "";
    // Always declare iChannel0 through iChannel{N-1} — these are the slot uniforms
    for (let i = 0; i < channelCount; i++) {
      decl += `uniform sampler2D iChannel${i};\n`;
    }
    // Declare custom name aliases for slots where the key differs from iChannel{N}
    if (slotAssignments) {
      for (const { key, isCustomName } of slotAssignments) {
        if (isCustomName) {
          decl += `uniform sampler2D ${key};\n`;
        }
      }
    }
    decl += `uniform vec3 iChannelResolution[${channelCount}];\n`;
    return decl;
  }
}
