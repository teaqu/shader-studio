import { describe, expect, it } from 'vitest';
import type {
  CreateFileMessage,
  FileDialogFileType,
  FileSelectedMessage,
  SelectFileMessage,
} from './MessageTypes';

describe('file dialog message types', () => {
  it('represent the Slang compute select/create/response workflow', () => {
    const fileType: FileDialogFileType = 'slang-compute';
    const selectMessage: SelectFileMessage = {
      type: 'selectFile',
      payload: { shaderPath: '/shaders/image.slang', fileType, requestId: 'select-1' },
    };
    const createMessage: CreateFileMessage = {
      type: 'createFile',
      payload: {
        shaderPath: '/shaders/image.slang',
        suggestedPath: 'image.computea.slang',
        fileType,
        requestId: 'create-1',
      },
    };
    const responseMessage: FileSelectedMessage = {
      type: 'fileSelected',
      payload: { path: './image.computea.slang', requestId: 'create-1' },
    };

    expect(selectMessage.payload.fileType).toBe('slang-compute');
    expect(createMessage.payload.suggestedPath).toBe('image.computea.slang');
    expect(responseMessage.payload.path).toBe('./image.computea.slang');
  });
});
