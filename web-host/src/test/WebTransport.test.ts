import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebTransport } from '../../lib/transport/WebTransport';

async function eventually(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion);
}

describe('WebTransport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies itself as the web host transport', () => {
    const transport = new WebTransport();
    expect(transport.getType()).toBe('web');
    expect(transport.getShaderExplorerHostApi()).toBeDefined();
    transport.dispose();
  });

  it('delivers the seeded workspace shader to the viewer', async () => {
    const transport = new WebTransport();
    const handler = vi.fn();
    transport.onMessage(handler);

    await eventually(() => expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource', path: '/shaders/aurora.glsl' }),
    })));
    transport.dispose();
  });

  it('routes explorer activation through the same host to the viewer', async () => {
    const transport = new WebTransport();
    const viewer = vi.fn();
    transport.onMessage(viewer);
    const explorer = transport.getShaderExplorerHostApi();
    const explorerReceive = vi.fn();
    explorer.onMessage(explorerReceive);
    explorer.postMessage({ type: 'requestShaders' });

    await eventually(() => expect(explorerReceive).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shadersUpdate' }),
    })));
    explorer.postMessage({ type: 'activateShader', path: '/shaders/aurora.slang' });
    await eventually(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource', path: '/shaders/aurora.slang' }),
    })));
    transport.dispose();
  });

  it('routes new shader requests from both the viewer and explorer through the viewer modal', async () => {
    const transport = new WebTransport();
    const viewer = vi.fn();
    transport.onMessage(viewer);
    const explorer = transport.getShaderExplorerHostApi();

    transport.postMessage({ type: 'extensionCommand', payload: { command: 'newShader' } });
    explorer.postMessage({ type: 'newShader' });
    await eventually(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      data: { type: 'showNewShaderModal' },
    })));

    transport.postMessage({ type: 'createShader', payload: { name: 'new-slang', language: 'slang' } });
    await eventually(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource', path: '/shaders/new-slang.slang', language: 'slang' }),
    })));
    expect(viewer.mock.calls.filter(([event]) => event.data.type === 'showNewShaderModal')).toHaveLength(2);
    transport.dispose();
  });

  it('stops delivering messages after disposal', async () => {
    const transport = new WebTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    transport.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    expect(transport.isConnected()).toBe(false);
  });
});
