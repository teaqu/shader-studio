import type { ShaderConfig } from '@shader-studio/types';

type OutputKind = '2d' | 'cubemap';
let kinds = $state<Record<string, Record<string, OutputKind>>>({});

export function getBufferOutputKind(shaderPath: string, source: string): OutputKind {
  return kinds[shaderPath]?.[source] ?? '2d';
}

export function setBufferOutputKinds(shaderPath: string, config: ShaderConfig | null): void {
  kinds[shaderPath] = Object.fromEntries(Object.entries(config?.passes ?? {}).map(([name, pass]) => [
    name, pass && 'outputKind' in pass && pass.outputKind === 'cubemap' ? 'cubemap' : '2d',
  ]));
}
