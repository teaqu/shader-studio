import { expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../lib/ConfigManager';
import { addRenderPass } from '../../lib/config/RenderPassCreation';

it('creates native buffers without discarding their sources or channels', () => {
  const pass = { path: 'colour.wgsl', inputs: { iChannel0: { type: 'buffer', source: 'BufferB' } }, outputPrecision: 'float32' };
  const updateBuffer = vi.fn();
  const manager = { addBuffer: () => 'BufferA', getConfig: () => ({ passes: { BufferA: pass } }), updateBuffer } as unknown as ConfigManager;
  expect(addRenderPass(manager, 'native')).toBe('BufferA');
  expect(updateBuffer).toHaveBeenCalledWith('BufferA', { ...pass, entryPoints: {} });
  updateBuffer.mockClear();
  expect(addRenderPass(manager, 'hooks')).toBe('BufferA');
  expect(updateBuffer).not.toHaveBeenCalled();
});

it('handles unavailable managers, failed creation and absent configs', () => {
  expect(addRenderPass(undefined, 'native')).toBeNull();
  expect(addRenderPass({ addBuffer: () => null } as unknown as ConfigManager, 'native')).toBeNull();
  for (const config of [null, { passes: {} }]) {
    const updateBuffer = vi.fn();
    expect(addRenderPass({ addBuffer: () => 'BufferA', getConfig: () => config, updateBuffer } as unknown as ConfigManager, 'native')).toBe('BufferA');
    expect(updateBuffer).not.toHaveBeenCalled();
  }
});
