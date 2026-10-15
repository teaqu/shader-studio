import { describe, expect, it, vi } from 'vitest';
import { createMcpServer } from '../../src/app/mcp/McpTools';

async function fixture() {
  const call = vi.fn(async (operation: string, args: Record<string, unknown>) => operation === 'read_recording_artifact'
    ? { mimeType: 'video/webm', data: 'dmlkZW8=' }
    : operation === 'get_recording' ? { artifact: { id: args.id, mimeType: 'video/webm' } }
      : operation === 'get_frame_capture' ? { id: args.id, frames: [{ requestedTime: 1, elapsedTime: 1.1, data: 'ZnJhbWUx' }, { requestedTime: 2, elapsedTime: 2.1, data: 'ZnJhbWUy' }] }
        : { operation, ...args });
  const server = await createMcpServer({ call });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientTransport);
  return { client, call };
}

describe('MCP automation tools', () => {
  it('registers the bounded input, feedback, recording, and file tools', async () => {
    const { client } = await fixture();
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ['create_file', 'select_shader', 'inject_input', 'start_input_recording', 'stop_input_recording', 'get_input_recording', 'replay_inputs', 'get_input_replay', 'cancel_input_replay', 'read_feedback', 'start_recording', 'stop_recording', 'get_recording', 'start_frame_capture', 'get_frame_capture', 'cancel_frame_capture']) {
      expect(names).toContain(name);
    }
  });

  it('validates frame jobs and returns their PNGs separately from metadata', async () => {
    const { client, call } = await fixture();
    const started = await client.callTool({ name: 'start_frame_capture', arguments: { previewId: 'one', times: [0, 1], mode: 'reset-and-play', width: 800, height: 450 } });
    expect(started.isError).not.toBe(true);
    expect(call).toHaveBeenCalledWith('start_frame_capture', expect.objectContaining({ previewId: 'one', times: [0, 1] }), expect.any(AbortSignal));
    const invalid = await client.callTool({ name: 'start_frame_capture', arguments: { previewId: 'one', times: [1, 1], width: 800, height: 450 } });
    expect(invalid.isError).toBe(true);
    const frames = await client.callTool({ name: 'get_frame_capture', arguments: { previewId: 'one', id: 'job' } });
    expect(frames.structuredContent).toMatchObject({ frames: expect.arrayContaining([expect.objectContaining({ requestedTime: 1, elapsedTime: 1.1 })]) });
    expect(JSON.stringify(frames.structuredContent)).not.toContain('ZnJhbW');
    const content = frames.content as { type: string; data?: string }[];
    expect(content.filter(item => item.type === 'image').map(item => item.data)).toEqual(['ZnJhbWUx', 'ZnJhbWUy']);
  });

  it('passes canonical events and explicit preview IDs to the application', async () => {
    const { client, call } = await fixture();
    const result = await client.callTool({ name: 'inject_input', arguments: { previewId: 'one', events: [{ type: 'pointer_move', x: 1, y: 2 }] } });
    expect(result.isError).not.toBe(true);
    expect(call).toHaveBeenCalledWith('inject_input', { previewId: 'one', events: [{ type: 'pointer_move', x: 1, y: 2 }] }, expect.any(AbortSignal));
    const pointerDown = await client.callTool({ name: 'inject_input', arguments: { previewId: 'one', events: [{ type: 'pointer_down', x: 1, y: 2 }] } });
    expect(pointerDown.isError).not.toBe(true);
    const unsupportedButton = await client.callTool({ name: 'inject_input', arguments: { previewId: 'one', events: [{ type: 'pointer_down', x: 1, y: 2, button: 2 }] } });
    expect(unsupportedButton.isError).toBe(true);
    const invalid = await client.callTool({ name: 'start_recording', arguments: { previewId: 'one', format: 'mp4', duration: 61, fps: 30, width: 1, height: 1 } });
    expect(invalid.isError).toBe(true);
    const badInput = await client.callTool({ name: 'inject_input', arguments: { previewId: 'one', events: [{ type: 'pointer_move', x: 1 }] } });
    expect(badInput.isError).toBe(true);
  });

  it('returns a recording resource link and serves its binary resource', async () => {
    const { client } = await fixture();
    const result = await client.callTool({ name: 'get_recording', arguments: { previewId: 'one', id: 'capture' } });
    expect(result.content).toContainEqual(expect.objectContaining({ type: 'resource_link', uri: 'shader-studio://recordings/capture' }));
    const resource = await client.readResource({ uri: 'shader-studio://recordings/capture' });
    expect(resource.contents).toContainEqual(expect.objectContaining({ mimeType: 'video/webm', blob: 'dmlkZW8=' }));
  });
});
