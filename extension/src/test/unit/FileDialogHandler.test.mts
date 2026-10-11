import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), exists: vi.fn(), folder: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('vscode', () => ({ window: { showSaveDialog: mocks.save }, Uri: { file: (fsPath: string) => ({ fsPath }) }, workspace: { getWorkspaceFolder: mocks.folder } }));
vi.mock('fs', () => ({ writeFileSync: mocks.write, existsSync: mocks.exists }));
import { FileDialogHandler } from '../../app/handlers/FileDialogHandler.js';
import type { Logger } from '../../app/services/Logger.js';

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

describe('cubemap source creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exists.mockReturnValue(false);
    mocks.save.mockResolvedValue({ fsPath: '/shaders/cube.slang' });
  });
  it.each<[string, 'hooks' | 'native', string, ('2d' | 'cubemap')?]>([
    ['wgsl-buffer', 'hooks', 'fn mainCubemap'],
    ['wgsl-buffer', 'native', 'fn mainCubemap'],
    ['glsl-buffer', 'native', 'void mainCubemap'],
    ['glsl-buffer', 'native', 'void mainImage', '2d'],
    ['slang-compute', 'native', 'ComputeCompute', '2d'],
    ['wgsl-compute', 'native', 'ComputeCompute', '2d'],
    ['script', 'hooks', 'export function uniforms', '2d'],
    ['glsl-common', 'hooks', 'Common', '2d'],
    ['slang-common', 'hooks', 'Common', '2d'],
    ['wgsl-common', 'hooks', 'Common', '2d'],
    ['glsl-vertex', 'hooks', 'void mainVertex', '2d'],
    ['slang-vertex', 'hooks', 'void mainVertex', '2d'],
    ['wgsl-vertex', 'hooks', 'fn mainVertex', '2d'],
    ['slang-compute', 'hooks', 'void compute', '2d'],
    ['wgsl-compute', 'hooks', 'fn compute', '2d'],
    ['slang-compute', 'native', 'ComputeCompute', '2d'],
    ['wgsl-compute', 'native', 'ComputeCompute', '2d'],
    ['glsl-buffer', 'hooks', 'void mainCubemap'],
    ['slang-buffer', 'hooks', 'float4 mainCubemap'],
    ['slang-buffer', 'native', 'float4 mainCubemap'],
    ['slang-compute', 'hooks', 'pixel.z >= 6'],
    ['slang-compute', 'native', 'cubemapDirection'],
    ['slang-buffer', 'native', 'BufferFragment', '2d'],
    ['wgsl-buffer', 'native', 'BufferFragment', '2d'],
    ['wgsl-buffer', 'hooks', 'fn mainImage', '2d'],
    ['slang-buffer', 'hooks', 'float4 mainImage', '2d'],
    ['glsl-buffer', 'hooks', 'void mainImage', '2d'],
  ])('creates %s in %s mode (%s)', async (fileType, authoringMode, source, outputKind = 'cubemap') => {
    const handler = new FileDialogHandler(null!, null!, '', null, () => 1,
      { info: mocks.info, error: mocks.error } as unknown as Logger);
    const respond = vi.fn();
    await handler.handleCreateFile({ shaderPath: '/shaders/image.slang', suggestedPath: 'cube.slang',
      fileType, authoringMode, outputKind, requestId: 'cube', passName: fileType.endsWith('compute') ? 'Compute' : 'Buffer' }, respond);
    expect(mocks.write).toHaveBeenCalledWith('/shaders/cube.slang', expect.stringContaining(source), 'utf-8');
    expect(respond).toHaveBeenCalledWith({ type: 'fileSelected', payload: expect.objectContaining({ path: './cube.slang', requestId: 'cube' }) });
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('keeps an existing cubemap file intact', async () => {
    mocks.exists.mockReturnValue(true);
    const respond = vi.fn();
    const handler = new FileDialogHandler(null!, null!, '', null, () => 1,
      { info: mocks.info, error: mocks.error } as unknown as Logger);
    await handler.handleCreateFile({ shaderPath: '/shaders/image.slang', suggestedPath: 'cube.slang',
      fileType: 'slang-buffer', outputKind: 'cubemap', requestId: 'cube' }, respond);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({ type: 'fileSelected', payload: { path: './cube.slang', requestId: 'cube' } });
  });

});
