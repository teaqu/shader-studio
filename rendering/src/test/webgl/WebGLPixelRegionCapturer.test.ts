import { beforeEach, describe, expect, it, vi } from "vitest";
import { PIXEL_INSPECTOR_REGION_SIZE, type PixelRegionRequest } from "../../types/PixelRegion";
import { WebGLPixelRegionCapturer } from "../../webgl/WebGLPixelRegionCapturer";

const createMockGl = () => {
  const buffers: object[] = [];
  const syncs: object[] = [];
  let readFramebuffer: WebGLFramebuffer | null = { existing: true } as unknown as WebGLFramebuffer;
  let packBuffer: WebGLBuffer | null = { existing: true } as unknown as WebGLBuffer;

  const gl = {
    PIXEL_PACK_BUFFER: 0x88eb,
    PIXEL_PACK_BUFFER_BINDING: 0x88ef,
    STREAM_READ: 0x88e1,
    READ_FRAMEBUFFER: 0x8ca8,
    READ_FRAMEBUFFER_BINDING: 0x8caa,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
    UNSIGNALED: 0x9118,
    createBuffer: vi.fn(() => {
      const buffer = { id: buffers.length } as unknown as WebGLBuffer;
      buffers.push(buffer);
      return buffer;
    }),
    bindBuffer: vi.fn((_target: number, buffer: WebGLBuffer | null) => {
      packBuffer = buffer;
    }),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    bindFramebuffer: vi.fn((_target: number, framebuffer: WebGLFramebuffer | null) => {
      readFramebuffer = framebuffer;
    }),
    readPixels: vi.fn(),
    fenceSync: vi.fn(() => {
      const sync = { id: syncs.length } as unknown as WebGLSync;
      syncs.push(sync);
      return sync;
    }),
    flush: vi.fn(),
    getSyncParameter: vi.fn(() => 0x9118),
    getBufferSubData: vi.fn((_target: number, _offset: number, destination: Uint8Array) => {
      destination.fill(7);
    }),
    deleteSync: vi.fn(),
    getParameter: vi.fn((parameter: number) => {
      if (parameter === 0x8caa) return readFramebuffer;
      if (parameter === 0x88ef) return packBuffer;
      return null;
    }),
    isContextLost: vi.fn(() => false),
  } as unknown as WebGL2RenderingContext;

  return gl;
};

const request = (requestId: number, centerX = 40, centerY = 50): PixelRegionRequest => ({
  requestId,
  centerX,
  centerY,
});

