import { describe, expect, it } from 'vitest';
import { mcpToolDefinitions, mcpToolJsonSchema, mcpToolSchema } from './mcp-tools';

describe('shared MCP tool contracts', () => {
  it('has unique names and serializable strict object schemas for every tool', () => {
    const tools = mcpToolDefinitions();
    expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(typeof tool.readOnly).toBe('boolean');
      const schema = mcpToolJsonSchema(tool);
      expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    }
  });
  it('preserves input types, ranges, defaults and refinement failures', () => {
    const tools = mcpToolDefinitions();
    const schema = (name: string) => mcpToolSchema(tools.find(tool => tool.name === name)!);
    expect(schema('read_storage').parse({ name: 'data' })).toMatchObject({ start: 0, count: 16 });
    expect(schema('start_log_collection').parse({})).toEqual({ duration: 60 });
    expect(schema('get_logs').parse({})).toEqual({ limit: 100 });
    expect(schema('replay_inputs').parse({ previewId: 'p' })).toMatchObject({ mode: 'from-current' });
    expect(schema('start_frame_capture').parse({ previewId: 'p', times: [0, 1] })).toMatchObject({ width: 800, height: 450, mode: 'from-current' });
    for (const times of [[2, 1], [1, 1]]) {
      expect(schema('start_frame_capture').safeParse({ previewId: 'p', times }).success).toBe(false);
    }
    expect(schema('start_frame_capture').safeParse({ previewId: 'p', times: [0] }).success).toBe(true);
    expect(schema('update_settings').safeParse({ speed: Infinity }).success).toBe(false);
    expect(schema('update_settings').safeParse({ extra: true }).success).toBe(false);
    expect(schema('inject_input').safeParse({ previewId: 'p', events: [{ type: 'key_down', code: 'KeyA' }] }).success).toBe(true);
  });
});
