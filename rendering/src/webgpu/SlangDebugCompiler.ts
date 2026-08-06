import type { DebugDiagnostic, DebugInstrumentationPlan } from "@shader-studio/types";
import type { SlangCompiler } from "./SlangCompiler";

export type SlangDebugCompileResult =
  | { success: true; wgsl: string; selectedSourceUri: string }
  | { success: false; diagnostics: DebugDiagnostic[] };

export class SlangDebugCompiler {
  constructor(private readonly compiler: Pick<SlangCompiler, "compileImagePass">) {}

  async compile(plan: DebugInstrumentationPlan): Promise<SlangDebugCompileResult> {
    const root = plan.files.find((file) => file.uri === plan.rootUri);
    if (!root) return { success: false, diagnostics: [diagnostic(plan.selectedSourceUri, "The Slang debug plan root is missing.")] };
    const result = this.compiler.compileImagePass(root.source, {
      passName: root.ownerPass,
      sourcePath: root.path,
      modules: plan.files
        .filter((file) => file.uri !== root.uri)
        .map((file) => ({ moduleName: file.moduleName, path: file.path, source: file.source })),
    });
    return result.success
      ? { success: true, wgsl: result.wgsl, selectedSourceUri: plan.selectedSourceUri }
      : { success: false, diagnostics: result.errors.map((message) => diagnostic(plan.selectedSourceUri, message)) };
  }
}

function diagnostic(sourceUri: string, message: string): DebugDiagnostic {
  return { code: "slang-debug-compile-failed", message, sourceUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
}
