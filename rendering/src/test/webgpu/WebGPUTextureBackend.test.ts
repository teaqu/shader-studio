import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebGPUTextureBackend, expandR8ToRgba8, imageToGrayscaleRgba8 } from "../../webgpu/WebGPUTextureBackend";

// jsdom has no WebGPU globals; GPUTextureUsage/GPUShaderStage are already
// stubbed globally in src/test/setup.ts, so no local vi.stubGlobal needed here.

function mockDevice() {
  const makeTexture = (desc: GPUTextureDescriptor) => ({
    desc,
    createView: vi.fn((viewDesc?: GPUTextureViewDescriptor) => ({ viewDesc })),
    destroy: vi.fn(),
  });
  const device = {
    createTexture: vi.fn(makeTexture),
    createSampler: vi.fn((desc: GPUSamplerDescriptor) => ({ desc })),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() })),
      finish: vi.fn(() => ({})),
    })),
    queue: { writeTexture: vi.fn(), copyExternalImageToTexture: vi.fn(), submit: vi.fn() },
  };
  return device as unknown as GPUDevice & typeof device;
}

describe("expandR8ToRgba8", () => {
  it("replicates r into rgb with opaque alpha", () => {
    expect(Array.from(expandR8ToRgba8(new Uint8Array([7, 200]), 2, 1)))
      .toEqual([7, 7, 7, 255, 200, 200, 200, 255]);
  });
});