describe("WebGLPixelRegionCapturer", () => {
  let gl: WebGL2RenderingContext;
  let capturer: WebGLPixelRegionCapturer;

  beforeEach(() => {
    gl = createMockGl();
    capturer = new WebGLPixelRegionCapturer(gl);
  });

  it("issues PBO readback after render and waits for its fence before CPU readback", () => {
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);

    expect(gl.readPixels).toHaveBeenCalledWith(10, 20, 60, 60, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    expect(gl.fenceSync).toHaveBeenCalledWith(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(gl.getBufferSubData).not.toHaveBeenCalled();

    expect(capturer.collectResults()).toEqual([]);
    expect(gl.getBufferSubData).not.toHaveBeenCalled();

    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);
    expect(capturer.collectResults()).toHaveLength(1);
    expect(gl.getBufferSubData).toHaveBeenCalledOnce();
  });

  it("converts bottom-up GL rows to top-down result rows", () => {
    vi.mocked(gl.getBufferSubData).mockImplementation((_target, _offset, bytes) => {
      for (let row = 0; row < 60; row += 1) {
        bytes.fill(row, row * 60 * 4, (row + 1) * 60 * 4);
      }
    });
    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);

    capturer.queue(request(4));
    capturer.captureAfterRender(100, 100);
    const [result] = capturer.collectResults();

    expect(result.rgba[0]).toBe(59);
    expect(result.rgba[59 * 60 * 4]).toBe(0);
  });

  it("clips and transparently pads every edge while retaining the selected pixel at 30,30", () => {
    vi.mocked(gl.getBufferSubData).mockImplementation((_target, _offset, bytes) => bytes.fill(9));
    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);

    capturer.queue(request(5, 2, 3));
    capturer.captureAfterRender(100, 100);
    const [result] = capturer.collectResults();
    const selectedOffset = (30 * 60 + 30) * 4;

    expect(gl.readPixels).toHaveBeenCalledWith(0, 67, 32, 33, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    expect(result.rgba[0]).toBe(0);
    expect(result.rgba[selectedOffset]).toBe(9);
    expect(result.rgba[(27 * 60 + 28) * 4]).toBe(9);
    expect(result.rgba).toHaveLength(PIXEL_INSPECTOR_REGION_SIZE ** 2 * 4);
  });

  it.each([
    ["left", request(11, 2, 50), [0, 20, 32, 60], [30, 0], [0, 0]],
    ["right", request(12, 98, 50), [68, 20, 32, 60], [30, 0], [59, 0]],
    ["top", request(13, 50, 2), [20, 68, 60, 32], [0, 30], [0, 0]],
    ["bottom", request(14, 50, 98), [20, 0, 60, 32], [0, 30], [0, 59]],
  ])("pads the %s edge", (_edge, regionRequest, readback, selected, padded) => {
    vi.mocked(gl.getBufferSubData).mockImplementation((_target, _offset, bytes) => bytes.fill(9));
    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);

    capturer.queue(regionRequest);
    capturer.captureAfterRender(100, 100);
    const [result] = capturer.collectResults();
    const pixelAt = ([x, y]: number[]) => result.rgba[(y * 60 + x) * 4];

    expect(gl.readPixels).toHaveBeenCalledWith(...readback, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    expect(pixelAt(selected)).toBe(9);
    expect(pixelAt(padded)).toBe(0);
  });

  it("publishes a transparent fixed-size result for a fully outside request without GPU calls", () => {
    capturer.queue(request(9, -100, -100));
    capturer.captureAfterRender(100, 100);

    const [result] = capturer.collectResults();
    expect(gl.readPixels).not.toHaveBeenCalled();
    expect(result).toMatchObject({ requestId: 9, centerX: -100, centerY: -100, width: 60, height: 60 });
    expect(result.rgba.every((value) => value === 0)).toBe(true);
  });

  it("publishes a transparent fixed-size result for a zero-sized canvas without GPU calls", () => {
    capturer.queue(request(10));
    capturer.captureAfterRender(0, 0);

    const [result] = capturer.collectResults();
    expect(gl.readPixels).not.toHaveBeenCalled();
    expect(gl.fenceSync).not.toHaveBeenCalled();
    expect(result).toMatchObject({ requestId: 10, width: 60, height: 60 });
    expect(result.rgba.every((value) => value === 0)).toBe(true);
  });

  it("keeps only the newest request while all three PBO slots are in flight", () => {
    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.UNSIGNALED);
    for (let id = 1; id <= 3; id += 1) {
      capturer.queue(request(id, id * 10, 50));
      capturer.captureAfterRender(200, 100);
    }
    capturer.queue(request(4, 90, 50));
    capturer.captureAfterRender(200, 100);
    capturer.queue(request(5, 120, 50));
    capturer.captureAfterRender(200, 100);
    expect(gl.readPixels).toHaveBeenCalledTimes(3);

    vi.mocked(gl.getSyncParameter).mockReturnValueOnce(gl.SIGNALED).mockReturnValue(gl.UNSIGNALED);
    capturer.collectResults();
    capturer.captureAfterRender(200, 100);

    expect(gl.readPixels).toHaveBeenLastCalledWith(90, 20, 60, 60, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  });

  it("reuses a collected PBO of the same byte size", () => {
    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);
    capturer.collectResults();
    capturer.queue(request(2));
    capturer.captureAfterRender(100, 100);

    expect(gl.createBuffer).toHaveBeenCalledOnce();
  });

  it("restores framebuffer and pack-buffer bindings after failed buffer creation", () => {
    vi.mocked(gl.createBuffer).mockReturnValue(null);
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);

    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.READ_FRAMEBUFFER, { existing: true });
    expect(gl.bindBuffer).toHaveBeenLastCalledWith(gl.PIXEL_PACK_BUFFER, { existing: true });
    vi.mocked(gl.createBuffer).mockReturnValue({ retry: true } as unknown as WebGLBuffer);
    capturer.captureAfterRender(100, 100);
    expect(gl.readPixels).toHaveBeenCalledOnce();
  });

  it("restores framebuffer and pack-buffer bindings after a successful capture", () => {
    const originalFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const originalPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);

    expect(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)).toBe(originalFramebuffer);
    expect(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)).toBe(originalPackBuffer);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.READ_FRAMEBUFFER, originalFramebuffer);
    expect(gl.bindBuffer).toHaveBeenLastCalledWith(gl.PIXEL_PACK_BUFFER, originalPackBuffer);
  });

  it("retries a request when fence creation fails without leaking its PBO", () => {
    vi.mocked(gl.fenceSync).mockReturnValue(null);
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);

    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
    vi.mocked(gl.fenceSync).mockReturnValue({ retry: true } as unknown as WebGLSync);
    capturer.captureAfterRender(100, 100);
    expect(gl.readPixels).toHaveBeenCalledTimes(2);
  });

  it("restores bindings when fence creation fails after changing them", () => {
    const originalFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const originalPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    vi.mocked(gl.fenceSync).mockImplementation(() => {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, { changed: true } as unknown as WebGLFramebuffer);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, { changed: true } as unknown as WebGLBuffer);
      return null;
    });

    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);

    expect(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)).toBe(originalFramebuffer);
    expect(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)).toBe(originalPackBuffer);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.READ_FRAMEBUFFER, originalFramebuffer);
    expect(gl.bindBuffer).toHaveBeenLastCalledWith(gl.PIXEL_PACK_BUFFER, originalPackBuffer);
  });

  it("swallows readPixels failures, restores bindings, and retries the same request", () => {
    const originalFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const originalPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    vi.mocked(gl.readPixels).mockImplementationOnce(() => {
      throw new Error("driver readback failure");
    });
    capturer.queue(request(1));

    expect(() => capturer.captureAfterRender(100, 100)).not.toThrow();
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
    expect(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)).toBe(originalFramebuffer);
    expect(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)).toBe(originalPackBuffer);

    capturer.captureAfterRender(100, 100);
    expect(gl.readPixels).toHaveBeenCalledTimes(2);
    expect(gl.readPixels).toHaveBeenLastCalledWith(10, 20, 60, 60, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  });

  it("keeps a newer queued request when retrying an older readPixels failure", () => {
    vi.mocked(gl.readPixels).mockImplementationOnce(() => {
      capturer.queue(request(2, 90, 50));
      throw new Error("driver readback failure");
    });
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);

    capturer.captureAfterRender(100, 100);

    expect(gl.readPixels).toHaveBeenLastCalledWith(60, 20, 40, 60, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  });

  it("swallows flush failures, deletes the issued fence and PBO, then retries", () => {
    vi.mocked(gl.flush).mockImplementationOnce(() => {
      throw new Error("driver flush failure");
    });
    capturer.queue(request(1));

    expect(() => capturer.captureAfterRender(100, 100)).not.toThrow();
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();

    capturer.captureAfterRender(100, 100);
    expect(gl.readPixels).toHaveBeenCalledTimes(2);
  });

  it("does not issue work while context is lost", () => {
    vi.mocked(gl.isContextLost).mockReturnValue(true);
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);

    expect(gl.readPixels).not.toHaveBeenCalled();
    expect(capturer.collectResults()).toEqual([]);
  });

  it("invalidates pending, pooled, and completed data without GL deletion after context loss", () => {
    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);
    capturer.collectResults();
    capturer.queue(request(2, -100, -100));
    capturer.captureAfterRender(100, 100);
    capturer.queue(request(3));
    capturer.captureAfterRender(100, 100);
    vi.mocked(gl.deleteSync).mockClear();
    vi.mocked(gl.deleteBuffer).mockClear();
    vi.mocked(gl.isContextLost).mockReturnValue(true);

    expect(capturer.collectResults()).toEqual([]);
    capturer.cancelPendingCaptures();
    expect(capturer.collectResults()).toEqual([]);
    expect(gl.deleteSync).not.toHaveBeenCalled();
    expect(gl.deleteBuffer).not.toHaveBeenCalled();
  });

  it("retains a pending capture when sync polling throws while collecting other captures", () => {
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);
    capturer.queue(request(2, 80, 50));
    capturer.captureAfterRender(100, 100);
    const originalPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    vi.mocked(gl.getSyncParameter).mockImplementation((sync) => {
      if ((sync as unknown as { id: number }).id === 0) {
        throw new Error("driver sync polling failure");
      }
      return gl.SIGNALED;
    });

    const firstResults = capturer.collectResults();
    expect(firstResults).toHaveLength(1);
    expect(firstResults[0].requestId).toBe(2);
    expect(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)).toBe(originalPackBuffer);
    expect(gl.deleteSync).toHaveBeenCalledOnce();

    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);
    expect(capturer.collectResults()).toMatchObject([{ requestId: 1 }]);
    expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });

  it("retains a pending capture when buffer readback throws while collecting other captures", () => {
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);
    capturer.queue(request(2, 80, 50));
    capturer.captureAfterRender(100, 100);
    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);
    const originalPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    vi.mocked(gl.getBufferSubData).mockImplementationOnce(() => {
      throw new Error("driver buffer readback failure");
    });

    const firstResults = capturer.collectResults();
    expect(firstResults).toHaveLength(1);
    expect(firstResults[0].requestId).toBe(2);
    expect(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)).toBe(originalPackBuffer);
    expect(gl.deleteSync).toHaveBeenCalledOnce();

    expect(capturer.collectResults()).toMatchObject([{ requestId: 1 }]);
    expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });

  it("cancels and disposes all resources exactly once and rejects future requests", () => {
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);
    capturer.cancelPendingCaptures();
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
    expect(capturer.collectResults()).toEqual([]);

    capturer.dispose();
    capturer.dispose();
    expect(capturer.queue(request(2))).toBe(false);
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
  });

  it("deletes both pooled and pending PBOs when cancelled", () => {
    vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);
    capturer.queue(request(1));
    capturer.captureAfterRender(100, 100);
    capturer.collectResults();
    capturer.queue(request(2, 2, 2));
    capturer.captureAfterRender(100, 100);
    vi.mocked(gl.deleteSync).mockClear();
    vi.mocked(gl.deleteBuffer).mockClear();

    capturer.cancelPendingCaptures();

    expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
  });
});
