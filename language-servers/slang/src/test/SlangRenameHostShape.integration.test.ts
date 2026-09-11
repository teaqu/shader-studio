import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Position, WorkspaceEdit } from "vscode-languageserver-protocol";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import createSlangModule from "../../../../ui/src/slang/slang-wasm.js";
import { SlangLanguageService } from "../SlangLanguageService";
import type { SlangLanguageServerModule } from "../slangLanguageServerTypes";

// Host-shape Common rename coverage lives in its own file (rather than
// alongside SlangRename.integration.test.ts) because every integration test
// spins real compiler sessions in the shared wasm module instance, and a full
// file of them exhausts the session budget: these two tests pass in any
// subset but starve when ~20 compiler-heavy tests precede them in one module.
// A separate file gets a fresh module instance, matching the host, which runs
// a single long-lived service.
const uri = "file:///host-rename.slang";
const commonUri = "file:///host-common.slang";
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
function apply(source: string, result: WorkspaceEdit | null, documentUri: string): string {
  expect(result?.changes?.[documentUri], "expected authored rename edits").toBeDefined();
  const offset = (p: Position) => source.split("\n").slice(0, p.line).reduce((sum, line) => sum + line.length + 1, 0) + p.character;
  return [...result!.changes![documentUri]].sort((a, b) => offset(b.range.start) - offset(a.range.start))
    .reduce((text, edit) => text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end)), source);
}

describe("Slang rename in host workspace shape", () => {
  let module: SlangLanguageServerModule;
  let service: SlangLanguageService;
  beforeAll(async () => {
    module = await createSlangModule({ wasmBinary: readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url)) });
  }, 20_000);
  afterEach(async () => {
    await service?.dispose();
  });

  it("renames Common from the pass when a second editor holds the Common file itself", async () => {
    // At the host every ShaderEditor shares one language service. A second
    // editor (preview overlay) can sync the Common file as its own document
    // while still carrying the pass context, so its commonFile points at
    // itself. The rename must still cover both files: without the self-link
    // guard renameCompiles concatenates the Common source twice and vetoes a
    // correct edit.
    const common = "float tone(float x) { return x * 0.5; }";
    const pass = "float4 mainImage(float2 coord) { return float4(tone(coord.x)); }";
    const workspaceDocuments: NonNullable<ShaderAuthoringEnvironment["workspaceDocuments"]> = [
      { uri, text: pass, version: 1, stage: "fragment", commonUri },
      { uri: commonUri, text: common, version: 1, stage: "fragment", commonUri: undefined },
    ];
    const commonFile = { uri: commonUri, text: common, version: 1 };
    service = new SlangLanguageService(module);
    await service.syncEnvironment({ ...environment, documentUri: uri, commonFile, workspaceDocuments });
    await service.openDocument({ uri, languageId: "slang", version: 1, text: pass });
    await service.syncEnvironment({ ...environment, documentUri: commonUri, commonFile, workspaceDocuments });
    await service.openDocument({ uri: commonUri, languageId: "slang", version: 1, text: common });
    const edit = await service.rename({ document: { ...revision, uri },
      position: position(pass, "tone", 0, true), newName: "curve" });
    expect(apply(common, edit, commonUri)).toBe(common.replace("tone", "curve"));
    expect(apply(pass, edit, uri)).toBe(pass.replace("tone", "curve"));
    expect(Object.keys(edit!.changes!)).toHaveLength(2);
  });

  it.each(["pass", "common"])("renames Common from the %s when only that file is open", async origin => {
    // At the host only the active file is open in the service store: the
    // Common link for every other file comes from workspaceDocuments, and the
    // store environment never sets top-level commonFile. Without the
    // renameDocuments backfill the active pass cannot see its Common and the
    // rename is declined.
    const common = "float tone(float x) { return x * 0.5; }";
    const pass = "float4 mainImage(float2 coord) { return float4(tone(coord.x)); }";
    const workspaceDocuments: NonNullable<ShaderAuthoringEnvironment["workspaceDocuments"]> = [
      { uri, text: pass, version: 1, stage: "fragment", commonUri },
      { uri: commonUri, text: common, version: 1, stage: "fragment", commonUri: undefined },
    ];
    const activeUri = origin === "common" ? commonUri : uri;
    const activeText = origin === "common" ? common : pass;
    service = new SlangLanguageService(module);
    await service.syncEnvironment({ ...environment, documentUri: activeUri, workspaceDocuments });
    await service.openDocument({ uri: activeUri, languageId: "slang", version: 1, text: activeText });
    const edit = await service.rename({ document: { ...revision, uri: activeUri },
      position: position(activeText, "tone", 0, true), newName: "curve" });
    expect(apply(common, edit, commonUri)).toBe(common.replace("tone", "curve"));
    expect(apply(pass, edit, uri)).toBe(pass.replace("tone", "curve"));
    expect(Object.keys(edit!.changes!)).toHaveLength(2);
  });
});
