import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { workspace, Uri, type TestDocument } from './vscode';
import { VscodeMcpApplication } from '../../src/app/mcp/VscodeMcpApplication';
import { PreviewRegistry } from '../../src/app/mcp/PreviewRegistry';
import { mcpLogs } from '../../src/app/mcp/McpLogs';
import { mcpEditGuard } from '../../src/app/mcp/McpEditGuard';
import type { Messenger } from '../../src/app/transport/Messenger';
import type { ShaderProvider } from '../../src/app/ShaderProvider';

let root: string;
let source: TestDocument;
let config: TestDocument;
let app: VscodeMcpApplication;
let previews: PreviewRegistry;
let sequence: number | undefined;
let provider: { sendShaderFromDocument: ReturnType<typeof vi.fn> };
const signal = () => new AbortController().signal;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'shader-mcp-app-'));
  workspace.isTrusted = true;
  workspace.rejectEdit = false;
  workspace.workspaceFolders = [{ uri: Uri.file(root) }];
  const document = (name: string, text: string): TestDocument => {
    const uri = Uri.file(path.join(root, name));
    writeFileSync(uri.fsPath, text);
    return { uri, text, isDirty: false, getText() {
      return this.text;
    }, positionAt: offset => offset };
  };
  source = document('main.glsl', 'original');
  config = document('main.sha.json', '{}');
  workspace.textDocuments = [source, config];
  previews = new PreviewRegistry();
  sequence = 1;
  previews.register({ id: 'preview', kind: 'webview', send: request => {
    previews.receive('preview', { type: 'viewerRpcResponse', requestId: request.requestId,
      result: { path: source.uri.fsPath, language: 'glsl', compileSequence: sequence, errors: [],
        resources: { passes: [{ name: 'Compute', kind: 'compute', path: '/compute.wgsl' }], storage: { data: { count: 1, elementType: 'uint' } } },
        ...(request.operation === 'read_storage' ? { storageRead: { name: 'data', bytes: [42, 0, 0, 0] } } : {}),
        ...(request.operation === 'capture' ? { data: 'pixels', mimeType: 'image/png' } : {}) } });
  } });
  provider = { sendShaderFromDocument: vi.fn(async () => {
    sequence = 2;
  }) };
  app = new VscodeMcpApplication({ previews, getCompileSequence: () => sequence } as unknown as Messenger, provider as unknown as ShaderProvider);
});
afterEach(() => {
  mcpLogs.setEnabled(false); previews.dispose(); rmSync(root, { recursive: true, force: true });
});

