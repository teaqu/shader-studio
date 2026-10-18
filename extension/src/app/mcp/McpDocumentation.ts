import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { z } from 'zod';

// esbuild embeds this extension manifest value in the installed bundle.
const extensionVersion = require('../../../package.json').version as string;

const documentation = {
  index: {
    title: 'Shader Studio MCP documentation',
    description: 'MCP workflow, live-input caveats, and the installed documentation topic index.',
  },
  mcp: { title: 'Connect an AI Assistant', description: 'Connection setup, safe editing workflow, and the MCP tool reference.', file: 'features/mcp.md' },
  uniforms: { title: 'Uniforms', description: 'Built-in shader inputs and Script-defined custom uniforms.', file: 'features/uniforms.md' },
  passes: { title: 'Configure Passes and Inputs', description: 'Render, Common, Script, and compute pass concepts and examples.', file: 'features/config-buffers.md' },
  configuration: { title: 'Config File Format', description: 'Raw .sha.json configuration including Script pass examples.', file: 'help/config-file.md' },
  channels: { title: 'Channels', description: 'Texture, buffer, audio, and other pass input bindings.', file: 'features/channels.md' },
  compute: { title: 'Compute Passes', description: 'WGSL and Slang compute-pass authoring and dispatch.', file: 'features/compute.md' },
  storage: { title: 'GPU Storage', description: 'Storage declarations, lifecycle, and inspection.', file: 'features/storage.md' },
  'render-outputs': { title: 'Multiple Render Targets', description: 'Native render-output declarations and pass wiring examples.', file: 'features/multiple-render-targets.md' },
} as const;

export type DocumentationTopic = keyof typeof documentation;
const documentationTopics = Object.keys(documentation) as DocumentationTopic[];
const documentationRoot = path.join(__dirname, 'docs');

export function documentationUri(topic: DocumentationTopic): string {
  return `shader-studio://documentation/${topic}`;
}

export function isDocumentationTopic(topic: string): topic is DocumentationTopic {
  return Object.hasOwn(documentation, topic);
}

export function documentationIndex(): { version: string; topics: { topic: DocumentationTopic; title: string; description: string; uri: string }[] } {
  return { version: extensionVersion, topics: documentationTopics.map(topic => ({ topic, title: documentation[topic].title, description: documentation[topic].description, uri: documentationUri(topic) })) };
}

export async function readDocumentation(topic: DocumentationTopic = 'index', root = documentationRoot): Promise<{ topic: DocumentationTopic; title: string; uri: string; text: string }> {
  const entry = documentation[topic];
  const text = topic === 'index'
    ? `# Shader Studio MCP documentation\n\nInstalled extension version: ${extensionVersion}.\n\nUse \`list_previews\`, then \`get_shader\` and \`get_settings\`, before editing. Use \`get_resources\` to find pass and storage files. Read a file before \`update_file\` and send the returned revision. Check diagnostics and capture a fresh output after edits.\n\nUse \`get_inputs\` for a live Image-preview input snapshot. Built-ins such as \`iTime\`, \`iResolution\`, and \`iMouse\` may be available there; per-pass or GPU-only inputs are reported as unavailable. It is not a frozen frame capture. Custom-uniform values can be overwritten by a Script pass.\n\n## Topics\n\n${documentationTopics.filter(item => item !== 'index').map(item => `- [${item}](${documentationUri(item)}) — ${documentation[item].description}`).join('\n')}`
    : await fs.readFile(path.join(root, (entry as { file: string }).file), 'utf8');
  return { topic, title: entry.title, uri: documentationUri(topic), text };
}

/** Registers static, installed documentation and a fallback tool for clients that do not discover resources. */
export function registerMcpDocumentation(
  server: McpServer,
  root = documentationRoot,
  read = readDocumentation,
): void {
  for (const topic of documentationTopics) {
    const entry = documentation[topic];
    server.registerResource(`documentation_${topic}`, documentationUri(topic), {
      title: entry.title,
      description: `Shader Studio ${extensionVersion} documentation bundled with this extension. ${entry.description}`,
      mimeType: 'text/markdown',
    }, async uri => {
      const document = await read(topic, root);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: document.text }] };
    });
  }
  server.registerTool('read_documentation', {
    description: 'Read bundled, version-matched Shader Studio documentation. Omit topic for the compact index; use a listed topic for the full reference.',
    inputSchema: { topic: z.string().optional().describe('One of: mcp, uniforms, passes, configuration, channels, compute, storage, render-outputs. Omit for the index.') },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ topic }) => {
    if (topic !== undefined && !isDocumentationTopic(topic)) {
      return { isError: true, content: [{ type: 'text', text: `Unknown documentation topic "${topic}". Use read_documentation without a topic for the index.` }] };
    }
    try {
      const document = await read(topic ?? 'index', root);
      return { content: [{ type: 'text', text: document.text }], structuredContent: { version: extensionVersion, topic: document.topic, title: document.title, uri: document.uri, ...(document.topic === 'index' ? documentationIndex() : {}) } };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Bundled documentation is unavailable: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  });
}
