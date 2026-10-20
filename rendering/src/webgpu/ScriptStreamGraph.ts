import type { ScriptStreamInfo } from '@shader-studio/types';
import type { RenderPassGraph } from '../types/PassGraph';
/** Stream declarations are runtime metadata, never persisted into shader config. */
export function addScriptStreams(graph: RenderPassGraph, streams: ScriptStreamInfo[], uniforms: {
    name: string;
}[] = []): void {
  const names = new Set([...graph.storage.map(node => node.name), ...uniforms.map(uniform => uniform.name), ...graph.passes.flatMap(pass => pass.channels.map(channel => channel.key))]);
  for (const stream of streams) {
    if (names.has(stream.name)) {
      graph.errors.push(`Script stream name conflicts with another input: ${stream.name}`);
      continue;
    }
    names.add(stream.name);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(stream.name) || !Number.isInteger(stream.maxPerFrame) || stream.maxPerFrame < 1 || stream.maxPerFrame > 65536) {
      graph.errors.push(`Invalid script stream: ${stream.name}`);
      continue;
    }
    graph.storage.push({ name: stream.name, binding: graph.storage.length, elementType: 'uint', builtin: true, count: stream.maxPerFrame + 1, stride: 4, streamMaxPerFrame: stream.maxPerFrame });
  }
}
