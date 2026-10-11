import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { workspace, Uri, type TestDocument } from './vscode';
import { VscodeMcpApplication } from '../../src/app/mcp/VscodeMcpApplication';
import { PreviewRegistry } from '../../src/app/mcp/PreviewRegistry';
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
  previews.dispose(); rmSync(root, { recursive: true, force: true });
});

describe('VS Code MCP file and viewer application', () => {
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
    expect(provider.sendShaderFromDocument).toHaveBeenCalledWith(source);
    await expect(app.call('update_file', { path: config.uri.fsPath, text: 'stale', expectedRevision: read.revision }, signal())).rejects.toThrow('changed');
    const current = await app.call('read_file', { path: source.uri.fsPath }, signal());
    expect(await app.call('update_file', { path: source.uri.fsPath, text: source.text, expectedRevision: current.revision }, signal())).toMatchObject({ applied: true, dirty: false });
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
    source.text = '\0binary';
    await expect(app.call('read_file', args, signal())).rejects.toThrow('text document');
    await expect(app.call('update_file', args, signal())).rejects.toThrow('text document');
    const controller = new AbortController(); controller.abort();
    await expect(app.call('read_file', args, controller.signal)).rejects.toThrow('cancelled');
    await expect(app.call('update_file', args, controller.signal)).rejects.toThrow('cancelled');
  });
});
