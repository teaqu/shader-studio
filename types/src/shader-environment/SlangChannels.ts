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

/** Portable names are shape-specific because WGSL user functions cannot overload. */
export function channelSampleFunction(kind: SlangChannelKind, method: SlangChannelMethodDescription['name']): string {
  return `sample${describeSlangChannel(kind).shape}${method === 'Sample' ? '' : method.slice('Sample'.length)}`;
}

export function buildChannelSamplingFunctions(kinds: readonly SlangChannelKind[], language: 'slang' | 'wgsl', fragmentStage = true): string {
  return [...new Set(kinds)].map(kind => {
    const description = describeSlangChannel(kind);
    return description.methods.filter(method => language === 'slang' || fragmentStage || !method.requiresFragment).map(method => {
      const name = channelSampleFunction(kind, method.name);
      if (language === 'slang') {
        return `${method.requiresFragment ? '[require(wgsl, fragment)]\n' : ''}float4 ${name}(${description.textureType} texture, SamplerState sampling, ${method.parameters})
{
    return texture.${method.name}(sampling, ${method.nativeArguments});
}`;
      }
      const texture = kind === 'texture-cube' ? 'texture_cube<f32>' : kind === 'texture-3d' ? 'texture_3d<f32>' : 'texture_2d<f32>';
      const wgslType = (type: string) => type === 'float' ? 'f32' : type.replace('float', 'vec') + 'f';
      const parameters = method.parameters.split(', ').map(parameter => {
        const [type, identifier] = parameter.split(' ');
        return `${identifier}: ${wgslType(type!)}`;
      }).join(', ');
      const args = method.nativeArguments.replace(/float([23])/g, 'vec$1f');
      return `fn ${name}(texture: ${texture}, sampling: sampler, ${parameters}) -> vec4<f32> {
  return texture${method.name}(texture, sampling, ${args});
}`;
    }).join('\n');
  }).join('\n');
}

/** Shared by editor declarations and renderer bindings; native access uses native coordinates. */
export function buildSlangChannels(
  declarations: readonly SlangChannelDeclaration[],
  options: { runtime?: boolean; channelCount?: number; bindings?: readonly { slot: number; textureBinding: number; samplerBinding: number }[] } = {},
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
  const textureNames = new Map<number, string>();
  const samplerNames = new Map<number, string>();
  const resourceNames = new Map<number, { texture: string; sampler: string }>();
  const bindingBySlot = new Map(options.bindings?.map(binding => [binding.slot, binding]));
  const bindings = sorted.map(({ name, slot, kind }, index) => {
    const names = deriveSlangChannelGeneratedIdentifiers({ resource: { name, kind }, slot });
    const binding = bindingBySlot.get(slot);
    const textureBinding = binding?.textureBinding ?? 1 + index * 2;
    const samplerBinding = binding?.samplerBinding ?? 2 + index * 2;
    const annotation = (binding: number) => options.runtime ? `[[vk::binding(${binding}, 0)]]\n` : '';
    const lines: string[] = [];
    if (!textureNames.has(textureBinding)) {
      textureNames.set(textureBinding, names.texture);
      lines.push(`${annotation(textureBinding)}Texture${suffix(kind)}<float4> ${names.texture};`);
    }
    if (!samplerNames.has(samplerBinding)) {
      samplerNames.set(samplerBinding, names.sampler);
      lines.push(`${annotation(samplerBinding)}SamplerState ${names.sampler};`);
    }
    resourceNames.set(slot, { texture: textureNames.get(textureBinding)!, sampler: samplerNames.get(samplerBinding)! });
    return lines.join('\n');
  }).join('\n');
  const count = options.channelCount ?? Math.max(4, ...sorted.map(({ slot }) => slot + 1));
  const metadata = options.runtime ? '' : `float3 _ssChannelResolution[${count}];
float _ssChannelTime[${count}];
float _ssChannelLoaded[${count}];`;
  const resolution = options.runtime ? '_st.channelResolution' : '_ssChannelResolution';
  const time = options.runtime ? '_st.channelTime' : '_ssChannelTime';
  const loaded = options.runtime ? '_st.channelLoaded' : '_ssChannelLoaded';
  const channels = sorted.map(({ name, slot, kind }) => {
    const { texture, sampler } = resourceNames.get(slot)!;
    const size = kind === 'texture-3d' ? `uint3(${resolution}[${slot}])` : `uint2(${resolution}[${slot}].xy)`;
    return `property ShaderStudioChannel${suffix(kind)} ${name}
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
  return `${buildChannelSamplingFunctions(kinds, 'slang')}
${types}
${bindings}
${metadata}
${channels}
`;
}

/** Analysis-only WGSL declarations. Runtime uses real bindings and uniform values. */
export function buildWgslChannelAuthoringSource(declarations: readonly SlangChannelDeclaration[], fragmentStage: boolean): string {
  const lines = ['struct _ss_ChannelMetadata { size: vec2u, time: f32, loaded: bool }'];
  if (declarations.some(channel => channel.kind === 'texture-3d')) {
    lines.push('struct _ss_ChannelMetadata3D { size: vec3u, time: f32, loaded: bool }');
  }
  const kinds = [...new Set(declarations.map(channel => channel.kind))];
  lines.push(buildChannelSamplingFunctions(kinds, 'wgsl', fragmentStage));
  for (const { name, kind } of declarations) {
    const texture = kind === 'texture-cube' ? 'texture_cube<f32>' : kind === 'texture-3d' ? 'texture_3d<f32>' : 'texture_2d<f32>';
    const dimensions = kind === 'texture-3d' ? 'vec3u' : 'vec2u';
    lines.push(`var<private> ${name}: _ss_ChannelMetadata${kind === 'texture-3d' ? '3D' : ''};`, `var ${name}Texture: ${texture};`, `var ${name}Sampler: sampler;`);
    for (const method of describeSlangChannel(kind).methods) {
      if (method.requiresFragment && !fragmentStage) {
        continue;
      }
      const parameters = method.parameters.split(', ').map(parameter => {
        const [type, identifier] = parameter.split(' ');
        return `${identifier}: ${type === 'float' ? 'f32' : type!.replace('float', 'vec') + 'f'}`;
      }).join(', ');
      lines.push(`fn ${name}${method.name}(${parameters}) -> vec4f { return ${channelSampleFunction(kind, method.name)}(${name}Texture, ${name}Sampler, ${method.arguments}); }`);
    }
    lines.push(`fn ${name}Size() -> ${dimensions} { return ${name}.size; }`, `fn ${name}Time() -> f32 { return ${name}.time; }`, `fn ${name}Loaded() -> bool { return ${name}.loaded; }`);
  }
  return lines.join('\n');
}