describe('VS Code MCP file and viewer application', () => {
  it('sends compact text and structured results over MCP without dropping captured PNGs', async () => {
    const { createMcpServer } = await import('../../src/app/mcp/McpTools');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const server = await createMcpServer(app);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'compact-response-regression', version: '1' });
    try {
      await client.connect(clientTransport);
      const diagnostics = await client.callTool({ name: 'get_diagnostics', arguments: {} });
      expect(diagnostics.isError).not.toBe(true);
      expect(diagnostics.structuredContent).toMatchObject({ previewId: 'preview', compileSequence: 1, errors: [] });
      expect(diagnostics.structuredContent).not.toHaveProperty('resources');
      const content = diagnostics.content as { type: string; text?: string }[];
      expect(JSON.parse(content[0].text!)).toEqual(diagnostics.structuredContent);
      const capture = await client.callTool({ name: 'capture_output', arguments: {} });
      expect(capture.content).toContainEqual({ type: 'image', mimeType: 'image/png', data: 'pixels' });
      expect(capture.structuredContent).not.toHaveProperty('image');
      expect(capture.structuredContent).not.toHaveProperty('resources');
      const resources = await client.callTool({ name: 'get_resources', arguments: {} });
      expect(resources.structuredContent).toMatchObject({ passes: [{ kind: 'compute' }], storage: { data: { count: 1 } } });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('keeps routine replies compact while preserving diagnostics and output provenance', async () => {
    const snapshot = {
      path: source.uri.fsPath, language: 'wgsl', compileSequence: 7, renderedSequence: 6,
      compiling: false, errors: ['Compilation failed'], warnings: ['Warning'],
      time: 2, frame: 42, paused: true, width: 800, height: 450, fpsLimit: 30, speed: 2,
      uniforms: [{ name: 'amount', type: 'float', value: 3 }],
      inputs: { customUniforms: Array(20).fill({ name: 'amount', value: 3 }) },
      resources: { passes: [{ name: 'Image', path: source.uri.fsPath }], storage: { values: { count: 1024 } } },
      storageRead: { name: 'values', bytes: [42, 0, 0, 0], frame: 42 }, data: 'pixels', mimeType: 'image/png',
    };
    vi.spyOn(previews, 'request').mockResolvedValue(snapshot as never);
    for (const operation of ['get_diagnostics', 'capture_output', 'set_playback', 'read_storage']) {
      const result = await app.call(operation, { name: 'values', paused: true }, signal());
      expect(result).toMatchObject({ previewId: 'preview', path: source.uri.fsPath, compileSequence: 7, renderedSequence: 6, errors: ['Compilation failed'], warnings: ['Warning'] });
      for (const field of ['inputs', 'resources', 'uniforms', 'data', 'mimeType', 'fpsLimit', 'speed']) {
        expect(result).not.toHaveProperty(field);
      }
      if (operation === 'capture_output') {
        expect(result).toMatchObject({ image: { data: 'pixels', mimeType: 'image/png' }, width: 800, height: 450 });
      }
      if (operation === 'read_storage') {
        expect(result).toMatchObject({ storageRead: snapshot.storageRead, frame: 42 });
      }
      if (operation === 'get_diagnostics') {
        expect(result).not.toHaveProperty('storageRead');
        expect(result).not.toHaveProperty('time');
      }
      expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(snapshot).length / 2);
    }
    const list = await app.call('list_previews', {}, signal());
    const listed = (list.previews as Record<string, unknown>[])[0];
    expect(listed).toMatchObject({ id: 'preview', kind: 'webview', path: source.uri.fsPath, compileSequence: 7, renderedSequence: 6 });
    expect(listed).not.toHaveProperty('inputs');
    expect(listed).not.toHaveProperty('resources');
    expect(listed).not.toHaveProperty('uniforms');
    const settings = await app.call('get_settings', {}, signal());
    expect(settings).toMatchObject({ viewer: { fpsLimit: 30, speed: 2, uniforms: snapshot.uniforms }, configFile: { revision: expect.any(String), text: '{}' } });
    expect(settings.viewer).not.toHaveProperty('inputs');
    expect(settings.viewer).not.toHaveProperty('resources');
    const updated = await app.call('update_settings', { speed: 2, uniforms: { amount: 3 } }, signal());
    expect(updated).toMatchObject({ speed: 2, uniforms: snapshot.uniforms });
    expect(updated).not.toHaveProperty('resources');
    const edited = await app.call('update_file', { path: source.uri.fsPath, expectedRevision: (await app.call('read_file', { path: source.uri.fsPath }, signal())).revision, text: 'edited', includePreview: true }, signal());
    expect(edited).toMatchObject({ applied: true, editedRevision: expect.any(String), compileSequence: 7, renderedSequence: 6, errors: snapshot.errors, image: { data: 'pixels' } });
    expect(edited).not.toHaveProperty('inputs');
    expect(edited).not.toHaveProperty('resources');
  });

  it('only collects logs after the explicit start tool and stops without clearing the result', async () => {
    mcpLogs.setEnabled(true);
    expect(await app.call('get_logs', {}, signal())).toMatchObject({ collecting: false, entries: [] });
    expect(await app.call('start_log_collection', {}, signal())).toMatchObject({ collecting: true });
    mcpLogs.append('extension', 'info', 'requested');
    expect(await app.call('stop_log_collection', {}, signal())).toMatchObject({ collecting: false, entries: [{ message: 'requested' }] });
    expect(await app.call('start_log_collection', { duration: 2 }, signal())).toMatchObject({ collecting: true, entries: [] });
  });
  it('exposes input snapshots and reports a preview that needs updating', async () => {
    const request = vi.spyOn(previews, 'request');
    const inputs = { scope: 'live-preview', builtins: { iMouse: [1, 2, 3, 4] }, customUniforms: [] };
    request.mockResolvedValueOnce({ inputs } as never);
    expect(await app.call('get_inputs', {}, signal())).toEqual({ previewId: 'preview', inputs });
    await expect(app.call('get_inputs', {}, signal())).rejects.toThrow('Reload the preview');
  });
  it('discovers compute resources and routes storage inspection and log reads', async () => {
    expect(await app.call('get_resources', {}, signal())).toMatchObject({ storage: { data: { count: 1 } }, passes: [{ kind: 'compute' }] });
    expect(await app.call('read_storage', { name: 'data' }, signal())).toMatchObject({ storageRead: { bytes: [42, 0, 0, 0] } });
    expect(await app.call('read_storage', { name: 'data', start: 0, count: 1 }, signal())).toMatchObject({ storageRead: { name: 'data' } });
    expect(await app.call('get_logs', { limit: 1 }, signal())).toHaveProperty('entries');
  });

  it('reports disconnected previews and absent shaders/configs', async () => {
    const request = vi.spyOn(previews, 'request');
    request.mockRejectedValueOnce(new Error('closed'));
    expect(await app.call('list_previews', {}, signal())).toMatchObject({ previews: [{ error: 'Error: closed' }] });
    request.mockResolvedValueOnce({ path: '' } as never);
    await expect(app.call('get_shader', {}, signal())).rejects.toThrow('No shader');
    request.mockResolvedValueOnce({ path: '' } as never);
    expect(await app.call('get_settings', {}, signal())).toMatchObject({ configFile: null });
  });

  it('reports a successful edit separately when no compilation was dispatched', async () => {
    const read = await app.call('read_file', { path: source.uri.fsPath }, signal());
    provider.sendShaderFromDocument.mockImplementationOnce(async () => {
      sequence = undefined;
    });
    expect(await app.call('update_file', { path: source.uri.fsPath, expectedRevision: read.revision, text: 'edited', previewId: 'preview' }, signal())).toMatchObject({ applied: true, previewError: 'No compilation was sent for this shader.' });
  });
  it('reads editor documents rather than disk and exposes config as a file', async () => {
    source.text = 'unsaved'; source.isDirty = true;
    expect(await app.call('get_shader', {}, signal())).toMatchObject({ text: 'unsaved', dirty: true, language: 'glsl' });
    expect(await app.call('get_settings', {}, signal())).toMatchObject({ configFile: { path: config.uri.fsPath, text: '{}' } });
    expect(await app.call('list_files', {}, signal())).toMatchObject({ files: [source.uri.fsPath, config.uri.fsPath], truncated: false });
    expect(await app.call('list_previews', {}, signal())).toMatchObject({ previews: [{ id: 'preview', path: source.uri.fsPath }] });
    expect(await app.call('get_diagnostics', {}, signal())).toMatchObject({ errors: [], previewId: 'preview' });
    expect(await app.call('capture_output', {}, signal())).toMatchObject({ image: { data: 'pixels' } });
    expect(await app.call('update_settings', { fpsLimit: 30, speed: 2, uniforms: {} }, signal())).toMatchObject({ previewId: 'preview' });
    expect(await app.call('set_playback', { paused: true, time: 0, reset: true, includePreview: true }, signal())).toMatchObject({ image: { data: 'pixels' } });
    await expect(app.call('unknown', {}, signal())).rejects.toThrow('Unknown');
  });

  it('edits shader and configuration files, remains unsaved, and rebuilds before returning output', async () => {
    const read = await app.call('read_file', { path: config.uri.fsPath }, signal());
    const result = await app.call('update_file', { path: config.uri.fsPath, text: '{"passes":{}}', expectedRevision: read.revision, includePreview: true }, signal());
    expect(result).toMatchObject({ path: config.uri.fsPath, applied: true, dirty: true, compileSequence: 2, image: { data: 'pixels' } });
    expect(config.text).toBe('{"passes":{}}');
    expect(provider.sendShaderFromDocument).toHaveBeenCalledWith(source, { previewId: 'preview' });
    await expect(app.call('update_file', { path: config.uri.fsPath, text: 'stale', expectedRevision: read.revision }, signal())).rejects.toThrow('changed');
    const current = await app.call('read_file', { path: source.uri.fsPath }, signal());
    expect(await app.call('update_file', { path: source.uri.fsPath, text: source.text, expectedRevision: current.revision }, signal())).toMatchObject({ applied: true, dirty: false });
  });

  it('binds a dependency edit to the only preview root even without previewId', async () => {
    const controls: TestDocument = {
      uri: Uri.file(path.join(root, 'main.controls.glsl')), text: 'controls', isDirty: false,
      getText() {
        return this.text;
      },
      positionAt: offset => offset,
    };
    writeFileSync(controls.uri.fsPath, controls.text);
    workspace.textDocuments.push(controls);
    const read = await app.call('read_file', { path: controls.uri.fsPath }, signal());

    const result = await app.call('update_file', { path: controls.uri.fsPath, text: 'updated controls', expectedRevision: read.revision }, signal());

    expect(provider.sendShaderFromDocument).toHaveBeenCalledWith(source, { previewId: 'preview' });
    expect(result).toMatchObject({ applied: true, editedPath: controls.uri.fsPath, previewPath: source.uri.fsPath });
  });

  it('selects and sends a shader only to the requested preview', async () => {
    const alternate: TestDocument = {
      uri: Uri.file(path.join(root, 'alternate.glsl')), text: 'alternate', isDirty: false,
      getText() {
        return this.text;
      }, positionAt: offset => offset,
    };
    writeFileSync(alternate.uri.fsPath, alternate.text);
    workspace.textDocuments.push(alternate);
    const result = await app.call('select_shader', { previewId: 'preview', path: alternate.uri.fsPath }, signal());
    expect(provider.sendShaderFromDocument).toHaveBeenCalledWith(alternate, { reload: true, previewId: 'preview' });
    expect(result).toMatchObject({ previewId: 'preview', selectedPath: alternate.uri.fsPath, compileSequence: 2 });
  });

  it('reports when targeted selection did not dispatch a compilation', async () => {
    sequence = undefined;
    provider.sendShaderFromDocument.mockImplementationOnce(async () => undefined);
    await expect(app.call('select_shader', { previewId: 'preview', path: source.uri.fsPath }, signal()))
      .rejects.toThrow('No compilation was sent');
  });

  it('creates a new workspace file once and returns its revision', async () => {
    const suppress = vi.spyOn(mcpEditGuard, 'armSuppression');
    const result = await app.call('create_file', { path: 'generated.glsl', text: 'void main() {}' }, signal());
    expect(result).toMatchObject({ path: path.join(root, 'generated.glsl'), revision: expect.any(String), dirty: true, created: true });
    expect(workspace.textDocuments.find(document => document.uri.fsPath === result.path)?.text).toBe('void main() {}');
    expect(suppress).toHaveBeenCalledWith(path.join(root, 'generated.glsl'), 'void main() {}');
    await expect(app.call('create_file', { path: 'generated.glsl', text: 'again' }, signal())).rejects.toThrow('already exists');
    await expect(app.call('create_file', { path: '../outside.glsl', text: '' }, signal())).rejects.toThrow('workspace');
  });

  it('rejects cancelled, invalid, untrusted, and rejected file creates', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(app.call('create_file', { path: 'cancelled.glsl', text: '' }, cancelled.signal)).rejects.toThrow('cancelled');
    await expect(app.call('create_file', { path: 'invalid.glsl', text: '\0' }, signal())).rejects.toThrow('Invalid');
    workspace.isTrusted = false;
    await expect(app.call('create_file', { path: 'untrusted.glsl', text: '' }, signal())).rejects.toThrow('Trust');
    workspace.isTrusted = true;
    workspace.rejectEdit = true;
    await expect(app.call('create_file', { path: 'rejected.glsl', text: 'shader' }, signal())).rejects.toThrow('rejected');
    expect(mcpEditGuard.take(path.join(root, 'rejected.glsl'), 'shader')).toBeUndefined();
  });

  it('requires configured automation and an explicit preview for automation operations', async () => {
    await expect(app.call('read_recording_artifact', { id: 'missing' }, signal())).rejects.toThrow('storage is unavailable');
    await expect(app.call('start_recording', {}, signal())).rejects.toThrow('explicit previewId');
    await expect(app.call('start_recording', { previewId: 'preview' }, signal())).rejects.toThrow('automation is unavailable');
    expect(new VscodeMcpApplication({ previews, getCompileSequence: () => sequence } as unknown as Messenger, provider as unknown as ShaderProvider, root)).toBeInstanceOf(VscodeMcpApplication);
  });

  it('serializes concurrent revisions and distinguishes applied edits from preview failures', async () => {
    const read = await app.call('read_file', { path: source.uri.fsPath }, signal());
    const args = { path: source.uri.fsPath, expectedRevision: read.revision };
    const first = app.call('update_file', { ...args, text: 'first' }, signal());
    const second = app.call('update_file', { ...args, text: 'second' }, signal());
    await expect(first).resolves.toMatchObject({ applied: true });
    await expect(second).rejects.toThrow('changed');
    provider.sendShaderFromDocument.mockRejectedValueOnce(new Error('compile failed'));
    const current = await app.call('read_file', { path: source.uri.fsPath }, signal());
    expect(await app.call('update_file', { ...args, expectedRevision: current.revision, text: 'third', previewId: 'preview' }, signal())).toMatchObject({ applied: true, previewError: 'compile failed' });
    expect(source.text).toBe('third');
  });

  it('rejects untrusted, cancelled, invalid and rejected edits', async () => {
    const read = await app.call('read_file', { path: source.uri.fsPath }, signal());
    const args = { path: source.uri.fsPath, text: 'new', expectedRevision: read.revision };
    workspace.isTrusted = false;
    await expect(app.call('read_file', args, signal())).rejects.toThrow('Trust');
    workspace.isTrusted = true;
    for (const text of ['bad\0', undefined]) {
      await expect(app.call('update_file', { ...args, text }, signal())).rejects.toThrow('Invalid');
    }
    workspace.rejectEdit = true;
    await expect(app.call('update_file', args, signal())).rejects.toThrow('rejected');
    expect(mcpEditGuard.take(source.uri.fsPath, 'new')).toBeUndefined();
    source.text = '\0binary';
    await expect(app.call('read_file', args, signal())).rejects.toThrow('text document');
    await expect(app.call('update_file', args, signal())).rejects.toThrow('text document');
    const controller = new AbortController(); controller.abort();
    await expect(app.call('read_file', args, controller.signal)).rejects.toThrow('cancelled');
    await expect(app.call('update_file', args, controller.signal)).rejects.toThrow('cancelled');
  });
});
