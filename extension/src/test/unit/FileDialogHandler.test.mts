import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), open: vi.fn(), write: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('vscode', () => ({ window: { showSaveDialog: mocks.save, showOpenDialog: mocks.open }, workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }] }, Uri: { file: (fsPath: string) => ({ fsPath }) } }));
vi.mock('fs', () => ({ writeFileSync: mocks.write }));
import { FileDialogHandler } from '../../app/handlers/FileDialogHandler.ts';
import type { Logger } from '../../app/services/Logger.ts';

describe('extension capture save acknowledgement', () => {
  beforeEach(() => vi.clearAllMocks());
  function handler() {
    // Save uses only the logger; other constructor dependencies belong to separate commands.
    return new FileDialogHandler(null!, null!, '', null, () => 1, { info: mocks.info, error: mocks.error } as unknown as Logger);
  }
  const payload = { data: Buffer.from('capture bytes').toString('base64'), defaultName: 'capture.png', filters: { Images: ['png'] }, requestId: 'save-42' };
  it('writes exact decoded bytes and acknowledges the matching request', async () => {
    mocks.save.mockResolvedValue({ fsPath: '/saved/capture.png' });
    const respond = vi.fn();
    await handler().handleSaveFile(payload, respond);
    expect(mocks.save).toHaveBeenCalledWith({ defaultUri: { fsPath: 'capture.png' }, filters: { Images: ['png'] } });
    expect(mocks.write).toHaveBeenCalledWith('/saved/capture.png', Buffer.from('capture bytes'));
    expect(respond).toHaveBeenCalledExactlyOnceWith({ type: 'saveFileResult', payload: { success: true, path: '/saved/capture.png', requestId: 'save-42' } });
    expect(mocks.info).toHaveBeenCalledWith('File saved: /saved/capture.png');
  });
  it('acknowledges cancellation without writing data', async () => {
    mocks.save.mockResolvedValue(undefined);
    const respond = vi.fn();
    await handler().handleSaveFile(payload, respond);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledExactlyOnceWith({ type: 'saveFileResult', payload: { success: false, cancelled: true, error: 'Cancelled', requestId: 'save-42' } });
  });
  it('offers KTX2 files when selecting a volume input', async () => {
    mocks.open.mockResolvedValue([{ fsPath: '/workspace/assets/density.ktx2' }]);
    const respond = vi.fn();
    await handler().handleSelectFile({ shaderPath: '/workspace/shader.glsl', fileType: 'volume', requestId: 'volume-1' }, respond);
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      filters: { 'Volume files': ['ktx2'] },
      defaultUri: { fsPath: '/workspace' },
    }));
    expect(respond).toHaveBeenCalledWith({ type: 'fileSelected', payload: { path: './assets/density.ktx2', requestId: 'volume-1' } });
  });
  it.each([
    ['script', 'Script files'], ['texture', 'Texture files'], ['video', 'Video files'], ['audio', 'Audio files'],
    ['cubemap', 'Cubemap files'], ['slang-vertex', 'Slang files'], ['slang-buffer', 'Slang files'],
    ['slang-common', 'Slang files'], ['slang-compute', 'Slang files'], ['wgsl-vertex', 'WGSL files'],
    ['wgsl-buffer', 'WGSL files'], ['wgsl-common', 'WGSL files'], ['wgsl-compute', 'WGSL files'], ['model', 'GLB models'],
    ['unknown', 'GLSL files'],
  ])('selects the %s file filter branch', async (fileType, filterName) => {
    mocks.open.mockResolvedValue(undefined);
    await handler().handleSelectFile({ shaderPath: '/workspace/shader.glsl', fileType, requestId: 'filter-1' }, vi.fn());
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ [filterName]: expect.any(Array) }) }));
  });
  it.each(['dialog', 'write'])('acknowledges a %s failure with the original request ID', async failure => {
    mocks.save.mockResolvedValue({ fsPath: '/saved/capture.png' });
    if (failure === 'dialog') {
      mocks.save.mockRejectedValueOnce(new Error('save failed'));
    } else {
      mocks.write.mockImplementationOnce(() => {
        throw new Error('save failed');
      });
    }
    const respond = vi.fn();
    await handler().handleSaveFile(payload, respond);
    expect(respond).toHaveBeenCalledExactlyOnceWith({ type: 'saveFileResult', payload: { success: false, error: 'Error: save failed', requestId: 'save-42' } });
    expect(mocks.error).toHaveBeenCalledWith('Failed to save file: Error: save failed');
  });
});
