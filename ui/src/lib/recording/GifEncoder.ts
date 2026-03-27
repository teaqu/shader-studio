import gifskiWasmBytes from "./gifskiWasmBytes";

export interface GifEncoderOptions {
  width: number;
  height: number;
  fps: number;
  quality?: number; // 1-100, default 100
  repeat?: number; // 0 = infinite, -1 = once, N = N times
}

// Self-contained worker code that initializes gifski WASM and encodes.
// This runs in a blob URL worker to avoid blocking the main thread.
const workerCode = `
let wasm;
const td = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
let u8 = null, u32 = null, i32 = null, vecLen = 0;
function gu8() { if (!u8 || u8.byteLength === 0) u8 = new Uint8Array(wasm.memory.buffer); return u8; }
function gu32() { if (!u32 || u32.byteLength === 0) u32 = new Uint32Array(wasm.memory.buffer); return u32; }
function gi32() { if (!i32 || i32.byteLength === 0) i32 = new Int32Array(wasm.memory.buffer); return i32; }
function pass8(arg, malloc) { const p = malloc(arg.length, 1) >>> 0; gu8().set(arg, p); vecLen = arg.length; return p; }
function isNone(x) { return x === undefined || x === null; }

function encode(frames, n, w, h, fps, quality, repeat) {
  try {
    const ret = wasm.__wbindgen_add_to_stack_pointer(-16);
    const p0 = pass8(frames, wasm.__wbindgen_malloc);
    const l0 = vecLen;
    wasm.encode(ret, p0, l0, n, w, h,
      isNone(fps) ? 0xFFFFFF : fps,
      0, 0,
      isNone(quality) ? 0xFFFFFF : quality,
      !isNone(repeat), isNone(repeat) ? 0 : repeat,
      true, w, true, h);
    const r0 = gi32()[ret / 4];
    const r1 = gi32()[ret / 4 + 1];
    const out = gu8().slice(r0 >>> 0, (r0 >>> 0) + r1);
    wasm.__wbindgen_free(r0, r1, 1);
    return out;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

self.onmessage = function(e) {
  const { type, wasmBytes, framesBuffer, numFrames, width, height, fps, quality, repeat } = e.data;
  if (type === 'encode') {
    try {
      // Init WASM
      const imports = { wbg: {} };
      imports.wbg.__wbindgen_throw = function(a, b) {
        throw new Error(td.decode(gu8().subarray(a >>> 0, (a >>> 0) + b)));
      };
      const mod = new WebAssembly.Module(wasmBytes);
      const inst = new WebAssembly.Instance(mod, imports);
      wasm = inst.exports;
      u8 = null; u32 = null; i32 = null;

      const result = encode(framesBuffer, numFrames, width, height, fps, quality, repeat);
      self.postMessage({ type: 'done', data: result }, [result.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message || String(err) });
    }
  }
};
`;

let workerBlobUrl: string | null = null;

function getWorkerUrl(): string {
  if (!workerBlobUrl) {
    workerBlobUrl = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));
  }
  return workerBlobUrl;
}

/**
 * GIF encoder using gifski-wasm in a Web Worker.
 * High-quality dithered GIFs with cross-frame palette optimization.
 *
 * Frames are buffered during capture, then encoded in a worker thread
 * so the UI stays responsive during finalization. Cancel works at any time.
 */
export class GifEncoderWrapper {
  private width: number;
  private height: number;
  private fps: number;
  private quality: number;
  private repeat: number;
  private frames: Uint8Array[] = [];
  private cancelled = false;
  private worker: Worker | null = null;
  private pendingReject: ((err: Error) => void) | null = null;

  constructor(options: GifEncoderOptions) {
    this.width = options.width;
    this.height = options.height;
    this.fps = options.fps;
    this.quality = options.quality ?? 100;
    this.repeat = options.repeat ?? 0;
  }

  addFrame(imageData: ImageData): void {
    if (this.cancelled) {
      return;
    }
    this.frames.push(new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength));
  }

  async finish(): Promise<Uint8Array> {
    if (this.cancelled) {
      throw new Error("Recording cancelled");
    }
    if (this.frames.length < 2) {
      throw new Error("At least 2 frames required");
    }

    // Concatenate frames into single buffer
    const totalLength = this.frames.reduce((acc, f) => acc + f.length, 0);
    const framesBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const frame of this.frames) {
      framesBuffer.set(frame, offset);
      offset += frame.length;
    }
    const numFrames = this.frames.length;
    this.frames = [];

    // Copy WASM bytes each time — the original ArrayBuffer may be detached
    // from a previous transfer. 293KB copy is negligible vs encoding cost.
    const wasmBytes = new Uint8Array(new Uint8Array(gifskiWasmBytes)).buffer;

    return new Promise((resolve, reject) => {
      this.pendingReject = reject;
      this.worker = new Worker(getWorkerUrl());

      this.worker.onmessage = (e) => {
        this.pendingReject = null;
        if (e.data.type === "done") {
          resolve(e.data.data);
        } else if (e.data.type === "error") {
          reject(new Error(`GIF encode: ${e.data.message}`));
        }
        this.worker?.terminate();
        this.worker = null;
      };

      this.worker.onerror = (e) => {
        this.pendingReject = null;
        reject(new Error(`GIF worker error: ${e.message}`));
        this.worker?.terminate();
        this.worker = null;
      };

      // Transfer frame buffer (zero-copy), send WASM bytes as copy
      this.worker.postMessage({
        type: "encode",
        wasmBytes,
        framesBuffer,
        numFrames,
        width: this.width,
        height: this.height,
        fps: this.fps,
        quality: this.quality,
        repeat: this.repeat,
      }, [framesBuffer.buffer]);
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.frames = [];
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingReject = null;
      reject(new Error("Recording cancelled"));
    }
  }
}
