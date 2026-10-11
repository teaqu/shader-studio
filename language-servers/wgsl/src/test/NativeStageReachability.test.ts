import { describe, expect, it } from "vitest";
import { isFragmentOnlyNativePosition } from "../NativeStageReachability";

const source = `fn fragmentOnly() { let x = iChannel0Sample(vec2f()); }
fn shared() { let x = iChannel0Sample(vec2f()); }
@fragment fn present() -> @location(0) vec4f { fragmentOnly(); shared(); return vec4f(); }
@compute @workgroup_size(1) fn advance() { shared(); }`;

describe("native WGSL stage reachability", () => {
  it("recognizes a helper reachable only from a fragment entry", () => {
    expect(isFragmentOnlyNativePosition(source, { line: 0, character: 27 })).toBe(true);
  });

  it("keeps a helper reachable from compute in compute context", () => {
    expect(isFragmentOnlyNativePosition(source, { line: 1, character: 21 })).toBe(false);
  });
});

import { WgslLanguageService } from "../WgslLanguageService";

it("offers fragment sampling inside a native fragment-only helper while retaining compute warnings", async () => {
  const uri = "file:///shared.wgsl";
  const text = "fn shade() -> vec4f { return iChannel0Sample(vec2f(0)); }\n@fragment fn present() -> @location(0) vec4f { return shade(); }\n@compute @workgroup_size(1) fn advance() { let color = iChannel0Sample(vec2f(0)); }";
  const instance = new WgslLanguageService();
  await instance.syncEnvironment({ documentUri: uri, languageId: "wgsl", generation: 1, passName: "Advance", stage: "compute", resources: [{ name: "iChannel0", kind: "texture-2d" }], customUniforms: [], virtualFiles: [] });
  await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });
  const document = { uri, languageId: "wgsl" as const, version: 1, environmentGeneration: 1 };
  const sampleAt = text.indexOf("iChannel0Sample");
  const position = { line: 0, character: sampleAt + 2 };
  expect(await instance.hover({ document, position })).not.toBeNull();
  expect((await instance.completion({ document, position })).some(item => item.label === "iChannel0Sample")).toBe(true);
  expect((await instance.signatureHelp({ document, position: { line: 0, character: sampleAt + "iChannel0Sample(".length } }))?.signatures[0]?.label).toContain("iChannel0Sample");
  const computePosition = { line: 2, character: text.split("\n")[2]!.indexOf("iChannel0Sample") + 2 };
  expect((await instance.completion({ document, position: computePosition })).some(item => item.label === "iChannel0Sample")).toBe(false);
  const computeLabels = (await instance.completion({ document, position: computePosition })).map(item => item.label);
  expect(computeLabels).not.toContain("iChannel0SampleBias");
  expect(computeLabels).toContain("iChannel0SampleLevel");
  const warnings = (await instance.diagnostics({ document })).filter(item => item.code === "sampling-requires-fragment");
  expect(warnings.map(item => item.range.start.line)).toEqual([2]);
});
