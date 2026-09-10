import type {
  DebugAnalysisRequest,
  DebugAnalysisResult,
  DebugDiagnostic,
  DebugPlanResult,
  DebugPreviewOptions,
  ShaderDebugEngine,
} from "@shader-studio/types";
import { WgslDebugSourceMap } from "./WgslDebugSourceMap";
import { analyzeWgslSite } from "./WgslDebugAnalyzer";
import { planWgslInstrumentation } from "./WgslInstrumentationPlanner";
import { canonicalizeWgslUri, createWgslWorkspace, type WgslWorkspaceFile } from "./WgslWorkspace";

export class WgslDebugEngine implements ShaderDebugEngine {
  analyze(request: DebugAnalysisRequest): DebugAnalysisResult {
    const resolved = this.resolve(request);
    if (!resolved.ok) {
      return { ok: false, diagnostics: resolved.diagnostics };
    }
    const analysis = this.analyzeResolved(request, resolved.map);
    return analysis.ok ? { ok: true, analysis: resolved.map.originalAnalysis(analysis.analysis) } : analysis;
  }

  planPreview(request: DebugAnalysisRequest, options: DebugPreviewOptions): DebugPlanResult {
    const resolved = this.resolve(request);
    if (!resolved.ok) {
      return { ok: false, diagnostics: resolved.diagnostics };
    }
    const analysis = this.analyzeResolved(request, resolved.map);
    if (!analysis.ok) {
      return analysis;
    }
    if (!analysis.analysis.previewValueId) {
      return { ok: false, diagnostics: [{ code: "wgsl-debug-non-capturable-type", message: "No explicit WGSL preview value is available here.", sourceUri: request.sourceUri, range: resolved.map.originalRange(analysis.analysis.selectedRange).range }] };
    }
    return this.originalPlan(resolved.map, planWgslInstrumentation(resolved.map.source, request.sourceUri, request.workspace.contentHash, analysis.analysis, [analysis.analysis.previewValueId], "preview", options, resolved.map));
  }

  planCapture(request: DebugAnalysisRequest, valueIds: string[], options?: DebugPreviewOptions): DebugPlanResult {
    const resolved = this.resolve(request);
    if (!resolved.ok) {
      return { ok: false, diagnostics: resolved.diagnostics };
    }
    const analysis = this.analyzeResolved(request, resolved.map);
    return analysis.ok
      ? this.originalPlan(resolved.map, planWgslInstrumentation(resolved.map.source, request.sourceUri, request.workspace.contentHash, analysis.analysis, valueIds, "capture", options, resolved.map))
      : analysis;
  }

  /**
   * Build an inline preview for an explicit visible value, such as a value
   * selected from the variable inspector rather than inferred from the cursor.
   */
  planPreviewValue(request: DebugAnalysisRequest, valueId: string, options: DebugPreviewOptions): DebugPlanResult {
    const resolved = this.resolve(request);
    if (!resolved.ok) {
      return { ok: false, diagnostics: resolved.diagnostics };
    }
    const analysis = this.analyzeResolved(request, resolved.map);
    return analysis.ok
      ? this.originalPlan(resolved.map, planWgslInstrumentation(resolved.map.source, request.sourceUri, request.workspace.contentHash, analysis.analysis, [valueId], "preview", options, resolved.map))
      : analysis;
  }

  private originalPlan(map: WgslDebugSourceMap, result: DebugPlanResult): DebugPlanResult {
    return result.ok ? result : { ok: false, diagnostics: result.diagnostics.map(diagnostic => ({
      ...diagnostic, ...map.originalRange(diagnostic.range),
    })) };
  }

  private analyzeResolved(request: DebugAnalysisRequest, map: WgslDebugSourceMap): DebugAnalysisResult {
    const result = analyzeWgslSite(
      map.source,
      request.sourceUri,
      map.assembledPosition(request.sourceUri, request.position),
      request.workspace.compute ? "compute" : "fragment",
    );
    return result.ok ? result : { ok: false, diagnostics: result.diagnostics.map(diagnostic => ({
      ...diagnostic, ...map.originalRange(diagnostic.range),
    })) };
  }

  private resolve(request: DebugAnalysisRequest):
    | { ok: true; file: WgslWorkspaceFile; map: WgslDebugSourceMap }
    | { ok: false; diagnostics: DebugDiagnostic[] } {
    if (!request.sourceUri.toLowerCase().endsWith(".wgsl")) {
      return { ok: false, diagnostics: [{ code: "debug-unsupported-language", message: "WGSL debugging only supports .wgsl sources.", sourceUri: request.sourceUri, range: { start: request.position, end: { ...request.position } } }] };
    }
    const created = createWgslWorkspace(request.workspace);
    if (!created.ok) {
      return created;
    }
    const file = created.workspace.filesByUri.get(canonicalizeWgslUri(request.sourceUri));
    if (!file) {
      return { ok: false, diagnostics: [{ code: "debug-invalid-workspace", message: "The selected WGSL source is not in the debug workspace.", sourceUri: request.sourceUri, range: { start: request.position, end: { ...request.position } } }] };
    }
    return { ok: true, file, map: new WgslDebugSourceMap(request.workspace) };
  }
}
