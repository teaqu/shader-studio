import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerSnapshot } from '@shader-studio/types';
import { StandaloneMcpApplication } from '../StandaloneMcpApplication';
import { StandalonePreviews } from '../StandalonePreviews';
import { WebExtensionHost } from '../WebExtensionHost';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
import { clearEditorDocuments, getEditorDocument, setEditorDocument } from '../state/editorDocuments.svelte';

const signal = () => new AbortController().signal;
const snapshot: ViewerSnapshot = { path: '/main.glsl', language: 'glsl', compileSequence: 1, renderedSequence: 1,
  compiling: false, errors: [], warnings: [], time: 2, frame: 3, paused: false, width: 640, height: 480,
  fpsLimit: 60, speed: 1, uniforms: [], resources: { passes: [], storage: {} },
  inputs: { scope: 'live-preview', pass: 'Image', builtins: {}, unavailable: [], script: { path: null }, customUniforms: [] } };
async function fixture() {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), [
    { path: '/main.glsl', contents: 'main shader', createdAt: 1, modifiedAt: 1 },
    { path: '/main.sha.json', contents: '{"passes":{"Image":{}}}', createdAt: 1, modifiedAt: 1 },
    { path: '/pass.glsl', contents: 'pass shader', createdAt: 1, modifiedAt: 1 },
    { path: '/texture.png', contents: 'data:image/png;base64,AAAA', createdAt: 1, modifiedAt: 1 },
  ]);
  const host = new WebExtensionHost(workspace);
  const previews = new StandalonePreviews();
  const request = vi.spyOn(previews, 'request').mockResolvedValue({ ...snapshot });
  const sendSource = vi.fn();
  const close = previews.register({ id: 'p', kind: 'browser', send: vi.fn(), sendSource });
  const flush = vi.fn(async () => {});
  const app = new StandaloneMcpApplication(workspace, host, previews, flush);
  return { workspace, host, previews, request, app, sendSource, close, flush };
}
beforeEach(() => {
  clearEditorDocuments();
});
describe('standalone MCP workspace contracts', () => {
  it('lists bounded user files with literal and wildcard globs', async () => {
    const { app, workspace } = await fixture();
    workspace.writeText('/.shader-studio/private', 'hidden');
    workspace.writeText('/dir/a.glsl', 'nested');
    expect((await app.call('list_files', { glob: '**/*.glsl' }, signal())).files).toHaveLength(3);
    expect((await app.call('list_files', { glob: '/*.glsl' }, signal())).files).toHaveLength(2);
    expect((await app.call('list_files', { glob: 'p?ss.glsl' }, signal())).files).toEqual([{ path: '/pass.glsl' }]);
    expect((await app.call('list_files', { glob: 'main.sha.json' }, signal())).files).toHaveLength(1);
    for (let i = 0; i < 501; i++) {
      workspace.writeText(`/many/${i}`, 'x');
    }
    const result = await app.call('list_files', {}, signal());
    expect(result.truncated).toBe(true); expect(result.files).toHaveLength(500);
    await workspace.flush();
  });
  it('reads current editor text and maintains opaque revisions across unchanged reads', async () => {
    const { app, flush } = await fixture();
    const first = await app.call('read_file', { path: '/main.glsl' }, signal());
    expect(await app.call('read_file', { path: '/main.glsl' }, signal())).toEqual(first);
    setEditorDocument('/main.glsl', 'unsaved');
    const second = await app.call('read_file', { path: '/main.glsl' }, signal());
    expect(second.text).toBe('unsaved'); expect(second.revision).not.toBe(first.revision);
    expect(flush).toHaveBeenCalled();
  });
  it('edits workspace/editor text and reports applied edits after preview failure', async () => {
    const { app, workspace, request } = await fixture();
    const file = await app.call('read_file', { path: '/main.glsl' }, signal());
    request.mockResolvedValueOnce({ ...snapshot }).mockRejectedValueOnce(new Error('compile timeout'));
    const result = await app.call('update_file', { path: '/main.glsl', text: 'new shader', expectedRevision: file.revision }, signal());
    expect(result).toMatchObject({ applied: true, previewError: 'compile timeout' });
    expect(workspace.readText('/main.glsl')).toBe('new shader');
    expect(getEditorDocument('/main.glsl')).toBe('new shader');
    await expect(app.call('update_file', { path: '/main.glsl', text: 'stale', expectedRevision: file.revision }, signal())).rejects.toThrow('changed');
  });
  it('serializes edits so concurrent requests cannot both use the same revision', async () => {
    const { app, workspace } = await fixture();
    const file = await app.call('read_file', { path: '/main.glsl' }, signal());
    const results = await Promise.allSettled(['one', 'two'].map(text => app.call('update_file', { path: '/main.glsl', text, expectedRevision: file.revision }, signal())));
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(workspace.readText('/main.glsl')).toBe('one');
  });
  it('creates user files, rejects duplicates and prevents edits to internal/binary/missing files', async () => {
    const { app, workspace } = await fixture();
    expect(await app.call('create_file', { path: '/new/file.glsl', text: 'new' }, signal())).toMatchObject({ created: true, text: 'new' });
    await expect(app.call('create_file', { path: '/new/file.glsl', text: '' }, signal())).rejects.toThrow('exists');
    for (const path of ['/.shader-studio/settings', '/../../outside', '/missing', '/texture.png']) {
      await expect(app.call('read_file', { path }, signal())).rejects.toThrow();
    }
    for (const text of ['x\0', 'x'.repeat(1_000_001), 'data:binary']) {
      await expect(app.call('create_file', { path: '/bad', text }, signal())).rejects.toThrow('supported text');
    }
    expect(workspace.exists('/bad')).toBe(false);
  });
  it('edits without a preview and validates explicit preview targets before edits', async () => {
    const { app, close, workspace } = await fixture(); close();
    const file = await app.call('read_file', { path: '/main.glsl' }, signal());
    await expect(app.call('update_file', { path: file.path, expectedRevision: file.revision, text: 'bad', previewId: 'missing' }, signal())).rejects.toThrow('Unknown previewId');
    expect(workspace.readText('/main.glsl')).toBe('main shader');
    expect(await app.call('update_file', { path: file.path, expectedRevision: file.revision, text: 'okay' }, signal())).toMatchObject({ applied: true });
  });
});
describe('standalone viewer tools', () => {
  it('returns settings, diagnostics, resources, inputs and source', async () => {
    const { app } = await fixture();
    expect(await app.call('get_shader', {}, signal())).toMatchObject({ text: 'main shader', path: '/main.glsl' });
    expect(await app.call('get_settings', {}, signal())).toMatchObject({ viewer: { speed: 1 }, configFile: { path: '/main.sha.json' } });
    expect(await app.call('get_diagnostics', {}, signal())).toMatchObject({ compileSequence: 1, renderedSequence: 1 });
    expect(await app.call('get_resources', {}, signal())).toMatchObject({ passes: [], storage: {} });
    expect(await app.call('get_inputs', {}, signal())).toMatchObject({ scope: 'live-preview' });
    expect(await app.call('list_previews', {}, signal())).toMatchObject({ previews: [{ id: 'p', path: '/main.glsl' }] });
  });
  it('handles a missing config and failed preview listing', async () => {
    const { app, workspace, request } = await fixture(); workspace.delete('/main.sha.json');
    expect(await app.call('get_settings', {}, signal())).toMatchObject({ configFile: null });
    request.mockRejectedValueOnce(new Error('closed'));
    expect(await app.call('list_previews', {}, signal())).toMatchObject({ previews: [{ id: 'p', error: 'Error: closed' }] });
    await workspace.flush();
  });
  it('targets settings/playback and returns capture metadata without base64', async () => {
    const { app, request } = await fixture();
    await app.call('update_settings', { speed: 2, fpsLimit: 30 }, signal());
    expect(request).toHaveBeenCalledWith('p', 'settings', { speed: 2, fpsLimit: 30, expectedPath: '/main.glsl' }, expect.any(AbortSignal));
    await app.call('set_playback', { paused: true, reset: true, time: 1, includePreview: true }, signal());
    expect(request).toHaveBeenCalledWith('p', 'playback', { paused: true, reset: true, time: 1, expectedPath: '/main.glsl' }, expect.any(AbortSignal));
    request.mockResolvedValue({ ...snapshot, data: 'BASE64', mimeType: 'image/png' } as ViewerSnapshot);
    const result = await app.call('capture_output', {}, signal());
    expect(result).toMatchObject({ output: { availableInCanvas: true } }); expect(JSON.stringify(result)).not.toContain('BASE64');
  });
  it('routes storage/input/frame jobs and strips frame pixel bytes', async () => {
    const { app, request } = await fixture();
    request.mockResolvedValue({ ...snapshot, storageRead: { bytes: [1] } } as ViewerSnapshot);
    expect(await app.call('read_storage', { name: 'data', start: 0, count: 1 }, signal())).toMatchObject({ storage: { bytes: [1] } });
    request.mockResolvedValue({ ...snapshot, automation: { state: 'completed', frames: [{ data: 'SECRET', time: 1 }, null, 'marker'] } });
    const result = await app.call('get_frame_capture', { previewId: 'p', id: 'job' }, signal());
    expect(result.frames).toEqual([{ time: 1 }, null, 'marker']);
    request.mockResolvedValue({ ...snapshot });
    expect(await app.call('inject_input', { previewId: 'p', events: [{ type: 'release_all' }] }, signal())).toMatchObject({ previewId: 'p' });
  });
  it('selects a shader with compile attribution and rejects invalid selections', async () => {
    const { app, request, sendSource, host } = await fixture();
    await app.call('select_shader', { previewId: 'p', path: '/pass.glsl' }, signal());
    expect(sendSource).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', path: '/pass.glsl', compileSequence: expect.any(Number) }));
    expect(request).toHaveBeenLastCalledWith('p', 'get_state', { requiredPath: '/pass.glsl', requiredSequence: expect.any(Number) }, expect.any(AbortSignal));
    expect(() => host.prepareShader('/main.sha.json')).toThrow('shader');
    await expect(app.call('unknown', {}, signal())).rejects.toThrow('Unsupported');
  });
  it('cancels before work begins', async () => {
    const { app } = await fixture(); const controller = new AbortController(); controller.abort();
    await expect(app.call('list_files', {}, controller.signal)).rejects.toThrow();
  });
});


it('reads and edits a focused live model without leaving the editor behind the saved file', async () => {
  const { workspace, host, previews } = await fixture();
  let liveText = 'focused draft';
  const commit = vi.fn((_path: string, text: string) => {
    liveText = text;
  });
  const app = new StandaloneMcpApplication(workspace, host, previews, async () => {},
    async () => ({ read: () => liveText, commit }));
  const file = await app.call('read_file', { path: '/main.glsl' }, signal());
  expect(file.text).toBe('focused draft');
  const result = await app.call('update_file', { path: '/main.glsl', expectedRevision: file.revision, text: 'agent edit' }, signal());
  expect(result.applied).toBe(true);
  expect(commit).toHaveBeenCalledWith('/main.glsl', 'agent edit');
  expect(liveText).toBe('agent edit');
  expect(workspace.readText('/main.glsl')).toBe('agent edit');
});

it('rejects invalid shader selections before changing the viewer lock', async () => {
  const { app, request } = await fixture();
  for (const path of ['/main.sha.json', '/missing.glsl']) {
    await expect(app.call('select_shader', { previewId: 'p', path }, signal())).rejects.toThrow();
  }
  expect(request.mock.calls.some(([, operation]) => operation === 'select_shader')).toBe(false);
});
