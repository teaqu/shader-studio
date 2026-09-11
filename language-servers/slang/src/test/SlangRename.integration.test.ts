import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Position, WorkspaceEdit } from "vscode-languageserver-protocol";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import createSlangModule from "../../../../ui/src/slang/slang-wasm.js";
import { SlangLanguageService } from "../SlangLanguageService";
import type { SlangLanguageServerModule } from "../slangLanguageServerTypes";

const uri = "file:///rename.slang";
const revision = { uri, languageId: "slang" as const, version: 1, environmentGeneration: 1 };
const environment: ShaderAuthoringEnvironment = {
  documentUri: uri, languageId: "slang", generation: 1, passName: "Image", stage: "fragment",
  customUniforms: [], resources: [], virtualFiles: [],
};
function position(source: string, needle: string, occurrence = 0, atEnd = false): Position {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = source.indexOf(needle, offset + 1);
  }
  if (offset < 0) {
    throw new Error(`Missing test token ${needle}`);
  }
  const prefix = source.slice(0, offset + (atEnd ? needle.length : 1));
  const lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}
function apply(source: string, result: WorkspaceEdit | null, documentUri = uri): string {
  expect(result?.changes?.[documentUri], "expected authored rename edits").toBeDefined();
  const offset = (p: Position) => source.split("\n").slice(0, p.line).reduce((sum, line) => sum + line.length + 1, 0) + p.character;
  return [...result!.changes![documentUri]].sort((a, b) => offset(b.range.start) - offset(a.range.start))
    .reduce((text, edit) => text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end)), source);
}

