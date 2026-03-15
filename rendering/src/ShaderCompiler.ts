import type { PiRenderer, PiShader } from "./types/piRenderer";
import type { SlotAssignment } from "./util/InputSlotAssigner";

export type ChannelSamplerType = '2D' | 'Cube' | '3D';

export class ShaderCompiler {
  constructor(private renderer: PiRenderer) { }

  private getSamplerType(type: ChannelSamplerType): string {
    switch (type) {
      case 'Cube': return 'samplerCube';
      case '3D': return 'sampler3D';
      case '2D':
      default: return 'sampler2D';
    }
  }

  public wrapShaderToyCode(
    code: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
  ): { wrappedCode: string; headerLineCount: number; commonCodeLineCount: number } {
    const types = channelTypes || ['2D', '2D', '2D', '2D'];
    const channelDeclarations = this.buildChannelDeclarations(slotAssignments, types);

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
uniform float iChannelTime[4];
uniform float iSampleRate;
uniform vec3 iCameraPos;
uniform vec3 iCameraDir;
uniform struct {
  ${this.getSamplerType(types[0])} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh0;
uniform struct {
  ${this.getSamplerType(types[1])} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh1;
uniform struct {
  ${this.getSamplerType(types[2])} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh2;
uniform struct {
  ${this.getSamplerType(types[3])} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh3;
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
    channelTypes?: ChannelSamplerType[],
  ): PiShader | null {
    const vs =
      `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const { wrappedCode: fs } = this.wrapShaderToyCode(shaderSrc, commonCode, slotAssignments, channelTypes);
    return this.renderer.CreateShader(vs, fs);
  }

  private buildChannelDeclarations(slotAssignments?: SlotAssignment[], channelTypes?: ChannelSamplerType[]): string {
    const types = channelTypes || ['2D', '2D', '2D', '2D'];
    // At least 4 slots for backwards compatibility
    const channelCount = !slotAssignments || slotAssignments.length === 0
      ? 4
      : Math.max(4, slotAssignments.length);

    let decl = "";
    // Always declare iChannel0 through iChannel{N-1} — these are the slot uniforms
    for (let i = 0; i < channelCount; i++) {
      const samplerType = this.getSamplerType(types[i] || '2D');
      decl += `uniform ${samplerType} iChannel${i};\n`;
    }
    // Declare custom name aliases for slots where the key differs from iChannel{N}
    if (slotAssignments) {
      for (const { slot, key, isCustomName } of slotAssignments) {
        if (isCustomName) {
          const samplerType = this.getSamplerType(types[slot] || '2D');
          decl += `uniform ${samplerType} ${key};\n`;
        }
      }
    }
    decl += `uniform vec3 iChannelResolution[${channelCount}];\n`;
    return decl;
  }
}
