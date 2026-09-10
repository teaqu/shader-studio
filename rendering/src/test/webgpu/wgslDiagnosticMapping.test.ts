import { describe, expect, it } from "vitest";
import { wrapWgslComputeSource } from "../../webgpu/WgslPrelude";

import {
  formatWgslDiagnostic,
  remapWgslDiagnosticLine,
} from "../../webgpu/SlangPassPipeline";

describe("remapWgslDiagnosticLine", () => {
  it("maps a user-source error to the correct 1-based user line", () => {
    // 80 prelude lines: assembled line 83 is user line 3.
    expect(remapWgslDiagnosticLine(83, 80, 10)).toEqual({ line: 3, internal: false });
  });

  it("maps user line 1 exactly", () => {
    expect(remapWgslDiagnosticLine(81, 80, 10)).toEqual({ line: 1, internal: false });
  });

  it("marks a prelude error internal and keeps the original line", () => {
    expect(remapWgslDiagnosticLine(12, 80, 10)).toEqual({ line: 12, internal: true });
  });

  it("marks an error on the last prelude line internal", () => {
    expect(remapWgslDiagnosticLine(80, 80, 10)).toEqual({ line: 80, internal: true });
  });

  it("clamps an entry-point error to the last user line and marks it internal", () => {
    // 10 user lines after an 80-line prelude: assembled line 95 is generated.
    expect(remapWgslDiagnosticLine(95, 80, 10)).toEqual({ line: 90, internal: true });
  });

  it("treats offset 0 as a no-op", () => {
    expect(remapWgslDiagnosticLine(5, 0, 10)).toEqual({ line: 5, internal: false });
  });

  it("passes the line through untouched when there is no offset", () => {
    expect(remapWgslDiagnosticLine(84, undefined, 10)).toEqual({ line: 84, internal: false });
    expect(remapWgslDiagnosticLine(84, undefined)).toEqual({ line: 84, internal: false });
  });

  it("still remaps without a user line count, without clamping", () => {
    expect(remapWgslDiagnosticLine(83, 80)).toEqual({ line: 3, internal: false });
    expect(remapWgslDiagnosticLine(12, 80)).toEqual({ line: 12, internal: true });
  });
});

describe("formatWgslDiagnostic", () => {
  it("formats a user error without a marker", () => {
    expect(formatWgslDiagnostic("image", 83, 7, "unknown identifier", 80, 10)).toBe(
      "image: WGSL L3:7 unknown identifier",
    );
  });

  it("prefixes generated-code errors with internal:", () => {
    expect(formatWgslDiagnostic("image", 12, 7, "prelude broke", 80, 10)).toBe(
      "image: WGSL internal: L12:7 prelude broke",
    );
    expect(formatWgslDiagnostic("image", 95, 2, "entry broke", 80, 10)).toBe(
      "image: WGSL internal: L90:2 entry broke",
    );
  });

  it("leaves linePos untouched", () => {
    expect(formatWgslDiagnostic("buffer-a", 83, 21, "nope", 80, 10)).toBe(
      "buffer-a: WGSL L3:21 nope",
    );
  });
});


describe("wrapped compute source diagnostics", () => {
  it("preserves source lines after initialization in every entry point", () => {
    const source = [
      "@compute @workgroup_size(1)",
      "fn first() {",
      "  let firstError = unknownA;",
      "}",
      "@compute @workgroup_size(1)",
      "fn second() {",
      "  let secondError = unknownB;",
      "}",
    ].join("\n");
    const wrapped = wrapWgslComputeSource(source, { workgroupSize: [1, 1, 1], outputLayers: 1, hasOutput: false });
    for (const [token, expectedLine] of [["firstError", 3], ["secondError", 7]] as const) {
      const line = wrapped.source.split("\n").findIndex((text) => text.includes(token)) + 1;
      expect(remapWgslDiagnosticLine(line, wrapped.preludeLineCount, wrapped.userLineCount)).toEqual({ line: expectedLine, internal: false });
    }
    expect(wrapped.userLineCount).toBe(source.split("\n").length);
  });
});
