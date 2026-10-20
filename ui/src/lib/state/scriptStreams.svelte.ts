import type { ScriptStreamInfo } from '@shader-studio/types';
export interface ScriptStreamStatus extends ScriptStreamInfo { queued: number; lastFrame: number }
let streams = $state<ScriptStreamStatus[]>([]);
export function getScriptStreams(): ScriptStreamStatus[] {
  return streams;
}
export function setScriptStreams(next: ScriptStreamStatus[]): void {
  streams = next;
}
