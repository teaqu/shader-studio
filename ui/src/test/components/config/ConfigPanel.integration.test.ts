import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import ConfigPanel from '../../../lib/components/config/ConfigPanel.svelte';
import type { Transport } from '../../../lib/transport/MessageTransport';

function createMockTransport(): Transport {
  return {
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: () => 'vscode' as const,
    isConnected: () => true,
  };
}

describe('ConfigPanel with ConfigManager', () => {
  it('publishes a newly added compute pass exactly once', async () => {
    const config: ShaderConfig = {
      version: '1.0',
      passes: { Image: { inputs: {} } },
    };
    const onConfigChange = vi.fn();
    const onFileSelect = vi.fn();
    const { getByRole } = render(ConfigPanel, {
      config,
      language: 'slang',
      pathMap: {},
      transport: createMockTransport(),
      shaderPath: '/test/image.slang',
      isVisible: true,
      onFileSelect,
      selectedBuffer: 'Image',
      onConfigChange,
    });
    await tick();

    await fireEvent.click(getByRole('button', { name: '+ New' }));
    await fireEvent.click(getByRole('menuitem', { name: /add compute/i }));
    await tick();

    expect(onConfigChange).toHaveBeenCalledOnce();
    expect(onConfigChange).toHaveBeenCalledWith({
      version: '1.0',
      passes: {
        Image: { inputs: {} },
        ComputeA: { type: 'compute', path: '', inputs: {} },
      },
    });
    expect(onFileSelect).toHaveBeenCalledWith('ComputeA');
  });
});