describe("Slang rename with the bundled compiler", () => {
  let module: SlangLanguageServerModule;
  let service: SlangLanguageService;
  beforeAll(async () => {
    module = await createSlangModule({ wasmBinary: readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url)) });
  }, 20_000);
  afterEach(async () => {
    await service?.dispose();
  });
  async function open(source: string, env = environment) {
    service = new SlangLanguageService(module);
    await service.syncEnvironment(env);
    await service.openDocument({ uri: env.documentUri, languageId: "slang", version: 1, text: source });
  }

  it.each([0, 1])("renames a helper from its declaration or call end (%i)", async occurrence => {
    const source = "float tone(float value) { return value * 0.5; }\nfloat4 mainImage(float2 p) { return float4(tone(p.x)); }";
    await open(source);
    expect((await service.initialize()).rename).toBe(true);
    const edit = await service.rename({ document: revision, position: position(source, "tone", occurrence, true), newName: "curve" });
    expect(apply(source, edit)).toBe(source.replaceAll("tone", "curve"));
  });

  it("renames a specialized generic helper by unique declaration identity", async () => {
    // `__generic` is the spelling the bundled compiler accepts; covered with
    // the host-shape suite in SlangRenameHostShape.integration.test.ts, which
    // owns a fresh compiler module instance (this file's shared module
    // starves when more compiler-heavy tests precede it).
    const source = "__generic<T> T tone(T value) { return value; }\nfloat4 mainImage(float2 p) { return float4(tone<float>(p.x)); }";
    await open(source);
    const edit = await service.rename({ document: revision, position: position(source, "tone", 1, true), newName: "curve" });
    expect(apply(source, edit)).toBe(source.replaceAll("tone", "curve"));
  });

  it("keeps shadowed locals, members and comments separate", async () => {
    const source = `struct Data { float value; };
float helper(float value) {
  float result = value;
  { float value = 3.0; result += value; }
  Data data; data.value = 2.0;
  // value remains a comment
  return result + value + data.value;
}`;
    await open(source);
    const edit = await service.rename({ document: revision, position: position(source, "value", 1, true), newName: "inputValue" });
    expect(apply(source, edit)).toBe(source.replace("helper(float value)", "helper(float inputValue)")
      .replace("result = value", "result = inputValue").replace("result + value", "result + inputValue"));
  });

  it("renames a field without changing same-named fields on other types", async () => {
    const source = "struct A { float value; };\nstruct B { float value; };\nfloat helper(A a, B b) { return a.value + b.value; }";
    await open(source);
    const edit = await service.rename({ document: revision, position: position(source, "value", 2, true), newName: "strength" });
    expect(apply(source, edit)).toBe(source.replace("struct A { float value;", "struct A { float strength;").replace("a.value", "a.strength"));
  });

  it("renames a scalar named x without treating vector swizzles as references", async () => {
    const source = 'float helper(float x, float2 p) { return x + p.x; }';
    await open(source);
    const edit = await service.rename({ document: revision, position: position(source, "x"), newName: "value" });
    expect(apply(source, edit)).toBe('float helper(float value, float2 p) { return value + p.x; }');
  });

  it("renames a static constant and keeps its declaration qualifiers", async () => {
    const source = 'static const float speed = 2.0;\nfloat helper(float x) { return x * speed; }';
    await open(source);
    const edit = await service.rename({ document: revision, position: position(source, "speed"), newName: "rate" });
    expect(apply(source, edit)).toBe(source.replaceAll("speed", "rate"));
  });

  it("renames the selected overload and its calls only", async () => {
    const source = "float tone(float x) { return x; }\nfloat2 tone(float2 x) { return x; }\nfloat3 helper() { return float3(tone(1.0), tone(float2(2.0))); }";
    await open(source);
    const edit = await service.rename({ document: revision, position: position(source, "tone", 2, true), newName: "scalarTone" });
    expect(apply(source, edit)).toBe(source.replace("float tone", "float scalarTone").replace("tone(1.0)", "scalarTone(1.0)"));
  });

  it("renames a compute parameter without changing its stage attributes or system semantic", async () => {
    const source = '[shader("compute")]\n[numthreads(8, 1, 1)]\nvoid mainCompute(uint3 dispatchId : SV_DispatchThreadID) { uint index = dispatchId.x; }';
    await open(source, { ...environment, stage: "compute" });
    const edit = await service.rename({ document: revision, position: position(source, "dispatchId", 1, true), newName: "threadId" });
    expect(apply(source, edit)).toBe(source.replaceAll("dispatchId", "threadId"));
  });

  it.each(["", "bad name", "1tone", "new", "operator", "iTime"])("declines invalid or host-owned name %j", async newName => {
    const source = "float tone(float x) { return x; }";
    await open(source);
    expect(await service.rename({ document: revision, position: position(source, "tone"), newName })).toBeNull();
  });

  it("declines a rename that captures an existing reference", async () => {
    const source = "float globalValue;\nfloat helper(float value) { return value + globalValue; }";
    await open(source);
    expect(await service.rename({ document: revision, position: position(source, "value"), newName: "globalValue" })).toBeNull();
  });

  it("declines a rename shadowed at one of the affected call sites", async () => {
    const source = "float value;\nfloat helper() { float result = value; { float strength = 3.0; result += value + strength; } return result; }";
    await open(source);
    expect(await service.rename({ document: revision, position: position(source, "value"), newName: "strength" })).toBeNull();
  });

  it("declines generated builtins, comments, whitespace and stale revisions", async () => {
    const source = "float helper() { return iTime; } // helper\n";
    await open(source);
    for (const cursor of [position(source, "iTime"), position(source, "helper", 1), { line: 1, character: 0 }, { line: 9, character: 0 }]) {
      expect(await service.rename({ document: revision, position: cursor, newName: "other" })).toBeNull();
    }
    expect(await service.rename({ document: { ...revision, version: 0 }, position: position(source, "helper"), newName: "other" })).toBeNull();
  });

  it.each(["common", "pass"])("renames Common from the %s across both open passes", async origin => {
    const commonUri = "file:///common.slang";
    const common = "float tone(float x) { return x * 0.5; }";
    const pass = "float4 mainImage(float2 p) { return float4(tone(p.x)); }";
    const otherUri = "file:///buffer.slang";
    const env = { ...environment, commonFile: { uri: commonUri, text: common, version: 1 } };
    await open(pass, env);
    await service.syncEnvironment({ ...env, documentUri: otherUri, passName: "BufferA" });
    await service.openDocument({ uri: otherUri, languageId: "slang", version: 1, text: pass });
    await service.syncEnvironment({ ...environment, documentUri: commonUri, passName: "common" });
    await service.openDocument({ uri: commonUri, languageId: "slang", version: 1, text: common });
    const edit = await service.rename({ document: { ...revision, uri: origin === "common" ? commonUri : uri },
      position: position(origin === "common" ? common : pass, "tone", 0, true), newName: "curve" });
    expect(apply(common, edit, commonUri)).toBe(common.replace("tone", "curve"));
    expect(apply(pass, edit)).toBe(pass.replace("tone", "curve"));
    expect(apply(pass, edit, otherUri)).toBe(pass.replace("tone", "curve"));
    expect(Object.keys(edit!.changes!)).toHaveLength(3);
  });

});
