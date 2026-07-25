import { describe, expect, it } from "vitest";
import { createSlangWgslCacheKey, SlangWgslCache } from "../../webgpu/SlangWgslCache";

const request = (languageVersion?: "legacy" | "2025" | "2026" | "latest") => ({
  source: "float4 mainImage(float2 p) { return 1; }",
  sourceUri: "file:///workspace/image.slang",
  sourcePath: "/workspace/image.slang",
  workspace: { rootUri: "file:///workspace/image.slang", files: [
    { path: "/workspace/lib/a.slang", uri: "file:///workspace/lib/a.slang", source: "module a;" },
    { path: "/workspace/image.slang", uri: "file:///workspace/image.slang", source: "float4 mainImage(float2 p) { return 1; }", version: 2 },
  ] },
  options: { passName: "Image", ...(languageVersion ? { languageVersion } : {}) },
});

describe("SlangWgslCache", () => {
  it("stores and retrieves compiled WGSL by key", () => {
    const cache = new SlangWgslCache(2);

    cache.set("pass-a", "wgsl-a");

    expect(cache.get("pass-a")).toBe("wgsl-a");
    expect(cache.get("pass-b")).toBeNull();
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new SlangWgslCache(2);
    cache.set("old", "wgsl-old");
    cache.set("fresh", "wgsl-fresh");

    cache.set("newest", "wgsl-newest");

    expect(cache.get("old")).toBeNull();
    expect(cache.get("fresh")).toBe("wgsl-fresh");
    expect(cache.get("newest")).toBe("wgsl-newest");
  });

  it("touches entries on read so recently used WGSL survives eviction", () => {
    const cache = new SlangWgslCache(2);
    cache.set("old", "wgsl-old");
    cache.set("fresh", "wgsl-fresh");

    expect(cache.get("old")).toBe("wgsl-old");
    cache.set("newest", "wgsl-newest");

    expect(cache.get("old")).toBe("wgsl-old");
    expect(cache.get("fresh")).toBeNull();
  });

  it("clears every entry", () => {
    const cache = new SlangWgslCache(2);
    cache.set("pass-a", "wgsl-a");
    cache.set("pass-b", "wgsl-b");

    cache.clear();

    expect(cache.get("pass-a")).toBeNull();
    expect(cache.get("pass-b")).toBeNull();
  });

  it("keys complete workspace requests deterministically without mutating them", () => {
    const first = request("2026");
    const reordered = { ...request("2026"), workspace: { ...request("2026").workspace, files: [...request("2026").workspace.files].reverse() } };
    const before = structuredClone(first);
    expect(createSlangWgslCacheKey(first)).toBe(createSlangWgslCacheKey(reordered));
    expect(first).toEqual(before);
  });

  it("distinguishes language versions and every dependency identity field", () => {
    expect(new Set([undefined, "legacy", "2025", "2026", "latest"].map((version) => createSlangWgslCacheKey(request(version as any)))).size).toBe(5);
    const base = request("2026");
    const edited = structuredClone(base);
    edited.workspace.files[0].source = "module changed;";
    expect(createSlangWgslCacheKey(edited)).not.toBe(createSlangWgslCacheKey(base));
  });

  it("uses length framing so delimiter-like content cannot collide", () => {
    const a = request("2026");
    const b = request("2026");
    a.source = "a|b";
    b.source = "a";
    b.options.passName = "b";
    expect(createSlangWgslCacheKey(a)).not.toBe(createSlangWgslCacheKey(b));
  });
});
