import { describe, expect, it } from "vitest";
import { createSlangWgslCacheKey, SlangWgslCache } from "../../webgpu/SlangWgslCache";
import type { SlangCompileRequest } from "../../webgpu/SlangCompiler";

describe("SlangWgslCache", () => {
  it("hashes a deterministically sorted workspace including dependency paths, source, and options", () => {
    const base: SlangCompileRequest = {
      source: "root",
      sourceUri: "file:///project/image.slang",
      sourcePath: "/workspace/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/b.slang", path: "/workspace/b.slang", source: "b" },
          { uri: "file:///project/a.slang", path: "/workspace/a.slang", source: "a" },
        ],
      },
      options: { passName: "Image" },
    };
    const reversed = { ...base, workspace: { ...base.workspace, files: [...base.workspace.files].reverse() } };
    const sourceChanged = { ...base, workspace: { ...base.workspace, files: base.workspace.files.map((file) => file.path.endsWith("a.slang") ? { ...file, source: "changed" } : file) } };
    const pathChanged = { ...base, workspace: { ...base.workspace, files: base.workspace.files.map((file) => file.path.endsWith("a.slang") ? { ...file, path: "/workspace/lib/a.slang" } : file) } };
    const optionsChanged = { ...base, options: { passName: "BufferA" } };

    expect(createSlangWgslCacheKey(reversed)).toBe(createSlangWgslCacheKey(base));
    expect(createSlangWgslCacheKey(sourceChanged)).not.toBe(createSlangWgslCacheKey(base));
    expect(createSlangWgslCacheKey(pathChanged)).not.toBe(createSlangWgslCacheKey(base));
    expect(createSlangWgslCacheKey(optionsChanged)).not.toBe(createSlangWgslCacheKey(base));
  });
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
});
