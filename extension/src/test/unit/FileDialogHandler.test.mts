import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('vscode', () => ({ window: { showSaveDialog: mocks.save }, Uri: { file: (fsPath: string) => ({ fsPath }) } }));
vi.mock('fs', () => ({ writeFileSync: mocks.write }));
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
