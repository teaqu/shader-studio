import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpToolDefinitions } from '@shader-studio/utils';
import { detectWebMcp, registerWebMcp, type WebMcpContext, type WebMcpTool } from '../registerWebMcp';

afterEach(() => {
  vi.unstubAllGlobals();
});
function fixture() {
  const tools: WebMcpTool[] = [];
  const context = { registerTool: vi.fn((tool: WebMcpTool) => {
    tools.push(tool);
  }), unregisterTool: vi.fn() };
  const call = vi.fn(async () => ({ ok: true }));
  const dispose = registerWebMcp({ call }, context);
  return { tools, context, call, dispose };
}
describe('native WebMCP registration', () => {
  it('detects document first, then older navigator contexts, and tolerates unsupported browsers', () => {
    const modern = { registerTool: vi.fn() }, legacy = { registerTool: vi.fn() };
    vi.stubGlobal('document', { modelContext: modern }); vi.stubGlobal('navigator', { modelContext: legacy });
    expect(detectWebMcp()).toBe(modern);
    vi.stubGlobal('document', {}); expect(detectWebMcp()).toBe(legacy);
    vi.stubGlobal('navigator', {}); expect(detectWebMcp()).toBeUndefined();
    registerWebMcp({ call: vi.fn() })();
  });
  it('uses shared schemas, annotations, defaults and string results', async () => {
    const { tools, context, call, dispose } = fixture();
    expect(tools.length).toBe(mcpToolDefinitions().length - 6);
    expect(tools.map(tool => tool.name)).not.toContain('start_recording');
    const read = tools.find(tool => tool.name === 'read_storage')!;
    expect(read.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(read.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(JSON.parse(await read.execute({ name: 'particles' }))).toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith('read_storage', { name: 'particles', start: 0, count: 16 }, expect.any(AbortSignal));
    expect(context.registerTool.mock.calls).toHaveLength(tools.length);
    expect(tools.find(tool => tool.name === 'update_file')!.inputSchema.properties).toHaveProperty('includePreview.description', 'Render fresh output and return metadata; inspect pixels in the canvas.');
    dispose(); expect(context.unregisterTool).toHaveBeenCalledTimes(tools.length);
    expect(JSON.parse(await read.execute({ name: 'particles' }))).toHaveProperty('error');
  });
  it('rejects invalid, unknown and out-of-bounds arguments before calling the application', async () => {
    const { tools, call, dispose } = fixture();
    const update = tools.find(tool => tool.name === 'update_file')!;
    for (const input of [{}, { path: '/x', text: 'x', expectedRevision: 'r', bad: true }, { path: '/x', text: 'x'.repeat(1_000_001), expectedRevision: 'r' }]) {
      expect(JSON.parse(await update.execute(input))).toHaveProperty('error');
    }
    const capture = tools.find(tool => tool.name === 'start_frame_capture')!;
    expect(JSON.parse(await capture.execute({ previewId: 'p', times: [2, 1] }))).toHaveProperty('error');
    expect(call).not.toHaveBeenCalled(); dispose();
  });
  it('returns actionable application failures and respects client cancellation', async () => {
    const { tools, call, dispose } = fixture();
    call.mockRejectedValueOnce(new Error('stale revision'));
    expect(JSON.parse(await tools[0].execute({}))).toEqual({ error: 'stale revision' });
    call.mockRejectedValueOnce('failed');
    expect(JSON.parse(await tools[0].execute({}))).toEqual({ error: 'failed' });
    const controller = new AbortController(); controller.abort();
    expect(JSON.parse(await tools[0].execute({}, { signal: controller.signal }))).toHaveProperty('error');
    expect(call).toHaveBeenCalledTimes(2); dispose();
  });
  it('aborts modern registrations and in-flight calls without legacy unregister', async () => {
    const registrations: AbortSignal[] = [];
    const context: WebMcpContext = { registerTool: (_tool, options) => {
      registrations.push(options!.signal);
    } };
    const dispose = registerWebMcp({ call: vi.fn() }, context);
    expect(registrations.every(signal => !signal.aborted)).toBe(true);
    dispose(); expect(registrations.every(signal => signal.aborted)).toBe(true);
  });
  it('continues disposing if the browser already unregistered a tool', () => {
    const { context, dispose, tools } = fixture();
    context.unregisterTool.mockImplementation(() => {
      throw new Error('already removed');
    });
    expect(dispose).not.toThrow();
    expect(context.unregisterTool).toHaveBeenCalledTimes(tools.length);
  });
  it('tolerates registration failures and cleans up late legacy registrations', async () => {
    let finish!: () => void;
    const delayed = new Promise<void>(resolve => {
      finish = resolve;
    });
    const context = { registerTool: vi.fn().mockImplementationOnce(() => {
      throw new Error('disabled');
    })
      .mockRejectedValueOnce(new Error('unsupported')).mockReturnValue(delayed), unregisterTool: vi.fn() };
    const dispose = registerWebMcp({ call: vi.fn() }, context);
    await Promise.resolve(); await Promise.resolve();
    dispose(); finish(); await Promise.resolve();
    expect(context.unregisterTool).toHaveBeenCalled();
    expect(context.unregisterTool).not.toHaveBeenCalledWith('list_previews');
  });
});
