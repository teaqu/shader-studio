import { describe, expect, it } from 'vitest';
import type {
  CreateFileMessage,
  FileDialogFileType,
  FileSelectedMessage,
  LanguageServiceSettingsMessage,
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

  it('represent the WGSL buffer select/create/response workflow', () => {
    const fileType: FileDialogFileType = 'wgsl-buffer';
    const vertexType: FileDialogFileType = 'wgsl-vertex';
    const commonType: FileDialogFileType = 'wgsl-common';
    const computeType: FileDialogFileType = 'wgsl-compute';
    const createMessage: CreateFileMessage = {
      type: 'createFile',
      payload: {
        shaderPath: '/shaders/image.wgsl',
        suggestedPath: 'image.buffera.wgsl',
        fileType,
        requestId: 'create-1',
      },
    };

    expect(createMessage.payload.fileType).toBe('wgsl-buffer');
    expect(vertexType).toBe('wgsl-vertex');
    expect(commonType).toBe('wgsl-common');
    expect(computeType).toBe('wgsl-compute');
  });
});

describe('language service settings message types', () => {
  it('represents the WGSL language-service setting', () => {
    const message: LanguageServiceSettingsMessage = {
      type: 'languageServiceSettings',
      payload: {
        glslEnabled: true,
        slangEnabled: true,
        wgslEnabled: false,
        colorDecorators: true,
        trace: 'off',
      },
    };

    expect(message.payload.wgslEnabled).toBe(false);
  });
});
