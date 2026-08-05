export interface DebugSourcePosition { line: number; character: number; }
export interface DebugSourceRange { start: DebugSourcePosition; end: DebugSourcePosition; }
export interface DebugSourceUnit {
  uri: string;
  path: string;
  source: string;
  version: number;
  moduleName: string;
  ownerPass: string;
}
export interface DebugWorkspace {
  rootUri: string;
  rootPath: string;
  passName: string;
  files: DebugSourceUnit[];
  contentHash: string;
}
export interface DebugVisibleValue {
  id: string;
  name: string;
  typeName: string;
  sourceUri: string;
  declarationRange: DebugSourceRange;
  access: "read" | "write" | "readwrite";
}
export interface DebugSourceEdit { start: number; end: number; text: string; }
export interface DebugFileEdits { sourceUri: string; edits: DebugSourceEdit[]; }
export type DebugDiagnosticCode =
  | "debug-invalid-workspace"
  | "debug-overlapping-edits"
  | "slang-debug-unsupported-syntax"
  | "slang-debug-no-writable-origin"
  | "slang-debug-site-not-executed"
  | "slang-debug-non-capturable-type"
  | "slang-debug-instrumentation-conflict"
  | "slang-debug-stale-request"
  | "slang-debug-compile-failed";
export interface DebugDiagnostic {
  code: DebugDiagnosticCode;
  message: string;
  sourceUri: string;
  range: DebugSourceRange;
}
export interface DebugCallable {
  id: string;
  name: string;
  kind: "free" | "method" | "extension";
  ownerType: string | null;
  returnTypeName: string;
  signatureRange: DebugSourceRange;
  bodyRange: DebugSourceRange;
}
export interface DebugControlFlow {
  kind: "if" | "switch" | "for" | "while" | "do";
  range: DebugSourceRange;
}
export interface DebugOrigin {
  kind: "direct" | "macro-invocation" | "generated";
  writableRange?: DebugSourceRange;
}
export interface DebugSiteAnalysis {
  sourceUri: string;
  selectedRange: DebugSourceRange;
  statementRange: DebugSourceRange;
  containingCallable: DebugCallable;
  visibleValues: DebugVisibleValue[];
  controlFlow: DebugControlFlow[];
  origin: DebugOrigin;
  previewValueId: string | null;
}
export type DebugAnalysisResult =
  | { ok: true; analysis: DebugSiteAnalysis }
  | { ok: false; diagnostics: DebugDiagnostic[] };
export interface DebugCaptureSlot {
  index: number;
  valueId: string;
  name: string;
  typeName: string;
  hidden: boolean;
}
export interface DebugInstrumentationPlan {
  workspaceHash: string;
  rootUri: string;
  selectedSourceUri: string;
  files: DebugSourceUnit[];
  captureSlots: DebugCaptureSlot[];
  executionMarkerSlot: number;
}
export type DebugPlanResult =
  | { ok: true; plan: DebugInstrumentationPlan }
  | { ok: false; diagnostics: DebugDiagnostic[] };
export interface DebugAnalysisRequest {
  workspace: DebugWorkspace;
  sourceUri: string;
  position: DebugSourcePosition;
}
export interface DebugPreviewOptions { normalizeMode: "off" | "soft" | "abs"; stepEdge: number | null; }
export interface ShaderDebugEngine {
  analyze(request: DebugAnalysisRequest): DebugAnalysisResult;
  planPreview(request: DebugAnalysisRequest, options: DebugPreviewOptions): DebugPlanResult;
  planCapture(request: DebugAnalysisRequest, valueIds: string[]): DebugPlanResult;
}
