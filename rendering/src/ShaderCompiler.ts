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

    const hasMainImage = /\bmainImage\s*\(/.test(code);
    const hasMainCubemap = /\bmainCubemap\s*\(/.test(code);

    let mainWrapper = "\nvoid main() {\n mainImage(fragColor, gl_FragCoord.xy);\n}";
    if (!hasMainImage && hasMainCubemap) {
      mainWrapper = `
void main() {
  // T-cross layout (4 columns x 3 rows):
  //       [+Y]
  // [-X]  [+Z]  [+X]  [-Z]
  //       [-Y]
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float col = uv.x * 4.0;
  float row = uv.y * 3.0;
  int ci = int(floor(col));
  int ri = int(floor(row));
  vec2 fuv = vec2(fract(col), fract(row)) * 2.0 - 1.0;

  vec3 rd = vec3(0.0, 0.0, 1.0);
  bool valid = false;

  if (ri == 2 && ci == 1) { rd = vec3(fuv.x, 1.0, -fuv.y); valid = true; } // +Y
  else if (ri == 1) {
    if      (ci == 0) { rd = vec3(-1.0, fuv.y, fuv.x);  valid = true; } // -X
    else if (ci == 1) { rd = vec3(fuv.x, fuv.y, 1.0);   valid = true; } // +Z
    else if (ci == 2) { rd = vec3(1.0, fuv.y, -fuv.x);  valid = true; } // +X
    else if (ci == 3) { rd = vec3(-fuv.x, fuv.y, -1.0); valid = true; } // -Z
  } else if (ri == 0 && ci == 1) { rd = vec3(fuv.x, -1.0, fuv.y); valid = true; } // -Y

  if (valid) {
    vec3 ro = vec3(0.0, 0.0, 0.0);
    mainCubemap(fragColor, gl_FragCoord.xy, ro, normalize(rd));
  } else {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}`;
    }

    const shaderCode = header + code + mainWrapper;
    const headerLineCount = (header.match(/\n/g) || []).length;
    return { wrappedCode: shaderCode, headerLineCount, commonCodeLineCount };
  }

  public wrapCubemapCode(
    code: string,
    commonCode?: string,
    channelTypes?: ChannelSamplerType[],
  ): { wrappedCode: string; headerLineCount: number } {
    const types = channelTypes || ['2D', '2D', '2D', '2D'];

    let header = `
precision highp float;
out vec4 fragColor;
#define HW_PERFORMANCE 1
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform ${this.getSamplerType(types[0])} iChannel0;
uniform ${this.getSamplerType(types[1])} iChannel1;
uniform ${this.getSamplerType(types[2])} iChannel2;
uniform ${this.getSamplerType(types[3])} iChannel3;
uniform vec3 iChannelResolution[4];
uniform vec4 iMouse;
uniform int iFrame;
uniform vec4 iDate;
uniform float iChannelTime[4];
uniform float iSampleRate;
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
uniform vec4 unViewport;
uniform vec3 unCorners[5];
`;

    if (commonCode) {
      header += commonCode + "\n";
    }

    const shaderCode = header + code + `
void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  vec3 ro = unCorners[4];
  vec3 rd = normalize(
    mix(mix(unCorners[0], unCorners[1], uv.x),
        mix(unCorners[3], unCorners[2], uv.x), uv.y) - ro
  );
  mainCubemap(fragColor, gl_FragCoord.xy, ro, rd);
}`;
    const headerLineCount = (header.match(/\n/g) || []).length;
    return { wrappedCode: shaderCode, headerLineCount };
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

  public compileCubemapShader(
    shaderSrc: string,
    commonCode?: string,
    channelTypes?: ChannelSamplerType[],
  ): PiShader | null {
    const vs =
      `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const { wrappedCode: fs } = this.wrapCubemapCode(shaderSrc, commonCode, channelTypes);
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
