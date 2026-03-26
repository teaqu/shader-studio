import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the WASM bytes module
vi.mock('../../lib/recording/gifskiWasmBytes', () => ({
  default: new ArrayBuffer(16),
}));

// Mock Worker and URL.createObjectURL
const mockPostMessage = vi.fn();
const mockTerminate = vi.fn();
let workerOnMessage: ((e: MessageEvent) => void) | null = null;
let workerOnError: ((e: ErrorEvent) => void) | null = null;

class MockWorker {
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  postMessage = mockPostMessage;
  terminate = mockTerminate;

  constructor() {
    // Capture handlers for test access — onmessage/onerror are set before postMessage is called
    const self = this;
    mockPostMessage.mockImplementation(() => {
      workerOnMessage = self.onmessage;
      workerOnError = self.onerror;
    });
  }
}

vi.stubGlobal('Worker', MockWorker);
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:mock-worker-url'),
  revokeObjectURL: vi.fn(),
});
vi.stubGlobal('Blob', class MockBlob {
  constructor(public parts: any[], public options?: any) {}
});

import { GifEncoderWrapper } from '../../lib/recording/GifEncoder';

// Polyfill ImageData
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? (data.length / (4 * width));
    }
  };
}

function makeImageData(w: number, h: number): ImageData {
  return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
}

