import { describe, expect, it } from "vitest";
import { SlangWgslCache } from "../../webgpu/SlangWgslCache";

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
});
