import { describe, expect, it } from "vitest";
import { callAt, consumeCompilerTargets, consumeList, contextualFiles, convertDiagnostic, moduleName, parseCompilerDiagnostics, resolveCompilerDependencies, sourcePath, userRange } from "../SlangLanguageServiceSupport.js";

describe("Slang language-service support", () => {
  it("keeps unresolved and cyclic imports safe while inlining available dependencies", () => {
    const files = [
      { uri: "file:///shared.slang", text: "#include \"nested.slang\"\nfloat shared;", version: 1 },
      { uri: "file:///nested.slang", text: "#include \"shared.slang\"\nfloat nested;", version: 1 },
    ];
    const resolved = resolveCompilerDependencies('#include "shared.slang"\n#include "missing.slang"', "file:///image.slang", files);
    expect(resolved).toContain("float shared;");
    expect(resolved).toContain("float nested;");
    expect(resolved).toContain('#include "missing.slang"');
  });

  it("maps paths, ranges, diagnostics, and calls only when they belong to authored source", () => {
    expect(sourcePath("not a uri")).toBe("/not a uri");
    expect(moduleName("float x;", "file:///a-file.slang")).toBe("a_file");
    expect(userRange({ start: { line: 0, character: 4 }, end: { line: 1, character: 0 } }, 1, "one\ntwo")).toBeUndefined();
    expect(parseCompilerDiagnostics("error[E1]: bad\n --> /image.slang:2:2\n  |\n  | ^^^ detail", "/image.slang", 1, "line")).toEqual([expect.objectContaining({ code: "E1", message: "detail" })]);
    expect(parseCompilerDiagnostics("error: other\n --> /other.slang:1:1", "/image.slang", 0, "line")).toEqual([]);
    expect(callAt("f(a, nested(1, 2),", { line: 0, character: 18 })).toEqual({ name: "f", parameter: 2 });
    expect(callAt("if (condition)", { line: 0, character: 13 })).toBeUndefined();
  });

  it("consumes optional native lists safely and discards generated diagnostic ranges", () => {
    const released = { value: false };
    expect(consumeList(undefined, value => value)).toEqual([]);
    expect(consumeList({ size: () => 2, get: index => index === 0 ? "value" : undefined, delete: () => {
      released.value = true;
    } }, value => value.toUpperCase())).toEqual(["VALUE"]);
    expect(released.value).toBe(true);
    expect(consumeCompilerTargets({ size: () => 1, get: () => ({ name: "wgsl", value: 1 }) })).toEqual([{ name: "wgsl", value: 1 }]);
    expect(convertDiagnostic({ code: "generated", severity: 1, message: "bad", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }, 1, "line")).toBeUndefined();
    expect(contextualFiles({ documentUri: "file:///image.slang", languageId: "slang", generation: 1, passName: "Image", stage: "fragment", customUniforms: [], resources: [], virtualFiles: [] })).toEqual([]);
  });
});
