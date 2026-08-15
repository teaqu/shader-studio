import type {
  DebugCaptureSlot,
  DebugDiagnostic,
  DebugInstrumentationPlan,
  DebugPlanResult,
  DebugPreviewOptions,
  DebugSiteAnalysis,
  DebugSourcePosition,
  DebugSourceRange,
  DebugSourceUnit,
  DebugVisibleValue,
} from "@shader-studio/types";
import { applySourceEdits } from "@shader-studio/utils";
import { emitSlangFloat4, emitSlangStatic } from "./SlangEmitter";
import type { SlangCallableNode } from "./model";
import type { SlangWorkspace, SlangWorkspaceFile } from "./SlangWorkspace";

export type SlangInstrumentationMode = "preview" | "capture";

export function planSlangInstrumentation(
  workspace: SlangWorkspace,
  selectedFile: SlangWorkspaceFile,
  analysis: DebugSiteAnalysis,
  valueIds: string[],
  mode: SlangInstrumentationMode,
  previewOptions: DebugPreviewOptions = { normalizeMode: "off", stepEdge: null },
): DebugPlanResult {
  if ((analysis.origin.kind !== "direct" && analysis.origin.kind !== "macro-invocation") || !analysis.origin.writableRange) {
    return failure(analysis.sourceUri, analysis.selectedRange.start, "slang-debug-no-writable-origin", "The selected Slang statement has no writable source origin.");
  }
  const values = selectValues(analysis, valueIds);
  if (!values) {
    return failure(analysis.sourceUri, analysis.selectedRange.start, "slang-debug-stale-request", "The requested Slang debug value is no longer visible at this location.");
  }
  const rootFile = workspace.filesByUri.get(workspace.rootUri);
  const rootEntry = rootFile && findRootEntry(rootFile);
  if (!rootEntry) {
    return failure(workspace.rootUri, { line: 0, character: 0 }, "slang-debug-unsupported-syntax", "The Slang workspace root has no mainImage or supported compute entry function.");
  }
  const prefix = instrumentationPrefix(workspace.contentHash);
  if ([...workspace.filesByUri.values()].some((file) => [...file.document.tokens].some((token) => token.kind === "identifier" && token.text.startsWith(prefix)))) {
    return failure(analysis.sourceUri, analysis.selectedRange.start, "slang-debug-instrumentation-conflict", `Slang debug identifier '${prefix}' already exists.`);
  }

  const slots: DebugCaptureSlot[] = [
    { index: 0, valueId: `${prefix}_executed`, name: `${prefix}_executed`, typeName: "bool", hidden: true },
    ...values.map((value, index) => ({ index: index + 1, valueId: value.id, name: value.name, typeName: value.typeName, hidden: false })),
  ];
  const generatedSlots = values.map((value, index) => ({
    value,
    name: `${prefix}_slot${index + 1}`,
    captureExpression: value.name === "_dbgReturn" ? returnExpression(selectedFile, analysis) : value.name,
  }));
  const imported = selectedFile.source.uri !== workspace.rootUri;
  const callable = selectedFile.structure.callables.get(analysis.containingCallable.id);
  const behaviorOptions = rootEntry.kind === "compute" && callable?.id === rootEntry.callable.id
    ? { ...previewOptions, customParameters: undefined }
    : previewOptions;
  const behavior = callable
    ? buildBehaviorInstrumentation(selectedFile, callable, prefix, behaviorOptions)
    : { edits: [], declarations: [], setupStatements: [] };
  const rootDefinesWriteOutput = [...rootFile!.structure.callables.values()]
    .some((candidate) => candidate.name === "writeOutput");
  const computeOutputStubs = rootEntry.kind === "compute" && !rootDefinesWriteOutput
    ? [
      "void writeOutput(uint2 coord, float4 color) {}",
      "void writeOutput(uint2 coord, uint layer, float4 color) {}",
    ]
    : [];
  const accessors = imported
    ? [
      `public bool ${prefix}_wasExecuted() { return ${prefix}_executed; }`,
      ...generatedSlots.map((slot) => `public ${slot.value.typeName} ${prefix}_value${slot.name.slice(-1)}() { return ${slot.name}; }`),
      ...(behavior.setupStatements.length > 0
        ? [`public void ${prefix}_prepare(float2 fragCoord) { ${behavior.setupStatements.join(" ")} }`]
        : []),
    ]
    : [];
  const declarations = [
    emitSlangStatic("bool", `${prefix}_executed`),
    ...generatedSlots.map((slot) => emitSlangStatic(slot.value.typeName, slot.name)),
    ...behavior.declarations,
    ...(!imported ? computeOutputStubs : []),
    ...accessors,
  ].join("\n");
  const captureAssignment = `\n  ${prefix}_executed = true;\n${generatedSlots.map((slot) => `  ${slot.name} = ${slot.captureExpression};`).join("\n")}`;
  const wrapperSlots = generatedSlots.map((slot, index) => {
    const rawExpression = imported ? `${prefix}_value${index + 1}()` : slot.name;
    // fragCoord is expressed in pixel units. Normalize only its visual preview;
    // capture-mode readback must retain the raw coordinate values.
    const expression = mode === "preview" && slot.value.name === "fragCoord" && slot.value.typeName === "float2"
      ? `${rawExpression} / iResolution.xy`
      : rawExpression;
    return { ...slot, expression };
  });
  const computeCall = rootEntry.kind === "compute"
    ? `${prefix}_userMain(${computeEntryArguments(rootFile!, rootEntry.callable).join(", ")})`
    : `${prefix}_userMain(fragCoord)`;
  const wrapper = emitRootWrapper(
    prefix,
    wrapperSlots,
    mode,
    imported ? `${prefix}_wasExecuted()` : `${prefix}_executed`,
    computeCall,
    rootEntry.kind === "render",
    previewOptions,
    imported && behavior.setupStatements.length > 0
      ? [`${prefix}_prepare(fragCoord);`]
      : behavior.setupStatements,
  );
  const statementStart = offsetAt(selectedFile.source.source, analysis.statementRange.start);
  const statementEnd = offsetAt(selectedFile.source.source, analysis.statementRange.end);
  const trimmedStatement = selectedFile.source.source.slice(statementStart, statementEnd).trimStart();
  const isReturnStatement = trimmedStatement.startsWith("return");
  const controlFlowKeywords = ["if", "for", "while", "switch", "do"];
  const isControlFlowHeader = controlFlowKeywords.some((keyword) => trimmedStatement.startsWith(keyword));
  const captureBefore = isReturnStatement || isControlFlowHeader;
  const captureOffset = captureBefore ? statementStart : statementEnd;
  const captureText = captureBefore ? `${captureAssignment}\n  ` : captureAssignment;
  const selectedEdits = [
    { start: captureOffset, end: captureOffset, text: captureText },
    ...behavior.edits,
    { start: selectedFile.source.source.length, end: selectedFile.source.source.length, text: `\n${declarations}\n` },
  ];
  const rootEdits = [
    ...(rootEntry.kind === "compute"
      ? computeAttributeRemoval(rootFile!.source.source, rootEntry.callable, `${prefix}_userMain`)
      : [{ start: rootEntry.callable.nameToken.startOffset, end: rootEntry.callable.nameToken.endOffset, text: `${prefix}_userMain` }]),
    {
      start: rootFile!.source.source.length,
      end: rootFile!.source.source.length,
      text: `\n${imported && computeOutputStubs.length > 0 ? `${computeOutputStubs.join("\n")}\n` : ""}${wrapper}`,
    },
  ];
  const selectedApplied = applySourceEdits(selectedFile.source.source, imported ? selectedEdits : [...selectedEdits, ...rootEdits]);
  const rootApplied = imported ? applySourceEdits(rootFile!.source.source, rootEdits) : selectedApplied;
  if (!selectedApplied.ok || !rootApplied.ok) return failure(analysis.sourceUri, analysis.selectedRange.start, "debug-overlapping-edits", "Slang debug source edits overlap.");
  const files = [...workspace.filesByUri.values()].map((file) => file.source.uri === selectedFile.source.uri
    ? { ...file.source, source: selectedApplied.source, version: file.source.version + 1 }
    : file.source.uri === rootFile!.source.uri
      ? { ...file.source, source: rootApplied.source, version: file.source.version + 1 }
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

function computeEntryArguments(file: SlangWorkspaceFile, callable: SlangCallableNode): string[] {
  const signatureStart = offsetAt(file.source.source, callable.signatureRange.start);
  const signatureEnd = offsetAt(file.source.source, callable.bodyRange.start);
  const signature = file.source.source.slice(signatureStart, signatureEnd);
  const workgroup = callable.attributes
    .map((attribute) => /numthreads\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(attribute))
    .find((match) => match !== null);
  const size = workgroup ? workgroup.slice(1, 4).map(Number) : [1, 1, 1];
  const dispatchId = "uint3(uint2(fragCoord), 0)";
  return callable.parameters.map((parameter) => {
    const suffix = signature.slice(
      Math.max(0, offsetAt(file.source.source, parameter.range.end) - signatureStart),
    );
    const semantic = /^\s*:\s*(SV_[A-Za-z0-9_]+)/i.exec(suffix)?.[1]?.toLowerCase();
    if (semantic === "sv_dispatchthreadid") return dispatchId;
    if (semantic === "sv_groupid") {
      return `uint3(uint2(fragCoord) / uint2(${size[0]}, ${size[1]}), 0)`;
    }
    if (semantic === "sv_groupthreadid") {
      return `uint3(uint2(fragCoord) % uint2(${size[0]}, ${size[1]}), 0)`;
    }
    if (semantic === "sv_groupindex") {
      return `(uint(fragCoord.y) % ${size[1]}) * ${size[0]} + (uint(fragCoord.x) % ${size[0]})`;
    }
    return `${parameter.typeName}(0)`;
  });
}

function computeAttributeRemoval(
  source: string,
  callable: SlangCallableNode,
  replacementName: string,
): Array<{ start: number; end: number; text: string }> {
  const signatureStart = offsetAt(source, callable.signatureRange.start);
  const signatureEnd = offsetAt(source, callable.bodyRange.start);
  const signature = source.slice(signatureStart, signatureEnd);
  const nameStart = callable.nameToken.startOffset - signatureStart;
  const renamedSignature = `${signature.slice(0, nameStart)}${replacementName}${signature.slice(nameStart + callable.name.length)}`;
  const replaySignature = renamedSignature
    .replace(/\[\s*(?:shader\s*\(\s*["']compute["']\s*\)|numthreads\s*\([^\]]*\))\s*\]\s*/gi, "")
    .replace(/\s*:\s*SV_(?:DispatchThreadID|GroupID|GroupThreadID|GroupIndex)\b/gi, "");
  return replaySignature === signature
    ? []
    : [{ start: signatureStart, end: signatureEnd, text: replaySignature }];
}

function findRootEntry(rootFile: SlangWorkspaceFile): { kind: "render" | "compute"; callable: SlangCallableNode } | undefined {
  const callables = [...rootFile.structure.callables.values()].filter((callable) => callable.kind === "free");
  const mainImage = callables.find((callable) => callable.name === "mainImage");
  if (mainImage) return { kind: "render", callable: mainImage };

  const computeCandidates = callables.filter((callable) =>
    callable.returnTypeName === "void" && (
      callable.attributes.some((attribute) => /^shader\s*\(\s*[\"']compute[\"']\s*\)$/i.test(attribute))
    ),
  );
  const compute = computeCandidates[0];
  return compute ? { kind: "compute", callable: compute } : undefined;
}

function selectValues(analysis: DebugSiteAnalysis, valueIds: string[]): DebugVisibleValue[] | undefined {
  const values = valueIds.map((id) => analysis.visibleValues.find((value) => value.id === id));
  return values.some((value) => !value) ? undefined : values as DebugVisibleValue[];
}

function returnExpression(file: SlangWorkspaceFile, analysis: DebugSiteAnalysis): string {
  const statementStart = offsetAt(file.source.source, analysis.statementRange.start);
  const statementEnd = offsetAt(file.source.source, analysis.statementRange.end);
  const statement = file.source.source.slice(statementStart, statementEnd);
  const expression = statement.match(/^\s*return\s+([\s\S]*?);?\s*$/)?.[1]?.trim();
  if (!expression) {
    throw new Error("Synthetic Slang return value is missing its return expression.");
  }
  return expression;
}

function instrumentationPrefix(contentHash: string): string {
  const hash = (contentHash.match(/[a-fA-F0-9]/g)?.join("") ?? "00000000").slice(0, 8).padEnd(8, "0").toLowerCase();
  return `_ssdbg_${hash}`;
}

function emitRootWrapper(
  prefix: string,
  slots: Array<{ value: DebugVisibleValue; name: string; expression: string }>,
  mode: SlangInstrumentationMode,
  executionExpression: string,
  originalCall: string,
  returnsColor: boolean,
  previewOptions: DebugPreviewOptions,
  setupStatements: string[],
): string {
  const setup = setupStatements.length > 0 ? `${setupStatements.join("\n  ")}\n  ` : "";
  const callAndColor = returnsColor
    ? `${setup}float4 ${prefix}_color = ${originalCall};`
    : `${setup}${originalCall};\n  float4 ${prefix}_color = float4(0.0);`;
  if (mode === "preview") {
    const slot = slots[0]!;
    const previewColor = applySlangPreviewPostProcessing(
      emitSlangFloat4(slot.value.typeName, slot.expression),
      previewOptions,
    );
    return `float4 mainImage(float2 fragCoord) {\n  ${!executionExpression.includes("()") ? `${executionExpression} = false;\n  ` : ""}${callAndColor}\n  return ${executionExpression} ? ${previewColor} : ${prefix}_color;\n}`;
  }
  const outputs = [
    `  if (_dbgVarIndex == 0) return float4(${executionExpression} ? 1.0 : 0.0, 0.0, 0.0, 1.0);`,
    ...slots.map((slot, index) => `  if (_dbgVarIndex == ${index + 1}) return ${emitSlangFloat4(slot.value.typeName, slot.expression)};`),
  ];
  return `float4 mainImage(float2 fragCoord) {\n  ${!executionExpression.includes("()") ? `${executionExpression} = false;\n  ` : ""}${callAndColor}\n${outputs.join("\n")}\n  return ${prefix}_color;\n}`;
}

function buildBehaviorInstrumentation(
  file: SlangWorkspaceFile,
  callable: SlangCallableNode,
  prefix: string,
  options: DebugPreviewOptions,
): { edits: Array<{ start: number; end: number; text: string }>; declarations: string[]; setupStatements: string[] } {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const declarations: string[] = [];
  const setupStatements: string[] = [];
  const parameterInitializers: string[] = [];
  for (const [index, expression] of options.customParameters ?? []) {
    const parameter = callable.parameters[index];
    if (!parameter || parameter.access === "write") continue;
    const originalName = `${prefix}_originalParam${index}`;
    edits.push({
      start: offsetAt(file.source.source, parameter.range.start),
      end: offsetAt(file.source.source, parameter.range.end),
      text: originalName,
    });
    const rewrittenExpression = expression.replace(/\bfragCoord\b/g, `${prefix}_fragCoord`);
    parameterInitializers.push(`${parameter.typeName} ${parameter.name} = ${rewrittenExpression};`);
  }
  if (parameterInitializers.length > 0) {
    const bodyStart = offsetAt(file.source.source, callable.bodyRange.start) + 1;
    edits.push({ start: bodyStart, end: bodyStart, text: `\n  ${parameterInitializers.join("\n  ")}` });
    declarations.push(emitSlangStatic("float2", `${prefix}_fragCoord`));
    setupStatements.push(`${prefix}_fragCoord = fragCoord;`);
  }

  const loops = [...file.structure.controlFlows.values()]
    .filter((control) => ["for", "while", "do"].includes(control.kind))
    .filter((control) => containsRange(callable.bodyRange, control.range))
    .sort((left, right) => comparePosition(left.range.start, right.range.start));
  loops.forEach((loop, loopIndex) => {
    const maxIterations = options.loopMaxIterations?.get(loopIndex);
    if (maxIterations === undefined) return;
    const counter = `${prefix}_loop${loopIndex}`;
    declarations.push(`static int ${counter};`);
    setupStatements.push(`${counter} = 0;`);
    const body = findControlBody(file, loop.range, loop.kind);
    if (!body) return;
    const guard = `if (${counter}++ >= ${Math.max(0, Math.floor(maxIterations))}) break;`;
    if (body.braced) {
      edits.push({ start: body.start + 1, end: body.start + 1, text: `\n    ${guard}` });
    } else {
      edits.push({ start: body.start, end: body.start, text: `{ ${guard}\n` });
      edits.push({ start: body.end, end: body.end, text: "\n  }" });
    }
  });
  return { edits, declarations, setupStatements };
}

function findControlBody(
  file: SlangWorkspaceFile,
  range: DebugSourceRange,
  kind: "if" | "switch" | "for" | "while" | "do",
): { start: number; end: number; braced: boolean } | null {
  const tokens = file.preprocessor.activeTokens
    .filter((token) => token.kind !== "whitespace" && token.kind !== "comment")
    .filter((token) => containsRange(range, token.range));
  let bodyIndex = 1;
  if (kind !== "do") {
    const open = tokens.findIndex((token) => token.text === "(");
    if (open < 0) return null;
    let depth = 0;
    bodyIndex = -1;
    for (let index = open; index < tokens.length; index += 1) {
      if (tokens[index].text === "(") depth += 1;
      if (tokens[index].text === ")") {
        depth -= 1;
        if (depth === 0) { bodyIndex = index + 1; break; }
      }
    }
  }
  const bodyToken = tokens[bodyIndex];
  if (!bodyToken) return null;
  const unbracedDoEnd = kind === "do" && bodyToken.text !== "{"
    ? tokens.slice(bodyIndex).find((token) => token.text === ";")?.endOffset
    : undefined;
  return {
    start: bodyToken.startOffset,
    end: unbracedDoEnd ?? offsetAt(file.source.source, range.end),
    braced: bodyToken.text === "{",
  };
}

function containsRange(outer: DebugSourceRange, inner: DebugSourceRange): boolean {
  return comparePosition(outer.start, inner.start) <= 0 && comparePosition(outer.end, inner.end) >= 0;
}

function comparePosition(left: DebugSourcePosition, right: DebugSourcePosition): number {
  return left.line - right.line || left.character - right.character;
}

export function applySlangPreviewPostProcessing(colorExpression: string, options: DebugPreviewOptions): string {
  let result = colorExpression;
  if (options.normalizeMode === "soft") {
    result = `float4((${result}).rgb / (abs((${result}).rgb) + float3(1.0)) * 0.5 + 0.5, 1.0)`;
  } else if (options.normalizeMode === "abs") {
    result = `float4(abs((${result}).rgb) / (abs((${result}).rgb) + float3(1.0)), 1.0)`;
  }
  if (options.stepEdge !== null) {
    result = `float4(step(float3(${options.stepEdge.toFixed(4)}), (${result}).rgb), 1.0)`;
  }
  return result;
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
