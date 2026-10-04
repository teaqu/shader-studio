import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebGLMultisampleTargets } from "../../webgl/WebGLMultisample";

const createGl = () => {
  let nextId = 0;
  return {
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    RENDERBUFFER: 0x8d41,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_ATTACHMENT: 0x8d00,
    DEPTH_COMPONENT24: 0x81a6,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_BUFFER_BIT: 0x4000,
    NEAREST: 0x2600,
    SAMPLES: 0x80a9,
    RGBA8: 0x8058,
    RGBA16F: 0x881a,
    createFramebuffer: vi.fn(() => ({ framebuffer: nextId++ })),
    createRenderbuffer: vi.fn(() => ({ renderbuffer: nextId++ })),
    bindFramebuffer: vi.fn(),
    bindRenderbuffer: vi.fn(),
    renderbufferStorage: vi.fn(),
    renderbufferStorageMultisample: vi.fn(),
    framebufferRenderbuffer: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    getInternalformatParameter: vi.fn(() => new Int32Array([8, 4, 2])),
    blitFramebuffer: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteRenderbuffer: vi.fn(),
  };
};

describe("WebGLMultisampleTargets", () => {
  let gl: ReturnType<typeof createGl>;
  let targets: WebGLMultisampleTargets;
  const bufferTarget = { framebuffer: { id: "buffer" } as unknown as WebGLFramebuffer, width: 64, height: 32 };
  const canvasTarget = { framebuffer: null, width: 64, height: 32 };

  beforeEach(() => {
    gl = createGl();
    targets = new WebGLMultisampleTargets(gl as unknown as WebGL2RenderingContext);
  });

  it("draws into multisampled colour and depth renderbuffers of the target size", () => {
    const resolve = targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F);

    expect(resolve).toBeTypeOf("function");
    expect(gl.renderbufferStorageMultisample).toHaveBeenCalledWith(gl.RENDERBUFFER, 4, gl.RGBA16F, 64, 32);
    expect(gl.renderbufferStorageMultisample).toHaveBeenCalledWith(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT24, 64, 32);
    const multisampled = gl.createFramebuffer.mock.results[0]!.value;
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, multisampled);
  });

  it("resolves a buffer pass with one blit straight into its target", () => {
    targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F)!();

    const multisampled = gl.createFramebuffer.mock.results[0]!.value;
    expect(gl.blitFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.blitFramebuffer).toHaveBeenCalledWith(0, 0, 64, 32, 0, 0, 64, 32, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.READ_FRAMEBUFFER, multisampled);
    expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.DRAW_FRAMEBUFFER, bufferTarget.framebuffer);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, bufferTarget.framebuffer);
  });

  it("resolves a canvas pass through a single-sample RGBA8 stage, then blits to the canvas", () => {
    targets.begin("Image", canvasTarget, 4, gl.RGBA8)!();

    const [multisampled, stage] = gl.createFramebuffer.mock.results.map((result) => result.value);
    expect(gl.renderbufferStorage).toHaveBeenCalledWith(gl.RENDERBUFFER, gl.RGBA8, 64, 32);
    expect(gl.blitFramebuffer).toHaveBeenCalledTimes(2);
    const binds = gl.bindFramebuffer.mock.calls;
    expect(binds).toContainEqual([gl.READ_FRAMEBUFFER, multisampled]);
    expect(binds).toContainEqual([gl.DRAW_FRAMEBUFFER, stage]);
    expect(binds).toContainEqual([gl.READ_FRAMEBUFFER, stage]);
    expect(binds).toContainEqual([gl.DRAW_FRAMEBUFFER, null]);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, null);
  });

  it("reuses the buffers for the same pass, size, format and sample count", () => {
    targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F);
    targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F);

    expect(gl.createFramebuffer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["size", { ...bufferTarget, width: 128 }, (gl: ReturnType<typeof createGl>) => gl.RGBA16F],
    ["format", bufferTarget, (gl: ReturnType<typeof createGl>) => gl.RGBA8],
  ] as const)("recreates the buffers when the %s changes", (
    _change: string,
    target: typeof bufferTarget,
    format: (context: ReturnType<typeof createGl>) => number,
  ) => {
    targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F);
    const first = gl.createFramebuffer.mock.results[0]!.value;

    targets.begin("BufferA", target, 4, format(gl));

    expect(gl.deleteFramebuffer).toHaveBeenCalledWith(first);
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(2);
  });

  it("clamps to the device's highest sample count for the format", () => {
    gl.getInternalformatParameter.mockReturnValue(new Int32Array([2]));

    targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F);

    expect(gl.renderbufferStorageMultisample).toHaveBeenCalledWith(gl.RENDERBUFFER, 2, gl.RGBA16F, 64, 32);
  });

  it.each([
    ["the format cannot be multisampled", (g: ReturnType<typeof createGl>) => g.getInternalformatParameter.mockReturnValue(new Int32Array([]))],
    ["the query fails", (g: ReturnType<typeof createGl>) => g.getInternalformatParameter.mockReturnValue(null as never)],
  ])("draws without MSAA when %s", (_reason, setup) => {
    setup(gl);

    expect(targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F)).toBeNull();
    expect(gl.createFramebuffer).not.toHaveBeenCalled();
  });

  it("releases everything and draws without MSAA when the framebuffer is incomplete", () => {
    gl.checkFramebufferStatus.mockReturnValue(0);

    expect(targets.begin("Image", canvasTarget, 4, gl.RGBA8)).toBeNull();
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteRenderbuffer).toHaveBeenCalledTimes(2);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, null);
  });

  it("releases the stage too when only the canvas stage is incomplete", () => {
    gl.checkFramebufferStatus.mockReturnValueOnce(gl.FRAMEBUFFER_COMPLETE).mockReturnValueOnce(0);

    expect(targets.begin("Image", canvasTarget, 4, gl.RGBA8)).toBeNull();
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2);
    expect(gl.deleteRenderbuffer).toHaveBeenCalledTimes(3);
  });

  it("gives up cleanly when GL cannot allocate the objects", () => {
    gl.createRenderbuffer.mockReturnValueOnce(null as never);

    expect(targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F)).toBeNull();
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
  });

  it("disposes every pass's buffers once", () => {
    targets.begin("BufferA", bufferTarget, 4, gl.RGBA16F);
    targets.begin("Image", canvasTarget, 4, gl.RGBA8);

    targets.dispose();
    targets.dispose();

    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(3);
    expect(gl.deleteRenderbuffer).toHaveBeenCalledTimes(5);
  });
});
