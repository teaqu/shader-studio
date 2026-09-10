import type {
  DebugDiagnostic,
  DebugPlanResult,
  DebugPreviewOptions,
  DebugSiteAnalysis,
  DebugSourcePosition,
  DebugSourceUnit,
  DebugVisibleValue,
} from "@shader-studio/types";
import { applySourceEdits } from "@shader-studio/utils";
import { parseWgslDocument } from "@shader-studio/wgsl-analysis";
import { buildWgslBehaviorInstrumentation } from "./WgslBehaviorInstrumentation";
import { buildWgslComputeInstrumentation } from "./WgslComputeInstrumentation";
import { emitWgslFloat4 } from "./WgslEmitter";
import type { WgslDebugSourceMap } from "./WgslDebugSourceMap";
import { offsetAt } from "./model";

/**
 * Instruments a WGSL render shader or compute invocation for preview and capture. WGSL has
 * no imports; a source map splits combined common/pass edits back into files.
 * Capture assignments go next to the selected statement, the renamed entry becomes `<prefix>_userMain`,
 * and a fresh `mainImage` wrapper drives preview/capture selection. The engine
 * compiles the result with the capture-mode prelude, which provides
 * `_ss_dbgCapU` (the slot selector) and `_ss_dbgVarIndex`.
 */
export function planWgslInstrumentation(
  source: string,
  sourceUri: string,
  contentHash: string,
  analysis: DebugSiteAnalysis,
  valueIds: string[],
  mode: "preview" | "capture",
  previewOptions: DebugPreviewOptions = { normalizeMode: "off", stepEdge: null },
  sourceMap?: WgslDebugSourceMap,
): DebugPlanResult {
  if (analysis.origin.kind !== "direct" || !analysis.origin.writableRange) {
    return failure(sourceUri, analysis.selectedRange.start, "wgsl-debug-no-writable-origin", "The selected WGSL statement has no writable source origin.");
  }
  const values = selectValues(analysis, valueIds);
  if (!values) {
    return failure(sourceUri, analysis.selectedRange.start, "wgsl-debug-stale-request", "The requested WGSL debug value is no longer visible at this location.");
  }
  const prefix = instrumentationPrefix(contentHash);
  const document = parseWgslDocument(sourceUri, source, "fragment");
  const compute = buildWgslComputeInstrumentation(source, document, prefix, sourceMap?.workspace.compute);
  if (typeof compute === "string") {
    return failure(sourceUri, analysis.selectedRange.start, "wgsl-debug-unsupported-syntax", compute);
  }
  const entryName = compute?.entryName ?? "mainImage";
  const functionScope = document.scopes.find((scope) => scope.kind === "function" && scope.name === entryName);
  const entry = functionScope
    ? document.symbols.find((symbol) => symbol.kind === "function" && symbol.name === entryName)
    : undefined;
  const parameters = functionScope
    ? document.symbols.filter((symbol) => symbol.kind === "parameter" && symbol.scopeId === functionScope.id)
    : [];
  const [coordinate] = parameters;
  const isRenderEntry = entry !== undefined
    && parameters.length === 1
    && (coordinate?.typeName === "vec2f" || coordinate?.typeName === "vec2<f32>")
    && (entry.typeName === "vec4f" || entry.typeName === "vec4<f32>");
  if (!isRenderEntry && !compute) {
    return failure(sourceUri, analysis.selectedRange.start, "wgsl-debug-unsupported-syntax", "WGSL debugging supports render shaders with a 'fn mainImage(coord: vec2f) -> vec4f' entry.");
  }
  if (source.includes(prefix)) {
    return failure(sourceUri, analysis.selectedRange.start, "wgsl-debug-instrumentation-conflict", `WGSL debug identifier '${prefix}' already exists.`);
  }

  const behaviorOptions = compute && analysis.containingCallable.name === compute.entryName
    ? { ...previewOptions, customParameters: undefined } : previewOptions;
  const behavior = buildWgslBehaviorInstrumentation(document, analysis, prefix, behaviorOptions);
  if (typeof behavior === "string") {
    return failure(sourceUri, analysis.selectedRange.start, "wgsl-debug-unsupported-syntax", behavior);
  }

  const slots = values.map((value, index) => ({
    value,
    name: `${prefix}_slot${index + 1}`,
    captureExpression: value.name === "_dbgReturn" ? returnExpression(source, analysis) : value.name,
  }));
  const captureAssignment = `\n  ${prefix}_executed = true;\n${slots.map((slot) => `  ${slot.name} = ${slot.captureExpression};`).join("\n")}`;
  const statementStart = offsetAt(source, analysis.statementRange.start);
  const statementEnd = offsetAt(source, analysis.statementRange.end);
  const trimmedStatement = source.slice(statementStart, statementEnd).trimStart();
  const captureBefore = trimmedStatement.startsWith("return")
    || ["if", "for", "while", "switch", "loop"].some((keyword) => trimmedStatement.startsWith(keyword));
  const captureOffset = captureBefore ? statementStart : statementEnd;
  const captureText = captureBefore ? `${captureAssignment}\n  ` : captureAssignment;
  const declarations = [
    `var<private> ${prefix}_executed: bool;`,
    ...behavior.declarations,
    ...(compute?.declarations ?? []),
    ...slots.map((slot) => `var<private> ${slot.name}: ${slot.value.typeName};`),
  ].join("\n");
  const nameToken = entry!.declaration;
  const nameStart = offsetAt(source, nameToken.start);
  const nameEnd = offsetAt(source, nameToken.end);
  const invocation = compute
    ? `${compute.call}\n  let ${prefix}_color = vec4f(0.0);`
    : `let ${prefix}_color = ${prefix}_userMain(coord);`;
  const wrapper = mode === "preview"
    ? emitPreviewWrapper(prefix, slots, previewOptions, behavior.setup, invocation)
    : emitCaptureWrapper(prefix, slots, behavior.setup, invocation);
  const edits = [
    ...behavior.edits,
    ...(compute?.edits ?? []),
    { start: captureOffset, end: captureOffset, text: captureText },
    ...(!compute ? [{ start: nameStart, end: nameEnd, text: `${prefix}_userMain` }] : []),
    { start: source.length, end: source.length, text: `\n${declarations}\n\n${wrapper}\n` },
  ];
  const applied = applySourceEdits(source, edits);
  if (!applied.ok) {
    return failure(sourceUri, analysis.selectedRange.start, "debug-overlapping-edits", "WGSL debug source edits overlap.");
  }
  const file: DebugSourceUnit = {
    uri: sourceUri,
    path: sourceUri,
    source: applied.source,
    version: 1,
    moduleName: "",
    ownerPass: "",
  };
  const files: DebugSourceUnit[] = [];
  for (const segment of sourceMap?.segments ?? []) {
    const localEdits = edits.filter(edit => edit.start >= segment.start && edit.end <= segment.end)
      .map(edit => ({ ...edit, start: edit.start - segment.start, end: edit.end - segment.start }));
    const local = applySourceEdits(segment.file.source, localEdits);
    if (!local.ok) return failure(sourceUri, analysis.selectedRange.start, "debug-overlapping-edits", "WGSL debug source edits overlap.");
    files.push({ ...segment.file, source: local.source, version: segment.file.version + (localEdits.length > 0 ? 1 : 0) });
  }
  return {
    ok: true,
    plan: {
      workspaceHash: contentHash,
      rootUri: sourceMap?.segment(sourceMap.workspace.rootUri).file.uri ?? sourceUri,
      selectedSourceUri: sourceMap?.segment(sourceUri).file.uri ?? sourceUri,
      files: sourceMap ? files : [file],
      captureSlots: [
        { index: 0, valueId: `${prefix}_executed`, name: `${prefix}_executed`, typeName: "bool", hidden: true },
        ...values.map((value, index) => ({ index: index + 1, valueId: value.id, name: value.name, typeName: value.typeName, hidden: false })),
      ],
      executionMarkerSlot: 0,
    },
  };
}

