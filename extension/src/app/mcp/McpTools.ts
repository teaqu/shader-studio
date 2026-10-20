import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { registerMcpDocumentation } from './McpDocumentation';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js' with { 'resolution-mode': 'import' };
import { z } from 'zod';

import { mcpToolDefinitions, type McpApplication } from '@shader-studio/utils';
export type { McpApplication } from '@shader-studio/utils';

export async function createMcpServer(application: McpApplication): Promise<McpServer> {
  // Resolve the SDK's ESM declarations (its CJS declarations import an ESM-only
  // schema type). esbuild still bundles this into the extension's CJS output.
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { ResourceTemplate } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new McpServer({ name: 'shader-studio', version: '1.0.0' }, {
    instructions: 'Use read_documentation for the installed configuration, uniform, pass and compute reference. Routine replies contain compact preview status; use get_settings for runtime controls/configuration, get_inputs for live built-ins/custom uniform writers, and get_resources for passes/storage declarations. Use list_previews to select a viewer. Read source/settings before editing; pass the returned revision. capture_output returns actual rendered pixels. Inspect diagnostics and fresh output after edits. A failed compile can leave last-good output visible; compare compileSequence and renderedSequence. File updates edit local workspace text documents and remain unsaved until the user saves them. No remote service is involved.',
    maxToolInputElements: 10000,
  });
  const register = (name: string, description: string, shape: z.ZodRawShape, readOnly: boolean) => {
    server.registerTool(name, {
      description, inputSchema: shape,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    }, async (args, extra): Promise<CallToolResult> => {
      try {
        const result = await application.call(name, args, extra.signal);
        const { image, frames, ...metadata } = result;
        const artifact = result.artifact;
        const frameMetadata = Array.isArray(frames) ? frames.map(frame => {
          if (!frame || typeof frame !== 'object') {
            return frame;
          }
          const { data: _data, ...details } = frame as Record<string, unknown>;
          return details;
        }) : undefined;
        const structured = frameMetadata ? { ...metadata, frames: frameMetadata } : metadata;
        const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(structured) }];
        if (image && typeof image === 'object' && 'data' in image && typeof image.data === 'string') {
          content.push({ type: 'image', mimeType: 'image/png', data: image.data });
        }
        if (Array.isArray(frames)) {
          for (const frame of frames) {
            if (frame && typeof frame === 'object' && typeof (frame as { data?: unknown }).data === 'string') {
              content.push({ type: 'image', mimeType: 'image/png', data: (frame as { data: string }).data });
            }
          }
        }
        if (artifact && typeof artifact === 'object' && 'id' in artifact && typeof artifact.id === 'string') {
          content.push({ type: 'resource_link', name: `recording-${artifact.id}`, uri: `shader-studio://recordings/${artifact.id}`, mimeType: 'mimeType' in artifact && typeof artifact.mimeType === 'string' ? artifact.mimeType : undefined });
        }
        return { content, structuredContent: structured };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  };
  server.registerResource('recording_artifact', new ResourceTemplate('shader-studio://recordings/{id}', { list: undefined }), {
    title: 'Shader Studio recording artifact', description: 'A bounded MP4 or WebM recording created by Shader Studio MCP.', mimeType: 'video/*',
  }, async (uri, variables, extra) => {
    const result = await application.call('read_recording_artifact', { id: variables.id }, extra.signal);
    if (typeof result.data !== 'string' || typeof result.mimeType !== 'string') {
      throw new Error('Recording artifact is unavailable.');
    }
    return { contents: [{ uri: uri.href, mimeType: result.mimeType, blob: result.data }] };
  });
  for (const tool of mcpToolDefinitions()) {
    register(tool.name, tool.description, tool.shape, tool.readOnly);
  }
  registerMcpDocumentation(server);
  return server;
}
