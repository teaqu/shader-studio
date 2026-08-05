import type {
  DebugCaptureSlot,
  DebugDiagnostic,
  DebugInstrumentationPlan,
  DebugPlanResult,
  DebugSiteAnalysis,
  DebugSourcePosition,
  DebugSourceUnit,
  DebugVisibleValue,
} from "@shader-studio/types";
import { applySourceEdits } from "@shader-studio/utils";
import { emitSlangFloat4, emitSlangStatic } from "./SlangEmitter";
import type { SlangWorkspace, SlangWorkspaceFile } from "./SlangWorkspace";

export type SlangInstrumentationMode = "preview" | "capture";

export function planSlangInstrumentation(
  workspace: SlangWorkspace,
  selectedFile: SlangWorkspaceFile,
  analysis: DebugSiteAnalysis,
  valueIds: string[],
  mode: SlangInstrumentationMode,
): DebugPlanResult {
  if (analysis.origin.kind !== "direct" || !analysis.origin.writableRange) {
    return failure(analysis.sourceUri, analysis.selectedRange.start, "slang-debug-no-writable-origin", "The selected Slang statement has no writable source origin.");
  }
  if (selectedFile.source.uri !== workspace.rootUri) {
    return failure(analysis.sourceUri, analysis.selectedRange.start, "slang-debug-unsupported-syntax", "Slang capture from an imported module is not available yet.");
  }
  const values = selectValues(analysis, valueIds);
  if (!values) {
    return failure(analysis.sourceUri, analysis.selectedRange.start, "slang-debug-stale-request", "The requested Slang debug value is no longer visible at this location.");
  }
  const mainImage = [...selectedFile.structure.callables.values()].find((callable) => callable.kind === "free" && callable.name === "mainImage");
  if (!mainImage) {
    return failure(workspace.rootUri, { line: 0, character: 0 }, "slang-debug-unsupported-syntax", "The Slang workspace root has no mainImage function.");
  }
  const prefix = instrumentationPrefix(workspace.contentHash);
  if ([...selectedFile.document.tokens].some((token) => token.kind === "identifier" && token.text.startsWith(prefix))) {
    return failure(analysis.sourceUri, analysis.selectedRange.start, "slang-debug-instrumentation-conflict", `Slang debug identifier '${prefix}' already exists.`);
  }

  const slots: DebugCaptureSlot[] = [
    { index: 0, valueId: `${prefix}_executed`, name: `${prefix}_executed`, typeName: "bool", hidden: true },
    ...values.map((value, index) => ({ index: index + 1, valueId: value.id, name: value.name, typeName: value.typeName, hidden: false })),
  ];
  const generatedSlots = values.map((value, index) => ({ value, name: `${prefix}_slot${index + 1}` }));
  const declarations = [emitSlangStatic("bool", `${prefix}_executed`), ...generatedSlots.map((slot) => emitSlangStatic(slot.value.typeName, slot.name))].join("\n");
  const captureAssignment = `\n  ${prefix}_executed = true;\n${generatedSlots.map((slot) => `  ${slot.name} = ${slot.value.name};`).join("\n")}`;
  const wrapper = emitRootWrapper(prefix, generatedSlots, mode);
  const renameStart = mainImage.nameToken.startOffset;
  const statementEnd = offsetAt(selectedFile.source.source, analysis.statementRange.end);
  const edits = [
    { start: renameStart, end: mainImage.nameToken.endOffset, text: `${prefix}_userMain` },
    { start: statementEnd, end: statementEnd, text: captureAssignment },
    { start: selectedFile.source.source.length, end: selectedFile.source.source.length, text: `\n${declarations}\n${wrapper}` },
  ];
  const applied = applySourceEdits(selectedFile.source.source, edits);
  if (!applied.ok) return failure(analysis.sourceUri, analysis.selectedRange.start, applied.code, "Slang debug source edits overlap.");
  const files = [...workspace.filesByUri.values()].map((file) => file.source.uri === selectedFile.source.uri
    ? { ...file.source, source: applied.source, version: file.source.version + 1 }
    : { ...file.source });
  const plan: DebugInstrumentationPlan = {
    workspaceHash: workspace.contentHash,
    rootUri: workspace.rootUri,
    selectedSourceUri: selectedFile.source.uri,
    files,
    captureSlots: slots,
    executionMarkerSlot: 0,
  };
  return { ok: true, plan };
}

function selectValues(analysis: DebugSiteAnalysis, valueIds: string[]): DebugVisibleValue[] | undefined {
  const values = valueIds.map((id) => analysis.visibleValues.find((value) => value.id === id));
  return values.some((value) => !value) ? undefined : values as DebugVisibleValue[];
}

function instrumentationPrefix(contentHash: string): string {
  const hash = (contentHash.match(/[a-fA-F0-9]/g)?.join("") ?? "00000000").slice(0, 8).padEnd(8, "0").toLowerCase();
  return `_ssdbg_${hash}`;
}

function emitRootWrapper(
  prefix: string,
  slots: Array<{ value: DebugVisibleValue; name: string }>,
  mode: SlangInstrumentationMode,
): string {
  const originalCall = `${prefix}_userMain(fragCoord)`;
  if (mode === "preview") {
    const slot = slots[0]!;
    return `float4 mainImage(float2 fragCoord) {\n  ${prefix}_executed = false;\n  float4 ${prefix}_color = ${originalCall};\n  return ${prefix}_executed ? ${emitSlangFloat4(slot.value.typeName, slot.name)} : ${prefix}_color;\n}`;
  }
  const outputs = [
    `  if (_dbgVarIndex == 0) return float4(${prefix}_executed ? 1.0 : 0.0, 0.0, 0.0, 1.0);`,
    ...slots.map((slot, index) => `  if (_dbgVarIndex == ${index + 1}) return ${emitSlangFloat4(slot.value.typeName, slot.name)};`),
  ];
  return `float4 mainImage(float2 fragCoord) {\n  ${prefix}_executed = false;\n  float4 ${prefix}_color = ${originalCall};\n${outputs.join("\n")}\n  return ${prefix}_color;\n}`;
}

function offsetAt(source: string, position: DebugSourcePosition): number {
  let line = 0;
  let character = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    if (line === position.line && character === position.character) return offset;
    if (source[offset] === "\n") { line += 1; character = 0; } else character += 1;
  }
  return source.length;
}

function failure(sourceUri: string, position: DebugSourcePosition, code: DebugDiagnostic["code"], message: string): DebugPlanResult {
  return { ok: false, diagnostics: [{ code, message, sourceUri, range: { start: position, end: { ...position } } }] };
}
