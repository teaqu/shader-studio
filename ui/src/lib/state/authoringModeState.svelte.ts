import type { WebGPUAuthoringMode } from '@shader-studio/types';
let defaultMode = $state<WebGPUAuthoringMode>('hooks');
export function getDefaultAuthoringMode(): WebGPUAuthoringMode {
  return defaultMode; 
}
export function setDefaultAuthoringMode(mode: WebGPUAuthoringMode): void {
  defaultMode = mode; 
}
