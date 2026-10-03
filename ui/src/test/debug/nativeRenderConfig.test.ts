// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { hookConfigForDebugPlan, nativeFragmentEntryPoint } from "../../lib/nativeRenderConfig";

describe("native debug render configuration", () => {
  const source = "@fragment fn image() -> @location(0) vec4f { return vec4f(1); }";
  it("distinguishes hooks, sole discovery, explicit selection and ambiguity", () => {
    expect(nativeFragmentEntryPoint(source, {}, "wgsl")).toBeUndefined();
    expect(nativeFragmentEntryPoint(source, { entryPoints: {} }, "wgsl")).toBe("image");
    expect(nativeFragmentEntryPoint(source, { entryPoints: { fragment: "selected" } }, "wgsl")).toBe("selected");
    expect(nativeFragmentEntryPoint(source + " @fragment fn other() {}", { entryPoints: {} }, "wgsl")).toBeNull();
    expect(nativeFragmentEntryPoint(source, { entryPoints: null } as unknown as ShaderConfig["passes"][string], "wgsl")).toBeNull();
  });
  it("remaps only Image without mutating the saved native project", () => {
    const config: ShaderConfig = { version: "1.0", passes: { Image: { entryPoints: { fragment: "image" } }, BufferA: { path: "shared.wgsl", entryPoints: { fragment: "buffer" } } } };
    const result = hookConfigForDebugPlan(config)!;
    expect(result.passes.Image.entryPoints).toBeUndefined();
    expect(result.passes.Image.vertex).toBeUndefined();
    expect(result.passes.Image.geometry).toEqual({ type: "fullscreen" });
    expect(result.passes.BufferA).toBe(config.passes.BufferA);
    expect(config.passes.Image.entryPoints?.fragment).toBe("image");
    expect(hookConfigForDebugPlan(null)).toBeNull();
  });
});

describe("temporary Image config for an active render Buffer", () => {
  it("transfers native stages and render execution settings even without Buffer inputs", async () => {
    const { imageConfigForActiveRenderPass } = await import("../../lib/nativeRenderConfig");
    const config: ShaderConfig = {
      version: "1.0",
      passes: {
        Image: { inputs: { iChannel0: { type: "texture", path: "image.png" } }, resolution: { scale: 0.5 }, entryPoints: { vertex: "imageVertex", fragment: "imageFragment" }, vertex: "image-hook.wgsl", geometry: { type: "sphere" } },
        BufferA: { path: "buffer.wgsl", entryPoints: { vertex: "bufferVertex", fragment: "bufferFragment" }, vertex: "buffer-hook.wgsl", geometry: { type: "plane" } },
      },
    };

    const remapped = imageConfigForActiveRenderPass(config, "BufferA")!;

    expect(remapped.passes.Image).toEqual({
      resolution: { scale: 0.5 },
      entryPoints: { vertex: "bufferVertex", fragment: "bufferFragment" },
      vertex: "buffer-hook.wgsl",
      geometry: { type: "plane" },
    });
    expect(remapped.passes.BufferA).toBe(config.passes.BufferA);
    expect(config.passes.Image.entryPoints?.fragment).toBe("imageFragment");
  });

  it("clears a native Image selection when the active Buffer uses hooks", async () => {
    const { imageConfigForActiveRenderPass } = await import("../../lib/nativeRenderConfig");
    const config: ShaderConfig = {
      version: "1.0",
      passes: {
        Image: { entryPoints: { fragment: "imageFragment" }, vertex: "image-hook.wgsl" },
        BufferA: { path: "buffer.wgsl" },
      },
    };

    expect(imageConfigForActiveRenderPass(config, "BufferA")!.passes.Image).toEqual({});
  });
});
