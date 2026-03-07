import { describe, expect, it, vi } from "vitest";
import { CubemapBufferManager } from "../CubemapBufferManager";

describe("CubemapBufferManager", () => {
  function createMockRenderer() {
    return {
      TEXTYPE: { CUBEMAP: 1 },
      TEXFMT: { C4F16: 10, C4I8: 11 },
      FILTER: { LINEAR: 2 },
      TEXWRP: { CLAMP: 3 },
      CreateTexture: vi.fn(),
      CreateRenderTargetCubeMap: vi.fn(),
      DestroyTexture: vi.fn(),
      DestroyRenderTarget: vi.fn(),
    } as any;
  }

  it("falls back to C4I8 when C4F16 cubemap creation fails", () => {
    const renderer = createMockRenderer();
    const texA = { id: "a" };
    const texB = { id: "b" };
    const targetA = { id: "ta" };
    const targetB = { id: "tb" };

    renderer.CreateTexture
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(texA)
      .mockReturnValueOnce(texB);
    renderer.CreateRenderTargetCubeMap
      .mockReturnValueOnce(targetA)
      .mockReturnValueOnce(targetB);

    const manager = new CubemapBufferManager(renderer);
    const buffer = manager.createCubemapBuffer();

    expect(buffer.texture).toEqual([texA, texB]);
    expect(buffer.target).toEqual([targetA, targetB]);
    expect(renderer.CreateTexture).toHaveBeenCalledTimes(4);
    expect(renderer.CreateTexture).toHaveBeenNthCalledWith(
      1,
      renderer.TEXTYPE.CUBEMAP,
      1024,
      1024,
      renderer.TEXFMT.C4F16,
      renderer.FILTER.LINEAR,
      renderer.TEXWRP.CLAMP,
    );
    expect(renderer.CreateTexture).toHaveBeenNthCalledWith(
      3,
      renderer.TEXTYPE.CUBEMAP,
      1024,
      1024,
      renderer.TEXFMT.C4I8,
      renderer.FILTER.LINEAR,
      renderer.TEXWRP.CLAMP,
    );
  });

  it("cleans up textures and render targets when render-target creation fails", () => {
    const renderer = createMockRenderer();
    const texA = { id: "a" };
    const texB = { id: "b" };
    const targetA = { id: "ta" };

    renderer.CreateTexture
      .mockReturnValueOnce(texA)
      .mockReturnValueOnce(texB)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);
    renderer.CreateRenderTargetCubeMap
      .mockReturnValueOnce(targetA)
      .mockReturnValueOnce(null);

    const manager = new CubemapBufferManager(renderer);
    expect(() => manager.createCubemapBuffer()).toThrow("Failed to create cubemap textures");

    expect(renderer.DestroyRenderTarget).toHaveBeenCalledWith(targetA);
    expect(renderer.DestroyTexture).toHaveBeenCalledWith(texA);
    expect(renderer.DestroyTexture).toHaveBeenCalledWith(texB);
  });

  it("falls back to lower resolution when 1024 cubemap allocation fails", () => {
    const renderer = createMockRenderer();
    const texA = { id: "a" };
    const texB = { id: "b" };
    const targetA = { id: "ta" };
    const targetB = { id: "tb" };

    renderer.CreateTexture
      // 1024, C4F16
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      // 1024, C4I8
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      // 512, C4F16
      .mockReturnValueOnce(texA)
      .mockReturnValueOnce(texB);
    renderer.CreateRenderTargetCubeMap
      .mockReturnValueOnce(targetA)
      .mockReturnValueOnce(targetB);

    const manager = new CubemapBufferManager(renderer);
    const buffer = manager.createCubemapBuffer();

    expect(buffer.texture).toEqual([texA, texB]);
    expect(buffer.target).toEqual([targetA, targetB]);
    expect(manager.getResolution()).toBe(512);
    expect(renderer.CreateTexture).toHaveBeenNthCalledWith(
      5,
      renderer.TEXTYPE.CUBEMAP,
      512,
      512,
      renderer.TEXFMT.C4F16,
      renderer.FILTER.LINEAR,
      renderer.TEXWRP.CLAMP,
    );
  });

  it("creates a fallback cubemap texture when renderable cubemap creation fails", () => {
    const renderer = createMockRenderer();
    const fallbackTex = { id: "fallback", mType: renderer.TEXTYPE.CUBEMAP };
    renderer.CreateTexture.mockImplementation((_type: number, xres: number) => {
      return xres === 1 ? fallbackTex : null;
    });

    const manager = new CubemapBufferManager(renderer);
    expect(() => manager.createCubemapBuffer()).toThrow("Failed to create cubemap textures");
    expect(manager.getCubemapTexture()).toBe(fallbackTex);
  });
});
