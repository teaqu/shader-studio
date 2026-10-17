import { describe, expect, it, vi } from 'vitest';
import { McpAutomation, isAutomationOperation } from '../../src/app/mcp/McpAutomation';
import type { PreviewRegistry } from '../../src/app/mcp/PreviewRegistry';
import type { McpRecordingArtifacts } from '../../src/app/mcp/McpRecordingArtifacts';

function fixture() {
  const request = vi.fn();
  const save = vi.fn(async (_key, _mime, _bytes, chunk) => {
    expect(await chunk(0, 3)).toEqual({ offset: 0, totalBytes: 3, data: 'YWJj' });
    return { uri: 'shader-studio://recordings/artifact', path: '/private/artifact.mp4' };
  });
  const read = vi.fn(async () => ({ data: 'YWJj', mimeType: 'video/mp4' }));
  const readFile = vi.fn(async () => ({ revision: 'revision1' }));
  const app = new McpAutomation({ request } as unknown as PreviewRegistry, { save, read } as unknown as McpRecordingArtifacts, readFile);
  return { app, request, save, read, readFile, signal: new AbortController().signal };
}

describe('MCP automation routing', () => {
  it('pins injected actions to the selected shader and rejects absent/old viewers', async () => {
    const { app, request, signal } = fixture();
    expect(isAutomationOperation('inject_input')).toBe(true);
    expect(isAutomationOperation('unknown')).toBe(false);
    request.mockResolvedValueOnce({ path: '/shader' }).mockResolvedValueOnce({ path: '/shader', automation: { applied: 1 } });
    expect(await app.call('preview', 'inject_input', { previewId: 'preview', events: [] }, signal)).toMatchObject({ previewId: 'preview', path: '/shader', applied: 1 });
    expect(request).toHaveBeenLastCalledWith('preview', 'inject_input', { expectedPath: '/shader', events: [] }, signal);
    request.mockResolvedValueOnce({ path: '' });
    await expect(app.call('preview', 'read_feedback', {}, signal)).rejects.toThrow('No shader');
    request.mockResolvedValueOnce({ path: '/shader' }).mockResolvedValueOnce({});
    await expect(app.call('preview', 'inject_input', {}, signal)).rejects.toThrow('Reload');
    await expect(app.call('preview', 'unknown', {}, signal)).rejects.toThrow('Unknown');
  });

  it('saves completed video chunks with start revision and inspects jobs without waiting for compilation', async () => {
    const { app, request, save, read, signal } = fixture();
    const status = { id: 'job', state: 'recording', mimeType: 'video/mp4', source: { path: '/shader', revision: null }, artifact: { available: false, bytes: 0 } };
    request.mockResolvedValueOnce({ path: '/shader' }).mockResolvedValueOnce({ path: '/shader', automation: status });
    expect(await app.call('preview', 'start_recording', {}, signal)).toMatchObject({ source: { revision: 'revision1' } });
    request.mockClear();
    request.mockResolvedValueOnce({ path: '/other', automation: { ...status, state: 'completed', artifact: { available: true, bytes: 3 } } })
      .mockResolvedValueOnce({ automation: { offset: 0, totalBytes: 3, base64: 'YWJj' } });
    expect(await app.call('preview', 'get_recording', { id: 'job' }, signal)).toMatchObject({ artifact: { path: '/private/artifact.mp4' }, source: { path: '/shader', revision: 'revision1' } });
    expect(request.mock.calls[0][1]).toBe('get_recording');
    expect(save).toHaveBeenCalledWith('preview:job', 'video/mp4', 3, expect.any(Function), signal);
    await expect(app.readArtifact('artifact')).resolves.toEqual({ data: 'YWJj', mimeType: 'video/mp4' });
    expect(read).toHaveBeenCalledWith('artifact');
  });

  it('rejects missing artifact chunks and supports status for jobs started by another client', async () => {
    const { app, request, signal } = fixture();
    request.mockResolvedValueOnce({ automation: { id: 'job', state: 'completed', mimeType: 'video/mp4', artifact: { available: true, bytes: 3 } } })
      .mockResolvedValueOnce({});
    await expect(app.call('preview', 'get_recording', { id: 'job' }, signal)).rejects.toThrow('recording data');
    request.mockResolvedValueOnce({ path: '/shader', automation: { id: 'job', state: 'finalizing' } });
    expect(await app.call('preview', 'stop_recording', { id: 'job' }, signal)).toMatchObject({ state: 'finalizing' });
  });
});
