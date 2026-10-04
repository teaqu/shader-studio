import { beforeEach, expect, it, vi } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import type { ControllerDeps } from '../../lib/resolution/ResolutionSessionController.svelte';
import { createResolutionSessionController } from '../../lib/resolution/createResolutionSessionController';
import { getGlobalViewerCamera, setGlobalViewerCamera } from '../../lib/state/viewerCameraState.svelte';
import { getDefaultAuthoringMode, setDefaultAuthoringMode } from '../../lib/state/authoringModeState.svelte';

const lifecycle = vi.hoisted(() => ({ mount: undefined as (() => (() => void)) | undefined }));
vi.mock('svelte', async importOriginal => ({ ...await importOriginal<typeof import('svelte')>(), onMount: (callback: () => (() => void)) => {
  lifecycle.mount = callback; 
} }));
vi.mock('../../lib/resolution/ResolutionSessionController.svelte', () => ({ ResolutionSessionController: class {} }));
beforeEach(() => {
  setGlobalViewerCamera(true);
  setDefaultAuthoringMode('hooks');
});

it.each([
  [false, true, null, false],
  [true, false, null, false],
  [true, true, null, true],
  [true, true, { version: '1.0', passes: {} }, true],
  [true, true, { version: '1.0', passes: {}, webgpu: {} }, true],
  [true, true, { version: '1.0', passes: {}, webgpu: { useViewerCamera: false } }, false],
  [true, true, { version: '1.0', passes: {}, webgpu: { useViewerCamera: true } }, false],
] as const)('recompiles inherited preferences only for a ready shader (%s/%s/%j)', (initialized, hasShader, config, shouldRecompile) => {
  const listeners: ((event: MessageEvent) => void)[] = [];
  const postMessage = vi.fn();
  const recompileCurrentShader = vi.fn();
  const deps = { transport: { onMessage: (callback: (event: MessageEvent) => void) => listeners.push(callback), postMessage }, isInitialized: () => initialized, hasShader: () => hasShader, currentConfig: config as ShaderConfig | null, recompileCurrentShader } as unknown as ControllerDeps;
  createResolutionSessionController(deps);
  expect(listeners).toHaveLength(0);
  const dispose = lifecycle.mount!();
  expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual(['requestShaderAuthoringSettings', 'requestViewerCameraSettings']);
  const send = (type: string, payload: object) => listeners.forEach(listener => listener({ data: { type, payload } } as MessageEvent));
  send('viewerCameraSettings', { useViewerCamera: false });
  expect(recompileCurrentShader).toHaveBeenCalledTimes(shouldRecompile ? 1 : 0);
  send('shaderAuthoringSettings', { defaultRenderAuthoring: 'native' });
  expect(getDefaultAuthoringMode()).toBe('native');
  dispose();
  send('viewerCameraSettings', { useViewerCamera: true });
  send('shaderAuthoringSettings', { defaultRenderAuthoring: 'hooks' });
  expect(getGlobalViewerCamera()).toBe(false);
  expect(getDefaultAuthoringMode()).toBe('native');
  expect(recompileCurrentShader).toHaveBeenCalledTimes(shouldRecompile ? 1 : 0);
});
