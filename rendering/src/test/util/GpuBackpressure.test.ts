import { describe, expect, it, vi } from "vitest";
import { GpuBackpressure, webglFrameCompletion, webgpuFrameCompletion } from "../../util/GpuBackpressure";
import { ConfigValidator } from "../../util/ConfigValidator";
import type { ShaderConfig } from "@shader-studio/types";

function completion(done = false) {
  return { poll: vi.fn(() => done), dispose: vi.fn() };
}

describe("GPU admission", () => {
  it("bounds pending frames and resumes only after ordered completion", () => {
    const gate = new GpuBackpressure(vi.fn());
    const first = completion(), second = completion(true);
    expect(gate.canSubmit(0)).toBe(true);
    gate.submitted(first, 0); gate.submitted(second, 1);
    expect(gate.canSubmit(2)).toBe(false);
    expect(second.poll).not.toHaveBeenCalled();
    first.poll.mockReturnValue(true);
    expect(gate.canSubmit(3)).toBe(true);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("applies changed limits without discarding pending frames", () => {
    const gate = new GpuBackpressure(vi.fn());
    gate.submitted(completion(), 10);
    gate.configure({ framesInFlight: 1, stallTimeoutMs: 100 });
    expect(gate.canSubmit(20)).toBe(false);
    gate.configure({ framesInFlight: 3, stallTimeoutMs: 100 });
    expect(gate.canSubmit(20)).toBe(true);
  });

  it("warns once per stall, including when the queue is below its limit", () => {
    const warn = vi.fn(), gate = new GpuBackpressure(warn), pending = completion();
    gate.configure({ framesInFlight: 2, stallTimeoutMs: 100 });
    gate.submitted(pending, 10);
    expect(gate.canSubmit(109)).toBe(true);
    expect(gate.canSubmit(110)).toBe(false);
    expect(gate.canSubmit(200)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    pending.poll.mockReturnValue(true);
    expect(gate.canSubmit(201)).toBe(true);
    gate.submitted(completion(), 202);
    expect(gate.canSubmit(302)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("restarts the progress clock after a partial completion", () => {
    const gate = new GpuBackpressure(vi.fn()), first = completion(true);
    gate.configure({ framesInFlight: 2, stallTimeoutMs: 100 });
    gate.submitted(first, 0); gate.submitted(completion(), 1);
    expect(gate.canSubmit(99)).toBe(true);
    expect(gate.canSubmit(198)).toBe(true);
    expect(gate.canSubmit(199)).toBe(false);
  });

  it("fails closed on polling errors and releases all fences on disposal", () => {
    const warn = vi.fn(), gate = new GpuBackpressure(warn), pending = completion();
    pending.poll.mockImplementation(() => {
      throw new Error("lost");
    });
    gate.submitted(pending, 0);
    expect(gate.canSubmit(1)).toBe(false);
    expect(gate.canSubmit(2)).toBe(false);
    gate.fail("duplicate");
    expect(warn).toHaveBeenCalledOnce();
    gate.dispose(); gate.dispose();
    expect(pending.dispose).toHaveBeenCalledOnce();
    expect(gate.canSubmit(3)).toBe(true);
  });
});

describe("WebGL completions", () => {
  function glMock() {
    return { fenceSync: vi.fn(() => ({})), flush: vi.fn(), clientWaitSync: vi.fn(() => 3), deleteSync: vi.fn(),
      SYNC_GPU_COMMANDS_COMPLETE: 1, WAIT_FAILED: 2, TIMEOUT_EXPIRED: 3, ALREADY_SIGNALED: 4, CONDITION_SATISFIED: 5 };
  }
  it("polls with zero wait and cleans the fence", () => {
    const gl = glMock(), fence = webglFrameCompletion(gl as unknown as WebGL2RenderingContext);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(fence.poll()).toBe(false);
    expect(gl.clientWaitSync).toHaveBeenCalledWith(expect.anything(), 0, 0);
    for (const status of [gl.ALREADY_SIGNALED, gl.CONDITION_SATISFIED]) {
      gl.clientWaitSync.mockReturnValue(status); expect(fence.poll()).toBe(true);
    }
    gl.clientWaitSync.mockReturnValue(gl.WAIT_FAILED);
    expect(() => fence.poll()).toThrow();
    fence.dispose(); expect(gl.deleteSync).toHaveBeenCalledOnce();
  });
  it("rejects fence allocation failure", () => {
    const gl = glMock(); gl.fenceSync.mockReturnValue(null as unknown as object);
    expect(() => webglFrameCompletion(gl as unknown as WebGL2RenderingContext)).toThrow();
    expect(gl.flush).not.toHaveBeenCalled();
  });
});

describe("WebGPU completions", () => {
  it("tracks asynchronous completion without awaiting the UI thread", async () => {
    let resolve!: () => void;
    const queue = { onSubmittedWorkDone: vi.fn(() => new Promise<void>(r => {
      resolve = r;
    })) };
    const fence = webgpuFrameCompletion(queue as unknown as GPUQueue);
    expect(fence.poll()).toBe(false);
    resolve(); await Promise.resolve();
    expect(fence.poll()).toBe(true);
  });
  it("handles rejection and ignores callbacks after disposal", async () => {
    const queue = { onSubmittedWorkDone: () => Promise.reject(new Error("lost")) };
    const fence = webgpuFrameCompletion(queue as unknown as GPUQueue);
    await Promise.resolve(); expect(() => fence.poll()).toThrow();
    const disposed = webgpuFrameCompletion(queue as unknown as GPUQueue);
    disposed.dispose(); await Promise.resolve(); expect(disposed.poll()).toBe(false);
    const resolved = webgpuFrameCompletion({ onSubmittedWorkDone: () => Promise.resolve() } as unknown as GPUQueue);
    resolved.dispose(); await Promise.resolve(); expect(resolved.poll()).toBe(false);
  });
});

describe("GPU config validation", () => {
  it.each([{}, { framesInFlight: 1 }, { stallTimeoutMs: 300 }, { framesInFlight: 3, stallTimeoutMs: 1 }])("accepts partial settings %j", gpuBackpressure => {
    expect(ConfigValidator.validateConfig({ version: "1.0", passes: { Image: {} }, gpuBackpressure }).isValid).toBe(true);
  });
  it.each([null, [], 2, { framesInFlight: 0 }, { framesInFlight: 1.5 }, { stallTimeoutMs: -1 }, { stallTimeoutMs: "3" }, { unknown: 1 }])("rejects invalid settings %j", value => {
    const config = { version: "1.0", passes: { Image: {} }, gpuBackpressure: value } as unknown as ShaderConfig;
    expect(ConfigValidator.validateConfig(config).isValid).toBe(false);
  });
});
