import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finalizeLiveMp4 } from "../../lib/recording/finalizeLiveMp4";

const mocks = vi.hoisted(() => ({
  init: vi.fn(), execute: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), cancelOutput: vi.fn(),
  target: { buffer: null as ArrayBuffer | null },
}));
vi.mock("mediabunny", () => ({
  Input: class {
    dispose = mocks.dispose;
  },
  BlobSource: class {}, MP4: {},
  BufferTarget: class {
    constructor() {
      return mocks.target;
    }
  },
  Output: class {
    cancel = mocks.cancelOutput;
  }, Mp4OutputFormat: class {},
  Conversion: { init: mocks.init },
}));
beforeEach(() => {
  mocks.target.buffer = new ArrayBuffer(4);
  mocks.execute.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.cancelOutput.mockResolvedValue(undefined);
  mocks.init.mockResolvedValue({ isValid: true, discardedTracks: [], utilizedTracks: [{}], execute: mocks.execute, cancel: mocks.cancel });
});
afterEach(() => vi.resetAllMocks());

it("copies packets into a completed MP4 without transcoding", async () => {
  const blob = await finalizeLiveMp4(new Blob(["fragments"]), new AbortController().signal);
  expect(blob.type).toBe("video/mp4");
  expect(blob.size).toBe(4);
  expect(mocks.init).toHaveBeenCalledWith(expect.objectContaining({ copy: { mode: "forced" } }));
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
it.each([
  { isValid: false, discardedTracks: [], utilizedTracks: [{}] },
  { isValid: true, discardedTracks: [{}], utilizedTracks: [{}] },
  { isValid: true, discardedTracks: [], utilizedTracks: [] },
])("rejects an incomplete conversion (%j)", async state => {
  mocks.init.mockResolvedValueOnce(state);
  await expect(finalizeLiveMp4(new Blob(["data"]), new AbortController().signal)).rejects.toThrow("without losing frames");
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
it("propagates muxing failures and releases the input", async () => {
  mocks.execute.mockRejectedValueOnce(new Error("mux failed"));
  await expect(finalizeLiveMp4(new Blob(["data"]), new AbortController().signal)).rejects.toThrow("mux failed");
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
it("rejects empty finalized output", async () => {
  mocks.target.buffer = null;
  await expect(finalizeLiveMp4(new Blob(["data"]), new AbortController().signal)).rejects.toThrow("empty file");
});
it("cancels an active conversion and refuses its output", async () => {
  const controller = new AbortController();
  mocks.execute.mockImplementationOnce(async () => {
    controller.abort(new Error("Recording cancelled"));
  });
  await expect(finalizeLiveMp4(new Blob(["data"]), controller.signal)).rejects.toThrow("Recording cancelled");
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
it("does not open media when already cancelled", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Recording cancelled"));
  await expect(finalizeLiveMp4(new Blob(["data"]), controller.signal)).rejects.toThrow("Recording cancelled");
  expect(mocks.init).not.toHaveBeenCalled();
});