function emitPreviewWrapper(
  prefix: string,
  slots: Array<{ value: DebugVisibleValue; name: string }>,
  previewOptions: DebugPreviewOptions,
  setup: string[],
  invocation: string,
): string {
  const slot = slots[0]!;
  const previewColor = applyWgslPreviewPostProcessing(emitWgslFloat4(slot.value.typeName, slot.name), previewOptions);
  return `fn mainImage(coord: vec2f) -> vec4f {\n  ${prefix}_executed = false;\n  ${setup.join("\n  ")}\n  ${invocation}\n  if (${prefix}_executed) { return ${previewColor}; }\n  return ${prefix}_color;\n}`;
}

function emitCaptureWrapper(prefix: string, slots: Array<{ value: DebugVisibleValue; name: string }>, setup: string[], invocation: string): string {
  const outputs = [
    `  if (_ss_dbgCapU.varIndex == 0) { return vec4f(f32(${prefix}_executed), 0.0, 0.0, 1.0); }`,
    ...slots.map((slot, index) => `  if (_ss_dbgCapU.varIndex == ${index + 1}) { return ${emitWgslFloat4(slot.value.typeName, slot.name)}; }`),
  ];
  return `fn mainImage(coord: vec2f) -> vec4f {\n  ${prefix}_executed = false;\n  ${setup.join("\n  ")}\n  ${invocation}\n${outputs.join("\n")}\n  return ${prefix}_color;\n}`;
}

export function applyWgslPreviewPostProcessing(colorExpression: string, options: DebugPreviewOptions): string {
  let result = colorExpression;
  if (options.normalizeMode === "soft") {
    result = `vec4f((${result}).rgb / (abs((${result}).rgb) + vec3f(1.0)) * 0.5 + 0.5, 1.0)`;
  } else if (options.normalizeMode === "abs") {
    result = `vec4f(abs((${result}).rgb) / (abs((${result}).rgb) + vec3f(1.0)), 1.0)`;
  }
  if (options.stepEdge !== null) {
    result = `vec4f(step(vec3f(${options.stepEdge.toFixed(4)}), (${result}).rgb), 1.0)`;
  }
  return result;
}

function selectValues(analysis: DebugSiteAnalysis, valueIds: string[]): DebugVisibleValue[] | undefined {
  const values = valueIds.map((id) => analysis.visibleValues.find((value) => value.id === id));
  return values.some((value) => !value) ? undefined : values as DebugVisibleValue[];
}

function returnExpression(source: string, analysis: DebugSiteAnalysis): string {
  const statementStart = offsetAt(source, analysis.statementRange.start);
  const statementEnd = offsetAt(source, analysis.statementRange.end);
  const expression = source.slice(statementStart, statementEnd).match(/^\s*return\s+([\s\S]*?);?\s*$/)?.[1]?.trim();
  if (!expression) {
    throw new Error("Synthetic WGSL return value is missing its return expression.");
  }
  return expression;
}

function instrumentationPrefix(contentHash: string): string {
  const hash = (contentHash.match(/[a-fA-F0-9]/g)?.join("") ?? "00000000").slice(0, 8).padEnd(8, "0").toLowerCase();
  return `_ssdbg_${hash}`;
}

function failure(sourceUri: string, position: DebugSourcePosition, code: DebugDiagnostic["code"], message: string): DebugPlanResult {
  return { ok: false, diagnostics: [{ code, message, sourceUri, range: { start: position, end: { ...position } } }] };
}
