import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js' with { 'resolution-mode': 'import' };
import { z } from 'zod';

export interface McpApplication {
  call(operation: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>>;
}

const previewId = z.string().optional().describe('Preview ID from list_previews. Omit only when exactly one preview is open.');
const includePreview = z.boolean().optional().describe('Return a fresh rendered image after the operation.');
const revision = z.string().describe('Revision returned by the most recent read. Prevents overwriting newer edits.');
const uniformValue = z.union([z.number().finite(), z.array(z.number().finite()).max(16), z.boolean()]);

export async function createMcpServer(application: McpApplication): Promise<McpServer> {
  // Resolve the SDK's ESM declarations (its CJS declarations import an ESM-only
  // schema type). esbuild still bundles this into the extension's CJS output.
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new McpServer({ name: 'shader-studio', version: '1.0.0' }, {
    instructions: 'Use list_previews to select a viewer. Read source/settings before editing; pass the returned revision. capture_output returns actual rendered pixels. Inspect diagnostics and fresh output after edits. A failed compile can leave last-good output visible; compare compileSequence and renderedSequence. File updates edit local workspace text documents and remain unsaved until the user saves them. No remote service is involved.',
    maxToolInputElements: 10000,
  });
  const register = (name: string, description: string, shape: z.ZodRawShape, readOnly: boolean) => {
    server.registerTool(name, {
      description, inputSchema: shape,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    }, async (args, extra): Promise<CallToolResult> => {
      try {
        const result = await application.call(name, args, extra.signal);
        const { image, ...metadata } = result;
        const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(metadata) }];
        if (image && typeof image === 'object' && 'data' in image && typeof image.data === 'string') {
          content.push({ type: 'image', mimeType: 'image/png', data: image.data });
        }
        return { content, structuredContent: metadata };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  };
  register('list_previews', 'List connected Shader Studio viewers and their current state.', {}, true);
  register('get_resources', 'List render, buffer, common and compute passes with source paths, and named GPU storage declarations. Edit their files with update_file.', { previewId }, true);
  register('read_storage', 'Read actual GPU storage bytes with element type, stride and frame metadata. WebGPU only. Pause first for a stable simulation snapshot. Maximum 64 KiB per read.', {
    previewId, name: z.string(), start: z.number().int().min(0).default(0), count: z.number().int().min(1).max(1024).default(16),
  }, true);
  register('get_logs', 'Read recent extension, script console and viewer logs. Use after to continue from a cursor. Logs are bounded and retained only for this session.', {
    previewId, after: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).default(100),
    level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
  }, true);
  register('get_shader', 'Read the selected shader from its current editor document, including unsaved edits.', { previewId }, true);
  register('get_settings', 'Read shader configuration and runtime viewer settings, including configuration revision.', { previewId }, true);
  register('update_settings', 'Update runtime viewer controls. Edit the configuration file using update_file for persistent shader settings. Uniform overrides are temporary; scripts can overwrite them.', {
    previewId,
    fpsLimit: z.number().min(0).max(1000).optional(), speed: z.number().min(0).max(100).optional(),
    uniforms: z.record(z.string(), uniformValue).optional(), includePreview,
  }, false);
  register('get_diagnostics', 'Read the selected preview compiler/runtime errors and warnings with revision markers.', { previewId }, true);
  register('capture_output', 'Return actual PNG pixels from the selected live renderer. Does not reset simulation or change resolution/time.', { previewId }, true);
  register('set_playback', 'Pause/resume, seek shader time, or reset the running simulation. Seeking does not reconstruct simulation history.', {
    previewId, paused: z.boolean().optional(), reset: z.boolean().optional(), time: z.number().finite().min(0).optional(), includePreview,
  }, false);
  register('list_files', 'List local workspace files. Results are bounded; use a glob to narrow large workspaces.', { glob: z.string().max(500).optional() }, true);
  register('read_file', 'Read an existing local workspace text file, including unsaved edits, and its revision.', { path: z.string() }, true);
  register('update_file', 'Replace an existing workspace text file with an undoable edit. Read read_file first; no arbitrary filesystem paths.', {
    path: z.string(), text: z.string().max(1_000_000), expectedRevision: revision, previewId, includePreview,
  }, false);
  return server;
}
