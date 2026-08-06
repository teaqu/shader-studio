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

  it("uses decoded POSIX file paths for root containment", () => {
    const paths = new SlangPathMap("file:///tmp/%72oot");

    expect(paths.register("file:///tmp/root/a.slang")).toBe("/workspace/a.slang");
  });

  it("requires matching case-insensitive file URI authorities", () => {
    const paths = new SlangPathMap("file://Server-A/share/project");

    expect(paths.register("file://server-a/share/project/a.slang")).toBe("/workspace/a.slang");
    expect(() => paths.register("file://server-b/share/project/b.slang"))
      .toThrow("outside the Slang workspace root");
  });

  it("treats localhost and an empty file URI authority as equivalent", () => {
    const localRoot = new SlangPathMap("file://localhost/tmp/project");
    const emptyRoot = new SlangPathMap("file:///tmp/project");

    expect(localRoot.register("file:///tmp/project/a.slang")).toBe("/workspace/a.slang");
    expect(emptyRoot.register("file://LOCALHOST/tmp/project/a.slang")).toBe("/workspace/a.slang");
  });

  it("uses decoded path separators for file-root containment", () => {
    const paths = new SlangPathMap("file:///tmp/a%2Fb");

    expect(paths.register("file:///tmp/a/b/a.slang")).toBe("/workspace/a.slang");
  });

  it("handles Windows file URIs case-insensitively", () => {
    const paths = new SlangPathMap("file:///C:/Work/Shader");

    expect(paths.register("file:///c:/work/shader/lib/math.slang")).toBe("/workspace/lib/math.slang");
  });

  it("uses decoded Windows file paths for case-insensitive root containment", () => {
    const paths = new SlangPathMap("file:///C:/W%6Frk");

    expect(paths.register("file:///c:/work/a.slang")).toBe("/workspace/a.slang");
  });

  it("handles Windows drive-root file URIs case-insensitively", () => {
    const paths = new SlangPathMap("file:///C:/");

    expect(paths.register("file:///c:/lib/math.slang")).toBe("/workspace/lib/math.slang");
  });

  it("decodes each file URI pathname exactly once without colliding with nested paths", () => {
    const paths = new SlangPathMap("file:///tmp/root");
    const literalPercentUri = "file:///tmp/root/a%252Fb.slang";

    expect(paths.register(literalPercentUri)).toBe("/workspace/a%2Fb.slang");
    expect(paths.register("file:///tmp/root/a/b.slang")).toBe("/workspace/a/b.slang");
    expect(paths.toUri("/workspace/a%2Fb.slang")).toBe(literalPercentUri);
  });

  it("rejects invalid percent encoding in a file URI", () => {
    const paths = new SlangPathMap("file:///tmp/root");

    expect(() => paths.register("file:///tmp/root/a%ZZ.slang"))
      .toThrow("invalid percent encoding");
  });

  it("accepts an explicit relative path for non-file editor URIs", () => {
    const paths = new SlangPathMap("shader-studio://workspace/root");

    expect(paths.register("shader-studio://models/palette", "lib/palette.slang"))
      .toBe("/workspace/lib/palette.slang");
  });

  it("treats percent escapes in explicit relative paths as literal path text", () => {
    const paths = new SlangPathMap("shader-studio://workspace/root");

    expect(paths.register("shader-studio://models/literal", "lib/a%2Fb.slang"))
      .toBe("/workspace/lib/a%2Fb.slang");
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
