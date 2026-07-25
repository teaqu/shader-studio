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

  it("is a 64-bit key and changes for every compile input", () => {
    const baseline = request("2026");
    const key = createSlangWgslCacheKey(baseline);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    const mutations: Array<(value: any) => void> = [
      (v) => {
        v.sourceUri = "file:///other.slang";
      },
      (v) => {
        v.sourcePath = "/workspace/other.slang";
      },
      (v) => {
        v.workspace.rootUri = "file:///workspace/root.slang";
      },
      (v) => {
        v.source = "changed";
      },
      (v) => {
        v.workspace.files[0].path = "/workspace/lib/b.slang";
      },
      (v) => {
        v.workspace.files[0].uri = "file:///workspace/lib/b.slang";
      },
      (v) => {
        v.workspace.files[0].source = "changed";
      },
      (v) => {
        delete v.workspace.files[1].version;
      },
      (v) => {
        v.workspace.files[1].version = 0;
      },
      (v) => {
        v.workspace.files[1].version = 9;
      },
      (v) => {
        v.options.passName = "BufferA";
      },
      (v) => {
        v.options.commonCode = "float f();";
      },
      (v) => {
        v.options.channels = [{ slot: 0, key: "iChannel0", kind: "texture" }];
      },
      (v) => {
        v.options.customUniforms = [{ name: "gain", type: "float" }];
      },
      (v) => {
        v.options.captureMode = true;
      },
      (v) => {
        v.options.languageVersion = "latest";
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(createSlangWgslCacheKey(changed)).not.toBe(key);
    }
  });

  it("handles object key order, Unicode, NUL and newlines without mutation", () => {
    const first: any = request("legacy");
    first.source = "é\0\n|";
    first.options = { passName: "Image", commonCode: "x\ny", languageVersion: "legacy" };
    const same: any = structuredClone(first);
    same.options = { languageVersion: "legacy", commonCode: "x\ny", passName: "Image" };
    const before = structuredClone(first);
    expect(createSlangWgslCacheKey(first)).toBe(createSlangWgslCacheKey(same));
    expect(first).toEqual(before);
  });
});
