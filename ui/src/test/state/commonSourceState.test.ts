import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCommonShaderSource,
  getCommonShaderSource,
  setCommonShaderSource,
} from "../../lib/state/commonSourceState.svelte";

describe("commonSourceState", () => {
  beforeEach(() => {
    clearCommonShaderSource();
  });

  it("starts with no common source", () => {
    expect(getCommonShaderSource()).toBeNull();
  });

  it("publishes the common file and versions it", () => {
    setCommonShaderSource({ path: "/shader/common.glsl", text: "#define PI 3.14159\n" });

    const published = getCommonShaderSource();
    expect(published?.path).toBe("/shader/common.glsl");
    expect(published?.text).toBe("#define PI 3.14159\n");
    expect(published?.version).toBeGreaterThan(0);
  });

  it("raises the version on every edit so the language service never sees a stale revision", () => {
    setCommonShaderSource({ path: "/shader/common.glsl", text: "#define PI 3.14159\n" });
    const first = getCommonShaderSource()?.version ?? 0;
    setCommonShaderSource({ path: "/shader/common.glsl", text: "#define PI 3.14159\n#define TAU 6.28\n" });
    const second = getCommonShaderSource()?.version ?? 0;

    expect(second).toBeGreaterThan(first);
  });

  it("keeps the version steady when the same text is republished", () => {
    setCommonShaderSource({ path: "/shader/common.glsl", text: "#define PI 3.14159\n" });
    const first = getCommonShaderSource();
    setCommonShaderSource({ path: "/shader/common.glsl", text: "#define PI 3.14159\n" });

    expect(getCommonShaderSource()).toEqual(first);
  });

  it("versions a switch to a different common file", () => {
    setCommonShaderSource({ path: "/shader/common.glsl", text: "#define PI 3.14159\n" });
    const first = getCommonShaderSource()?.version ?? 0;
    setCommonShaderSource({ path: "/other/common.glsl", text: "#define PI 3.14159\n" });

    expect(getCommonShaderSource()?.path).toBe("/other/common.glsl");
    expect(getCommonShaderSource()?.version).toBeGreaterThan(first);
  });

  it("drops the source when a shader without a common file loads", () => {
    setCommonShaderSource({ path: "/shader/common.glsl", text: "#define PI 3.14159\n" });
    setCommonShaderSource(null);

    expect(getCommonShaderSource()).toBeNull();
  });
});
