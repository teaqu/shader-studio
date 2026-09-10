import type { Position, WorkspaceEdit } from "vscode-languageserver-protocol";
import { describe, expect, it } from "vitest";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { renameSlangSymbol, type SlangRenameDocument } from "../rename";

const uri = "file:///image.slang";

function environment(documentUri = uri, commonFile?: { uri: string; text: string }): ShaderAuthoringEnvironment {
  return {
    documentUri,
    languageId: "slang",
    generation: 1,
    passName: "Image",
    stage: "fragment",
    customUniforms: [],
    resources: [],
    virtualFiles: [],
    ...(commonFile ? { commonFile: { ...commonFile, version: 1 } } : {}),
  };
}

function document(text: string, documentUri = uri, commonFile?: { uri: string; text: string }): SlangRenameDocument {
  return { uri: documentUri, text, environment: environment(documentUri, commonFile) };
}

function position(text: string, token: string, occurrence = 0): Position {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = text.indexOf(token, offset + 1);
  }
  if (offset < 0) {
    throw new Error(`Missing ${token}`);
  }
  const before = text.slice(0, offset + token.length);
  const lines = before.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}

function apply(text: string, edit: WorkspaceEdit | null, documentUri = uri): string {
  const changes = edit?.changes?.[documentUri];
  expect(changes).toBeDefined();
  const offset = (at: Position) => text.split("\n").slice(0, at.line).reduce((sum, line) => sum + line.length + 1, 0) + at.character;
  return [...changes!].sort((left, right) => offset(right.range.start) - offset(left.range.start)).reduce(
    (result, change) => result.slice(0, offset(change.range.start)) + change.newText + result.slice(offset(change.range.end)), text,
  );
}

describe("renameSlangSymbol", () => {
  it("maps scalar, vector, matrix, and nested field bindings back to authored offsets", () => {
    const source = `struct Inner { uint4 lanes; };
struct Outer { float3x2 basis; Inner inner; };
float4 helper(Outer item, int3 count) { return float4(item.inner.lanes.xyz, count); }
float4 mainImage(float2 p) { Outer item; return helper(item, int3(1)); }`;
    const edit = renameSlangSymbol([document(source)], uri, position(source, "lanes", 1), "channels");
    expect(apply(source, edit)).toBe(source.replace("uint4 lanes", "uint4 channels").replace("inner.lanes", "inner.channels"));
  });

  it("renames a prototype, definition, and forward call without changing another overload", () => {
    const source = `float tone(float value);
float2 tone(float2 value) { return value; }
float4 mainImage(float2 p) { return float4(tone(p.x)); }
float tone(float value) { return value; }`;
    const edit = renameSlangSymbol([document(source)], uri, position(source, "tone"), "curve");
    expect(apply(source, edit)).toBe(`float curve(float value);
float2 tone(float2 value) { return value; }
float4 mainImage(float2 p) { return float4(curve(p.x)); }
float curve(float value) { return value; }`);
  });

  it("rejects unsupported Slang syntax instead of making a partial rename", () => {
    const unsupported = [
      "#define TONE tone\nfloat tone(float x) { return x; }",
      "import palette;\nfloat tone(float x) { return x; }",
      "vector<float, 3> tone(vector<float, 3> x) { return x; }",
      "[BackwardDerivative(toneDerivative)] float tone(float x) { return x; }",
    ];
    for (const source of unsupported) {
      expect(renameSlangSymbol([document(source)], uri, position(source, "tone"), "curve")).toBeNull();
    }
  });

  it("binds a unique generic helper call without guessing overloaded names", () => {
    const source = "generic<T> T tone(T value) { return value; }\nfloat helper() { return tone<float>(1.0); }";
    expect(apply(source, renameSlangSymbol([document(source)], uri, position(source, "tone"), "curve"))).toBe(source.replaceAll("tone", "curve"));
    const ambiguous = `${source}\nfloat tone(float value) { return value; }`;
    expect(renameSlangSymbol([document(ambiguous)], uri, position(ambiguous, "tone"), "curve")).toBeNull();
  });



  it("rejects a Common rename captured by a local in any affected pass", () => {
    const commonUri = "file:///common.slang";
    const common = "float tone(float value) { return value; }";
    const first = "float4 mainImage(float2 p) { return float4(tone(p.x)); }";
    const secondUri = "file:///buffer.slang";
    const second = "float4 mainImage(float2 p) { float curve = p.x; return float4(tone(curve)); }";
    const commonFile = { uri: commonUri, text: common };
    expect(renameSlangSymbol([
      document(first, uri, commonFile),
      document(second, secondUri, commonFile),
      document(common, commonUri),
    ], commonUri, position(common, "tone"), "curve")).toBeNull();
  });

  it("ignores an unrelated invalid open document", () => {
    const source = "float tone(float value) { return value; }";
    const invalid = document("[shader(\"fragment\")] broken", "file:///unrelated.slang");
    const edit = renameSlangSymbol([document(source), invalid], uri, position(source, "tone"), "curve");
    expect(apply(source, edit)).toBe("float curve(float value) { return value; }");
  });

  it("does not edit comments and declines source strings it cannot analyze", () => {
    const comment = "float tone(float value) { return value; } // tone stays text";
    expect(apply(comment, renameSlangSymbol([document(comment)], uri, position(comment, "tone"), "curve")))
      .toBe("float curve(float value) { return value; } // tone stays text");
    const string = "float tone(float value) { return value; } // \"tone\"";
    // A quote inside a comment remains non-code and must not be an edit target.
    expect(apply(string, renameSlangSymbol([document(string)], uri, position(string, "tone"), "curve")))
      .toBe("float curve(float value) { return value; } // \"tone\"");
  });
});
