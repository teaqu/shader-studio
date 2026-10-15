import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { documentationIndex, documentationUri, isDocumentationTopic, readDocumentation, registerMcpDocumentation } from '../../src/app/mcp/McpDocumentation';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture(file: string, contents: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-studio-mcp-docs-'));
  temporaryDirectories.push(directory);
  const target = path.join(directory, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  return directory;
}

describe('MCP documentation', () => {
  it('has a bounded, discoverable topic index', () => {
    expect(documentationIndex()).toMatchObject({ version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    expect(documentationIndex().topics).toContainEqual(expect.objectContaining({ topic: 'uniforms', title: 'Uniforms', uri: 'shader-studio://documentation/uniforms' }));
    expect(documentationUri('passes')).toBe('shader-studio://documentation/passes');
    expect(isDocumentationTopic('storage')).toBe(true);
    expect(isDocumentationTopic('../secrets')).toBe(false);
  });

  it('reads only the mapped installed document and keeps the compact index in-process', async () => {
    const root = await fixture('features/uniforms.md', '# Installed uniforms');
    await expect(readDocumentation('uniforms', root)).resolves.toMatchObject({ topic: 'uniforms', text: '# Installed uniforms' });
    await expect(readDocumentation('index', root)).resolves.toMatchObject({ topic: 'index', text: expect.stringContaining('get_inputs') });
  });

  it('registers matching resources and reads through the fallback tool', async () => {
    const root = await fixture('features/mcp.md', '# Installed MCP guide');
    const resources: { name: string; uri: string; callback: (uri: URL) => Promise<unknown> }[] = [];
    let tool: { name: string; callback: (args: { topic?: string }) => Promise<{ isError?: boolean }> } | undefined;
    const server = {
      registerResource(name: string, uri: string, _metadata: unknown, callback: (uri: URL) => Promise<unknown>) {
        resources.push({ name, uri, callback });
      },
      registerTool(name: string, _config: unknown, callback: (args: { topic?: string }) => Promise<{ isError?: boolean }>) {
        tool = { name, callback };
      },
    };
    registerMcpDocumentation(server as never, root);
    expect(resources).toHaveLength(documentationIndex().topics.length);
    expect(resources.map(resource => resource.uri)).toContain('shader-studio://documentation/mcp');
    const resource = resources.find(item => item.uri === 'shader-studio://documentation/mcp')!;
    await expect(resource.callback(new URL(resource.uri))).resolves.toMatchObject({
      contents: [expect.objectContaining({ uri: resource.uri, text: '# Installed MCP guide' })],
    });
    expect(tool?.name).toBe('read_documentation');
    await expect(tool!.callback({})).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ topic: 'index', topics: expect.any(Array) }),
    });
    await expect(tool!.callback({ topic: 'mcp' })).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ topic: 'mcp' }),
    });
    await expect(tool!.callback({ topic: '../secrets' })).resolves.toMatchObject({ isError: true });
    await expect(tool!.callback({ topic: 'uniforms' })).resolves.toMatchObject({ isError: true });
    let failingTool: { callback: (args: { topic?: string }) => Promise<{ isError?: boolean }> } | undefined;
    registerMcpDocumentation({
      registerResource() {},
      registerTool(_name: string, _config: unknown, callback: (args: { topic?: string }) => Promise<{ isError?: boolean }>) {
        failingTool = { callback };
      },
    } as never, root, async () => Promise.reject('unreadable'));
    await expect(failingTool!.callback({ topic: 'mcp' })).resolves.toMatchObject({
      isError: true, content: [expect.objectContaining({ text: expect.stringContaining('unreadable') })],
    });
  });
});
