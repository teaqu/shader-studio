import type {
  DebugAnalysisRequest,
  DebugAnalysisResult,
  DebugDiagnostic,
  DebugPlanResult,
  DebugPreviewOptions,
  ShaderDebugEngine,
} from "@shader-studio/types";
import { analyzeSlangSite } from "./SlangDebugAnalyzer";
import { planSlangInstrumentation } from "./SlangInstrumentationPlanner";
import { canonicalizeSlangUri, createSlangWorkspace, type SlangWorkspace, type SlangWorkspaceFile } from "./SlangWorkspace";

export class SlangDebugEngine implements ShaderDebugEngine {
  analyze(request: DebugAnalysisRequest): DebugAnalysisResult {
    const resolved = this.resolve(request);
    return resolved.ok ? analyzeSlangSite(resolved.file, request.position) : { ok: false, diagnostics: resolved.diagnostics };
  }

  planPreview(request: DebugAnalysisRequest, _options: DebugPreviewOptions): DebugPlanResult {
    const resolved = this.resolve(request);
    if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };
    const analysis = analyzeSlangSite(resolved.file, request.position);
    if (!analysis.ok) return analysis;
    if (!analysis.analysis.previewValueId) {
      return { ok: false, diagnostics: [{ code: "slang-debug-non-capturable-type", message: "No explicit Slang preview value is available here.", sourceUri: resolved.file.source.uri, range: analysis.analysis.selectedRange }] };
    }
    return planSlangInstrumentation(resolved.workspace, resolved.file, analysis.analysis, [analysis.analysis.previewValueId], "preview");
  }

  planCapture(request: DebugAnalysisRequest, valueIds: string[]): DebugPlanResult {
    const resolved = this.resolve(request);
    if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };
    const analysis = analyzeSlangSite(resolved.file, request.position);
    return analysis.ok
      ? planSlangInstrumentation(resolved.workspace, resolved.file, analysis.analysis, valueIds, "capture")
      : analysis;
  }

  private resolve(request: DebugAnalysisRequest):
    | { ok: true; workspace: SlangWorkspace; file: SlangWorkspaceFile }
    | { ok: false; diagnostics: DebugDiagnostic[] } {
    const created = createSlangWorkspace(request.workspace);
    if (!created.ok) return created;
    const file = created.workspace.filesByUri.get(canonicalizeSlangUri(request.sourceUri));
    if (!file) {
      return { ok: false, diagnostics: [{ code: "debug-invalid-workspace", message: "The selected Slang source is not in the debug workspace.", sourceUri: request.sourceUri, range: { start: request.position, end: { ...request.position } } }] };
    }
    return { ok: true, workspace: created.workspace, file };
  }
}
