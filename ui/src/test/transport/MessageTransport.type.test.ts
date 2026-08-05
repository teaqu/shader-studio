import { describe, expect, it } from 'vitest';
import type { Transport } from '../../lib/transport/MessageTransport';

function assertFileDialogTransportTypes(transport: Transport) {
  transport.postMessage({
    type: 'selectFile',
    payload: {
      shaderPath: '/shaders/image.slang',
      fileType: 'slang-compute',
      requestId: 'valid',
    },
  });

  // @ts-expect-error selectFile must use a shared FileDialogFileType.
  transport.postMessage({ type: 'selectFile', payload: { shaderPath: '/shaders/image.slang', fileType: 'not-a-file-type', requestId: 'invalid' } });
}

describe('Transport file dialog message contract', () => {
  it('retains its compile-time file dialog assertions', () => {
    expect(assertFileDialogTransportTypes).toBeTypeOf('function');
  });
});