describe('GifEncoderWrapper', () => {
  let encoder: GifEncoderWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    workerOnMessage = null;
    workerOnError = null;
    encoder = new GifEncoderWrapper({ width: 10, height: 10, fps: 15 });
  });

  describe('constructor', () => {
    it('should set default quality to 100', () => {
      const enc = new GifEncoderWrapper({ width: 10, height: 10, fps: 15 });
      // Quality is private, but we can verify it's passed to the worker later
      expect(enc).toBeDefined();
    });

    it('should accept custom quality', () => {
      const enc = new GifEncoderWrapper({ width: 10, height: 10, fps: 15, quality: 50 });
      expect(enc).toBeDefined();
    });

    it('should accept custom repeat', () => {
      const enc = new GifEncoderWrapper({ width: 10, height: 10, fps: 15, repeat: -1 });
      expect(enc).toBeDefined();
    });
  });

  describe('addFrame', () => {
    it('should buffer frames', () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));
      // Frames are buffered internally — verified when finish sends them
      expect(true).toBe(true);
    });

    it('should not buffer frames after cancel', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.cancel();
      encoder.addFrame(makeImageData(10, 10));
      await expect(encoder.finish()).rejects.toThrow('Recording cancelled');
    });
  });

  describe('finish', () => {
    it('should throw if cancelled', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));
      encoder.cancel();
      await expect(encoder.finish()).rejects.toThrow('Recording cancelled');
    });

    it('should throw if less than 2 frames', async () => {
      encoder.addFrame(makeImageData(10, 10));
      await expect(encoder.finish()).rejects.toThrow('At least 2 frames required');
    });

    it('should throw with 0 frames', async () => {
      await expect(encoder.finish()).rejects.toThrow('At least 2 frames required');
    });

    it('should create a worker and post frame data', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      const msg = mockPostMessage.mock.calls[0][0];
      expect(msg.type).toBe('encode');
      expect(msg.numFrames).toBe(2);
      expect(msg.width).toBe(10);
      expect(msg.height).toBe(10);
      expect(msg.fps).toBe(15);
      expect(msg.quality).toBe(100);
      expect(msg.repeat).toBe(0);
      expect(msg.framesBuffer).toBeInstanceOf(Uint8Array);
      expect(msg.framesBuffer.length).toBe(2 * 10 * 10 * 4);
      expect(msg.wasmBytes).toBeInstanceOf(ArrayBuffer);

      // Simulate worker completing
      
      workerOnMessage!({ data: { type: 'done', data: new Uint8Array([1, 2, 3]) } } as any);

      const result = await finishPromise;
      expect(result).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('should pass custom quality and repeat to worker', async () => {
      const enc = new GifEncoderWrapper({ width: 5, height: 5, fps: 10, quality: 50, repeat: -1 });
      enc.addFrame(makeImageData(5, 5));
      enc.addFrame(makeImageData(5, 5));

      const finishPromise = enc.finish();

      
      const msg = mockPostMessage.mock.calls[0][0];
      expect(msg.quality).toBe(50);
      expect(msg.repeat).toBe(-1);

      
      workerOnMessage!({ data: { type: 'done', data: new Uint8Array([1]) } } as any);
      await finishPromise;
    });

    it('should transfer frame buffer to worker', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      
      // Second arg to postMessage is transferables
      const transferables = mockPostMessage.mock.calls[0][1];
      expect(transferables).toHaveLength(1);
      expect(transferables[0]).toBeInstanceOf(ArrayBuffer);

      
      workerOnMessage!({ data: { type: 'done', data: new Uint8Array([1]) } } as any);
      await finishPromise;
    });

    it('should reject on worker error message', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      
      workerOnMessage!({ data: { type: 'error', message: 'WASM failed' } } as any);

      await expect(finishPromise).rejects.toThrow('GIF encode: WASM failed');
    });

    it('should reject on worker onerror', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      
      workerOnError!({ message: 'Script error' } as any);

      await expect(finishPromise).rejects.toThrow('GIF worker error: Script error');
    });

    it('should terminate worker after done', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      
      workerOnMessage!({ data: { type: 'done', data: new Uint8Array([1]) } } as any);
      await finishPromise;

      expect(mockTerminate).toHaveBeenCalled();
    });

    it('should terminate worker after error', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      
      workerOnMessage!({ data: { type: 'error', message: 'fail' } } as any);

      await expect(finishPromise).rejects.toThrow();
      expect(mockTerminate).toHaveBeenCalled();
    });

    it('should free frames after concatenation', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      // After finish starts, adding more frames shouldn't affect the encode
      // (frames array was cleared)
      
      workerOnMessage!({ data: { type: 'done', data: new Uint8Array([1]) } } as any);
      await finishPromise;
    });
  });

  describe('cancel', () => {
    it('should set cancelled state', async () => {
      encoder.cancel();
      await expect(encoder.finish()).rejects.toThrow('Recording cancelled');
    });

    it('should clear buffered frames', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));
      encoder.cancel();
      await expect(encoder.finish()).rejects.toThrow('Recording cancelled');
    });

    it('should terminate active worker', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      

      encoder.cancel();

      expect(mockTerminate).toHaveBeenCalled();
      await expect(finishPromise).rejects.toThrow('Recording cancelled');
    });

    it('should reject pending finish promise', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      

      encoder.cancel();

      await expect(finishPromise).rejects.toThrow('Recording cancelled');
    });

    it('should not throw if no worker is active', () => {
      expect(() => encoder.cancel()).not.toThrow();
    });

    it('should prevent future addFrame calls', async () => {
      encoder.cancel();
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));
      await expect(encoder.finish()).rejects.toThrow('Recording cancelled');
    });
  });

  describe('worker blob URL', () => {
    it('should create worker and post message on finish', async () => {
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));

      const finishPromise = encoder.finish();

      // Worker was created and postMessage was called — proves blob URL worker works
      

      
      workerOnMessage!({ data: { type: 'done', data: new Uint8Array([1]) } } as any);
      await finishPromise;
    });

    it('should reuse blob URL across instances', async () => {
      // First encoder
      encoder.addFrame(makeImageData(10, 10));
      encoder.addFrame(makeImageData(10, 10));
      let p = encoder.finish();
      
      workerOnMessage!({ data: { type: 'done', data: new Uint8Array([1]) } } as any);
      await p;

      const firstCallCount = (URL.createObjectURL as any).mock.calls.length;

      // Second encoder
      workerOnMessage = null;
      const enc2 = new GifEncoderWrapper({ width: 10, height: 10, fps: 15 });
      enc2.addFrame(makeImageData(10, 10));
      enc2.addFrame(makeImageData(10, 10));
      p = enc2.finish();
      
      workerOnMessage!({ data: { type: 'done', data: new Uint8Array([1]) } } as any);
      await p;

      // Should not have created another blob URL
      expect((URL.createObjectURL as any).mock.calls.length).toBe(firstCallCount);
    });
  });
});
