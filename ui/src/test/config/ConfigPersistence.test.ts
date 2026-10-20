import type { FunctionMock } from '../FunctionMock';
import { describe, it, expect, vi } from 'vitest';
import { persistConfig, stripResolvedPath } from '../../lib/config/ConfigPersistence';
import type { Transport } from '../../lib/transport/MessageTransport';
import type { ShaderConfig } from '@shader-studio/types';

function makeTransport(): Transport & { postMessage: FunctionMock } {
  return {
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: vi.fn(() => 'vscode' as const),
    isConnected: vi.fn(() => true),
  };
}

describe('stripResolvedPath', () => {
  it('removes resolved_path keys at any depth', () => {
    const config = {
      version: '1.0',
      passes: {
        Image: {
          inputs: { iChannel0: { type: 'buffer', resolved_path: '/abs/a.glsl' } },
          resolved_path: '/abs/img.glsl',
        },
      },
    } as unknown as ShaderConfig;

    const { text, clean } = stripResolvedPath(config);

    expect(text).not.toContain('resolved_path');
    expect(JSON.stringify(clean)).not.toContain('resolved_path');
  });

  it('persists ordered storage paths and offsets while stripping every resolved URL', () => {
    const initialDataFiles = [{ path: 'boot.bin', byteOffset: 0, resolved_path: 'data:application/octet-stream;base64,AQ==' }, { path: '@/kernel.bin', byteOffset: 32, resolved_path: 'https://host/kernel.bin' }];
    const config: ShaderConfig = { version: '1.0', storage: { ram: { count: 32, elementType: 'uint', initialDataFiles } }, passes: { Image: {} } };
    const { clean, text } = stripResolvedPath(config);
    expect(clean.storage?.ram?.initialDataFiles).toEqual([{ path: 'boot.bin', byteOffset: 0 }, { path: '@/kernel.bin', byteOffset: 32 }]);
    expect(text).not.toContain('resolved_path');
    expect(initialDataFiles[0]!.resolved_path).toContain('data:');
  });

  it('preserves all other fields', () => {
    const config: ShaderConfig = {
      version: '1.0',
      passes: {
        Image: { inputs: {}, resolution: { scale: 2, aspectRatio: '16:9' } },
      },
    };

    const { clean } = stripResolvedPath(config);

    expect(clean.passes.Image.resolution).toEqual({ scale: 2, aspectRatio: '16:9' });
  });

  it('preserves requested buffer sampling settings through JSON serialization', () => {
    const config: ShaderConfig = {
      version: '1.0',
      passes: {
        Image: {
          inputs: {
            state: { type: 'buffer', source: 'Simulation', filter: 'nearest', wrap: 'repeat' },
          },
        },
        Simulation: { path: 'simulation.wgsl' },
      },
    };

    const { text, clean } = stripResolvedPath(config);
    expect(JSON.parse(text)).toEqual(clean);
    expect(clean.passes.Image.inputs?.state).toEqual({
      type: 'buffer', source: 'Simulation', filter: 'nearest', wrap: 'repeat',
    });
  });

  it('produces 2-space indented JSON text', () => {
    const config: ShaderConfig = { version: '1.0', passes: { Image: { inputs: {} } } };
    const { text } = stripResolvedPath(config);
    expect(text).toContain('\n  "version"');
  });
});

describe('persistConfig', () => {
  it('posts an updateConfig envelope with cleaned config and text', () => {
    const transport = makeTransport();
    const config: ShaderConfig = {
      version: '1.0',
      passes: { Image: { inputs: {}, resolution: { scale: 2 } } },
    };

    persistConfig(transport, { config, shaderPath: '/abs/shader.glsl' });

    expect(transport.postMessage).toHaveBeenCalledTimes(1);
    const msg = transport.postMessage.mock.calls[0]![0];
    expect(msg.type).toBe('updateConfig');
    expect(msg.payload.shaderPath).toBe('/abs/shader.glsl');
    expect(msg.payload.text).toContain('"scale": 2');
    expect(msg.payload.config.passes.Image.resolution?.scale).toBe(2);
  });

  it('passes skipRefresh through as undefined when omitted', () => {
    const transport = makeTransport();
    persistConfig(transport, {
      config: { version: '1.0', passes: { Image: { inputs: {} } } },
      shaderPath: '/x.glsl',
    });
    expect(transport.postMessage.mock.calls[0]![0].payload.skipRefresh).toBeUndefined();
  });

  it('passes skipRefresh through when set', () => {
    const transport = makeTransport();
    persistConfig(transport, {
      config: { version: '1.0', passes: { Image: { inputs: {} } } },
      shaderPath: '/x.glsl',
      skipRefresh: true,
    });
    expect(transport.postMessage.mock.calls[0]![0].payload.skipRefresh).toBe(true);
  });

  it('strips resolved_path before sending', () => {
    const transport = makeTransport();
    const config = {
      version: '1.0',
      passes: { Image: { inputs: {}, resolved_path: '/abs.glsl' } },
    } as unknown as ShaderConfig;

    persistConfig(transport, { config, shaderPath: '/x.glsl' });

    const msg = transport.postMessage.mock.calls[0]![0];
    expect(msg.payload.text).not.toContain('resolved_path');
    expect(JSON.stringify(msg.payload.config)).not.toContain('resolved_path');
  });
});
