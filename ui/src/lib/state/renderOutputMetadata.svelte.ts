import { getShaderOutputs, type ShaderConfig, type ShaderLanguageId, type BufferPass, type ShaderOutputDiscovery } from '@shader-studio/types';

export type RenderOutputMetadata = Record<string, ShaderOutputDiscovery>;
let metadata = $state<Record<string, RenderOutputMetadata>>({});

export function getRenderOutputMetadata(shaderPath: string): RenderOutputMetadata {
  return metadata[shaderPath] ?? {};
}

export function setRenderOutputMetadata(shaderPath: string, value: RenderOutputMetadata): void {
  metadata[shaderPath] = value;
}

export function discoverRenderOutputs(config: ShaderConfig | null, language: ShaderLanguageId, sourceForPass: (name: string) => string): RenderOutputMetadata {
  const result: RenderOutputMetadata = {};
  for (const [name, pass] of Object.entries(config?.passes ?? {})) {
    if (!pass || name === 'Image' || name === 'common' || ('type' in pass && pass.type === 'compute')) {
      continue;
    }
    const render = pass as BufferPass;
    const discovered = getShaderOutputs(sourceForPass('common') + '\n' + sourceForPass(name), language, render.entryPoints?.fragment);
    result[name] = {
      ...discovered,
      outputs: discovered.outputs.map(output => ({ ...output, name: render.outputs?.[output.slot]?.name ?? output.name })),
    };
  }
  return result;
}
