import { describe, expect, it } from "vitest";
import { SlangPathMap, normalizeInternalPath } from "../canonicalPaths";

describe("normalizeInternalPath", () => {
  it("normalizes separators and relative segments under /workspace", () => {
    expect(normalizeInternalPath("lib\\shared/../palette.slang")).toBe("/workspace/lib/palette.slang");
  });

  it("rejects traversal outside the workspace", () => {
    expect(() => normalizeInternalPath("../../secret.slang")).toThrow("outside the Slang workspace");
    expect(() => normalizeInternalPath("../workspace/secret.slang"))
      .toThrow("outside the Slang workspace");
    expect(() => normalizeInternalPath("/workspace/../workspace/secret.slang"))
      .toThrow("outside the Slang workspace");
  });

  it("rejects absolute paths outside the exact internal root", () => {
    expect(() => normalizeInternalPath("/workspace-other/a.slang"))
      .toThrow("outside the Slang workspace");
  });
});

describe("SlangPathMap", () => {
  it("derives decoded POSIX workspace paths and round-trips URIs", () => {
    const paths = new SlangPathMap("file:///Users/test/My%20Shader");
    const uri = "file:///Users/test/My%20Shader/lib%20code/palette.slang";

    expect(paths.register(uri)).toBe("/workspace/lib code/palette.slang");
    expect(paths.toInternalPath(uri)).toBe("/workspace/lib code/palette.slang");
    expect(paths.toUri("/workspace/lib code/palette.slang")).toBe(uri);
  });

  it("handles Windows file URIs case-insensitively", () => {
    const paths = new SlangPathMap("file:///C:/Work/Shader");

    expect(paths.register("file:///c:/work/shader/lib/math.slang")).toBe("/workspace/lib/math.slang");
  });

  it("accepts an explicit relative path for non-file editor URIs", () => {
    const paths = new SlangPathMap("shader-studio://workspace/root");

    expect(paths.register("shader-studio://models/palette", "lib/palette.slang"))
      .toBe("/workspace/lib/palette.slang");
  });

  it("requires an explicit relative path for non-file editor URIs", () => {
    const paths = new SlangPathMap("shader-studio://workspace/root");

    expect(() => paths.register("shader-studio://models/palette"))
      .toThrow("relative path");
  });

  it("rejects files outside the configured root", () => {
    const paths = new SlangPathMap("file:///Users/test/project");

    expect(() => paths.register("file:///Users/test/other/file.slang"))
      .toThrow("outside the Slang workspace root");
  });

  it("does not confuse a sibling path sharing the root prefix for a child", () => {
    const paths = new SlangPathMap("file:///Users/test/project");

    expect(() => paths.register("file:///Users/test/project-other/file.slang"))
      .toThrow("outside the Slang workspace root");
  });

  it("maps one canonical path to one URI", () => {
    const paths = new SlangPathMap("file:///workspace");
    paths.register("file:///workspace/a.slang");

    expect(() => paths.register("untitled:duplicate", "a.slang"))
      .toThrow("already mapped");
  });
});
