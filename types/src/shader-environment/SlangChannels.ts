import { deriveSlangChannelGeneratedIdentifiers } from './ShaderAuthoringEnvironment';

export interface SlangChannelDeclaration {
  name: string;
  slot: number;
  kind: 'texture-2d' | 'texture-cube' | 'texture-3d';
}

export type SlangChannelKind = SlangChannelDeclaration['kind'];

export interface SlangChannelMethodDescription {
  readonly name: 'Sample' | 'SampleLevel' | 'SampleGrad';
  readonly parameters: string;
  readonly arguments: string;
  readonly nativeArguments: string;
  readonly requiresFragment: boolean;
}

export interface SlangChannelDescription {
  readonly shape: '2D' | 'Cube' | '3D';
  readonly textureType: string;
  readonly sizeType: 'uint2' | 'uint3';
  readonly methods: readonly SlangChannelMethodDescription[];
}

/** Public member contract shared by generated Slang and editor tooling. */
export function describeSlangChannel(kind: SlangChannelKind): SlangChannelDescription {
  const shape = kind === 'texture-cube' ? 'Cube' : kind === 'texture-3d' ? '3D' : '2D';
  const dimensions = kind === 'texture-2d' ? 2 : 3;
  const coordinate = kind === 'texture-cube' ? 'dir' : 'uv';
  const vector = `float${dimensions}`;
  const position = kind === 'texture-cube' ? coordinate : dimensions === 2 ? 'float2(uv.x, 1.0 - uv.y)' : 'float3(uv.x, 1.0 - uv.y, uv.z)';
  const gradient = (name: string) => kind === 'texture-cube' ? name : dimensions === 2 ? `float2(${name}.x, -${name}.y)` : `float3(${name}.x, -${name}.y, ${name}.z)`;
  return {
    shape,
    textureType: `Texture${shape}<float4>`,
    sizeType: kind === 'texture-3d' ? 'uint3' : 'uint2',
    methods: [
      { name: 'Sample', parameters: `${vector} ${coordinate}`, arguments: coordinate, nativeArguments: position, requiresFragment: true },
      { name: 'SampleLevel', parameters: `${vector} ${coordinate}, float lod`, arguments: `${coordinate}, lod`, nativeArguments: `${position}, lod`, requiresFragment: false },
      { name: 'SampleGrad', parameters: `${vector} ${coordinate}, ${vector} dx, ${vector} dy`, arguments: `${coordinate}, dx, dy`, nativeArguments: `${position}, ${gradient('dx')}, ${gradient('dy')}`, requiresFragment: false },
    ],
  };
}

/** Shared by editor declarations and renderer bindings; native access uses native coordinates. */
export function buildSlangChannels(
  declarations: readonly SlangChannelDeclaration[],
  options: { runtime?: boolean; channelCount?: number } = {},
): string {
  const sorted = [...declarations].sort((a, b) => a.slot - b.slot);
  const kinds = [...new Set(sorted.map(({ kind }) => kind))];
  const suffix = (kind: SlangChannelKind) => describeSlangChannel(kind).shape;
  const types = kinds.map((kind) => {
    const description = describeSlangChannel(kind);
    const methods = description.methods.map(({ name, parameters, arguments: args, nativeArguments, requiresFragment }) => `
${requiresFragment ? '    [require(wgsl, fragment)]\n' : ''}    float4 ${name}(SamplerState sampling, ${parameters})
    {
        return texture.${name}(sampling, ${nativeArguments});
    }
${requiresFragment ? '    [require(wgsl, fragment)]\n' : ''}    float4 ${name}(${parameters})
    {
        return ${name}(sampler, ${args});
    }`).join('\n');
    return `struct ShaderStudioChannel${description.shape}
{
    ${description.textureType} texture;
    SamplerState sampler;
    ${description.sizeType} size;
    float time;
    bool loaded;
${methods}
};`;
  }).join('\n\n');
  const bindings = sorted.map(({ name, slot, kind }, index) => {
    const { texture, sampler } = deriveSlangChannelGeneratedIdentifiers({ resource: { name, kind }, slot });
    const annotation = (binding: number) => options.runtime ? `[[vk::binding(${binding}, 0)]]\n` : '';
    return `${annotation(1 + index * 2)}Texture${suffix(kind)}<float4> ${texture};
${annotation(2 + index * 2)}SamplerState ${sampler};`;
  }).join('\n');
  const count = options.channelCount ?? Math.max(4, ...sorted.map(({ slot }) => slot + 1));
  const metadata = options.runtime ? '' : `float3 _ssChannelResolution[${count}];
float _ssChannelTime[${count}];
float _ssChannelLoaded[${count}];`;
  const resolution = options.runtime ? '_st.channelResolution' : '_ssChannelResolution';
  const time = options.runtime ? '_st.channelTime' : '_ssChannelTime';
  const loaded = options.runtime ? '_st.channelLoaded' : '_ssChannelLoaded';
  const fields = sorted.map(({ name, slot, kind }) => {
    const { texture, sampler } = deriveSlangChannelGeneratedIdentifiers({ resource: { name, kind }, slot });
    const size = kind === 'texture-3d' ? `uint3(${resolution}[${slot}])` : `uint2(${resolution}[${slot}].xy)`;
    return `    property ShaderStudioChannel${suffix(kind)} ${name}
    {
        get
        {
            ShaderStudioChannel${suffix(kind)} result;
            result.texture = ${texture};
            result.sampler = ${sampler};
            result.size = ${size};
            result.time = ${time}[${slot}];
            result.loaded = ${loaded}[${slot}] != 0.0;
            return result;
        }
    }`;
  }).join('\n');
  return `${types}
${bindings}
${metadata}
struct ShaderStudioInputs
{
${fields}
};
static ShaderStudioInputs inputs;
`;
}