describe("WebGPUTextureBackend.createTexture", () => {
  let device: ReturnType<typeof mockDevice>;
  let backend: WebGPUTextureBackend;

  beforeEach(() => {
    device = mockDevice();
    backend = new WebGPUTextureBackend(device);
  });

  it("creates an rgba8unorm texture with view, sampler, and dimensions", () => {
    const handle = backend.createTexture({ type: "2d", width: 4, height: 2, format: "rgba8", filter: "linear", wrap: "repeat" });
    expect(handle).not.toBeNull();
    expect(device.createTexture).toHaveBeenCalledWith(expect.objectContaining({
      size: { width: 4, height: 2 },
      format: "rgba8unorm",
      mipLevelCount: 1,
    }));
    expect(handle!.width).toBe(4);
    expect(handle!.height).toBe(2);
    expect(device.createSampler).toHaveBeenCalledWith(expect.objectContaining({
      magFilter: "linear", minFilter: "linear",
      addressModeU: "repeat", addressModeV: "repeat",
    }));
  });

  it("nearest filter and clamp wrap map to nearest sampler with clamp-to-edge", () => {
    backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "nearest", wrap: "clamp" });
    expect(device.createSampler).toHaveBeenCalledWith(expect.objectContaining({
      magFilter: "nearest", minFilter: "nearest",
      addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
    }));
  });

  it("mipmap filter allocates the full mip chain with render-attachment usage and a mipmapFilter sampler", () => {
    backend.createTexture({ type: "2d", width: 8, height: 4, format: "rgba8", filter: "mipmap", wrap: "repeat" });
    const desc = device.createTexture.mock.calls[0][0] as GPUTextureDescriptor;
    expect(desc.mipLevelCount).toBe(4); // floor(log2(8)) + 1
    expect((desc.usage as number) & GPUTextureUsage.RENDER_ATTACHMENT).toBeTruthy();
    expect(device.createSampler).toHaveBeenCalledWith(expect.objectContaining({ mipmapFilter: "linear" }));
  });

  it("uploads rgba8 data verbatim via writeTexture", () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp", data });
    expect(device.queue.writeTexture).toHaveBeenCalledWith(
      { texture: handle!.texture },
      data,
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
  });

  it("expands r8 data to replicated rgba8 on upload", () => {
    backend.createTexture({ type: "2d", width: 2, height: 1, format: "r8", filter: "nearest", wrap: "clamp", data: new Uint8Array([9, 10]) });
    const uploaded = device.queue.writeTexture.mock.calls[0][1] as Uint8Array;
    expect(Array.from(uploaded)).toEqual([9, 9, 9, 255, 10, 10, 10, 255]);
    expect(device.queue.writeTexture.mock.calls[0][2]).toEqual({ bytesPerRow: 8 });
  });

  it("throws for cubemap type", () => {
    expect(() => backend.createTexture({ type: "cubemap", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" }))
      .toThrow(/[Cc]ubemap.*not supported/);
  });

  it("updateTexture writes the subregion with r8 expansion at the mirrored origin (y' = texH - y - h)", () => {
    const handle = backend.createTexture({ type: "2d", width: 4, height: 4, format: "r8", filter: "nearest", wrap: "clamp" })!;
    device.queue.writeTexture.mockClear();
    backend.updateTexture(handle, 0, 1, 4, 1, new Uint8Array([1, 2, 3, 4]));
    // Storage is the vertical mirror of GL storage, so GL row 1 lands at
    // texture row 4 - 1 - 1 = 2.
    expect(device.queue.writeTexture).toHaveBeenCalledWith(
      { texture: handle.texture, origin: { x: 0, y: 2 } },
      expandR8ToRgba8(new Uint8Array([1, 2, 3, 4]), 4, 1),
      { bytesPerRow: 16 },
      { width: 4, height: 1 },
    );
  });

  it("createTexture data uploads with row order reversed (storage mirrors GL vertically)", () => {
    // 1x2 rgba8: row 0 = red-ish, row 1 = green-ish.
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    backend.createTexture({ type: "2d", width: 1, height: 2, format: "rgba8", filter: "linear", wrap: "clamp", data });
    const uploaded = device.queue.writeTexture.mock.calls[0][1] as Uint8Array;
    expect(Array.from(uploaded)).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
  });

  it("keyboard-style data (held row 0, toggled row 2) uploads held LAST and toggled FIRST", () => {
    // ShaderKeyboardInput packs held/pressed/toggled as rows 0/1/2 of a
    // 256x3 r8 texture. Through the prelude's v-flip, sampled row 0 must be
    // held — so the mirrored storage puts held in the last uploaded row.
    const kb = new Uint8Array(256 * 3);
    kb[65] = 255; // held[65], source row 0
    kb[256 * 2 + 67] = 255; // toggled[67], source row 2
    backend.createTexture({ type: "2d", width: 256, height: 3, format: "r8", filter: "nearest", wrap: "clamp", data: kb });
    const uploaded = device.queue.writeTexture.mock.calls[0][1] as Uint8Array;
    // toggled (source row 2) is uploaded row 0; held (source row 0) is uploaded row 2.
    expect(uploaded[(0 * 256 + 67) * 4]).toBe(255);
    expect(uploaded[(2 * 256 + 65) * 4]).toBe(255);
    expect(uploaded[(0 * 256 + 65) * 4]).toBe(0);
    expect(uploaded[(2 * 256 + 67) * 4]).toBe(0);
  });

  it("updateTexture writes rgba8 verbatim when the handle was created with rgba8 format", () => {
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" })!;
    device.queue.writeTexture.mockClear();
    const data = new Uint8Array([5, 6, 7, 8]);
    backend.updateTexture(handle, 0, 0, 1, 1, data);
    expect(device.queue.writeTexture).toHaveBeenCalledWith(
      { texture: handle.texture },
      data,
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
  });

  it("destroyTexture destroys the GPU texture and tolerates null", () => {
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" })!;
    backend.destroyTexture(handle);
    expect((handle.texture as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalled();
    expect(() => backend.destroyTexture(null)).not.toThrow();
  });

  it("sets vflip to false on newly created handles", () => {
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" })!;
    expect(handle.vflip).toBe(false);
  });

  it("createMipmaps builds the downsample chain via render passes", () => {
    const handle = backend.createTexture({ type: "2d", width: 8, height: 4, format: "rgba8", filter: "mipmap", wrap: "repeat", data: new Uint8Array(8 * 4 * 4) })!;
    device.queue.submit.mockClear();
    expect(() => backend.createMipmaps(handle)).not.toThrow();
    expect(device.queue.submit).toHaveBeenCalled();
  });

  it("createTextureFromImage throws for cubemap face arrays", () => {
    expect(() => backend.createTextureFromImage([], { type: "cubemap", format: "rgba8", filter: "linear", wrap: "clamp", vflip: false }))
      .toThrow(/[Cc]ubemap.*not supported/);
  });
});

describe("imageToGrayscaleRgba8", () => {
  it("takes the red channel, replicates it, and can flip rows", () => {
    // 1x2 image: top px r=10, bottom px r=200 (rgba interleaved)
    const pixels = new Uint8ClampedArray([10, 1, 2, 3, 200, 4, 5, 6]);
    expect(Array.from(imageToGrayscaleRgba8(pixels, 1, 2, false)))
      .toEqual([10, 10, 10, 255, 200, 200, 200, 255]);
    expect(Array.from(imageToGrayscaleRgba8(pixels, 1, 2, true)))
      .toEqual([200, 200, 200, 255, 10, 10, 10, 255]);
  });
});

describe("WebGPUTextureBackend.createTextureFromImage", () => {
  let device: ReturnType<typeof mockDevice>;
  let backend: WebGPUTextureBackend;
  let drawImage: ReturnType<typeof vi.fn>;
  let getImageData: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    device = mockDevice();
    backend = new WebGPUTextureBackend(device);
    drawImage = vi.fn();
    getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([50, 0, 0, 255, 90, 0, 0, 255]) }));
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage, getImageData })),
    };
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);
  });

  function fakeImage(w: number, h: number): HTMLImageElement {
    return { naturalWidth: w, naturalHeight: h, width: w, height: h } as HTMLImageElement;
  }

  it("vflip:true stores mirrored rows (flipY:false) so the prelude's v-flip yields GL orientation", () => {
    const handle = backend.createTextureFromImage(fakeImage(2, 1), { type: "2d", format: "rgba8", filter: "linear", wrap: "repeat", vflip: true });
    expect(handle).not.toBeNull();
    expect(drawImage).toHaveBeenCalled();
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      expect.objectContaining({ flipY: false }),
      expect.objectContaining({ texture: handle!.texture }),
      { width: 2, height: 1 },
    );
  });

  it("vflip:false stores flipped rows (flipY:true) — storage is always the vertical mirror of GL's", () => {
    backend.createTextureFromImage(fakeImage(2, 1), { type: "2d", format: "rgba8", filter: "linear", wrap: "repeat", vflip: false });
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      expect.objectContaining({ flipY: true }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("grayscale uploads red-replicated pixels via writeTexture instead of a GPU copy", () => {
    backend.createTextureFromImage(fakeImage(2, 1), { type: "2d", format: "r8", filter: "nearest", wrap: "clamp", vflip: false });
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled();
    const uploaded = device.queue.writeTexture.mock.calls[0][1] as Uint8Array;
    expect(Array.from(uploaded)).toEqual([50, 50, 50, 255, 90, 90, 90, 255]);
  });

  it("grayscale vflip:true composes with the prelude v-flip to reproduce WebGL sampling", () => {
    // 1x2 image: top row r=50, bottom row r=90 (getImageData is top-down).
    // WebGL with vflip:true stores the image flipped (texture row 0 = image
    // bottom = 90), so GL sampling at uv.y=0 returns 90.
    // The prelude helper samples WebGPU storage at v = 1 - uv.y, so WebGPU
    // storage must be the vertical MIRROR of GL's flipped storage — i.e. the
    // image unflipped: row 0 = top (50), row 1 = bottom (90).
    backend.createTextureFromImage(fakeImage(1, 2), { type: "2d", format: "r8", filter: "nearest", wrap: "clamp", vflip: true });
    const uploaded = device.queue.writeTexture.mock.calls[0][1] as Uint8Array;
    expect(Array.from(uploaded)).toEqual([50, 50, 50, 255, 90, 90, 90, 255]);
    // Composition proof: sampling at helper-flipped v (row 1 - row) returns
    // what WebGL returns at uv row (GL flipped storage = [90, 50]).
    const glFlippedStorage = [90, 50];
    for (let row = 0; row < 2; row++) {
      expect(uploaded[(1 - row) * 4]).toBe(glFlippedStorage[row]);
    }
  });

  it("mipmap filter creates the mip chain: one render pass per level above 0", () => {
    backend.createTextureFromImage(fakeImage(8, 8), { type: "2d", format: "rgba8", filter: "mipmap", wrap: "repeat", vflip: true });
    // 8x8 -> 4 levels -> 3 downsample passes
    const encoder = device.createCommandEncoder.mock.results.at(-1)!.value;
    expect(encoder.beginRenderPass).toHaveBeenCalledTimes(3);
    expect(device.queue.submit).toHaveBeenCalled();
  });

  it("throws for cubemap face arrays", () => {
    expect(() => backend.createTextureFromImage([{} as HTMLCanvasElement], { type: "cubemap", format: "rgba8", filter: "linear", wrap: "clamp", vflip: false }))
      .toThrow(/[Cc]ubemap.*not supported/);
  });

  it("throws when the 2d canvas context cannot be created", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
    };
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);
    expect(() => backend.createTextureFromImage(fakeImage(2, 1), { type: "2d", format: "rgba8", filter: "linear", wrap: "repeat", vflip: false }))
      .toThrow(/Failed to create 2d canvas for texture upload/);
  });

  it("updateTextureFromImage re-copies the source with the handle's inverted vflip (vflip:true → flipY:false)", () => {
    const handle = backend.createTextureFromImage(fakeImage(2, 2), { type: "2d", format: "rgba8", filter: "linear", wrap: "repeat", vflip: true })!;
    device.queue.copyExternalImageToTexture.mockClear();
    backend.updateTextureFromImage(handle, fakeImage(2, 2));
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      expect.objectContaining({ flipY: false }),
      expect.objectContaining({ texture: handle.texture }),
      { width: 2, height: 2 },
    );
  });
});
