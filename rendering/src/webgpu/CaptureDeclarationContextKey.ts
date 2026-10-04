import type { CaptureCompileContext } from "../capture/VariableCapturer";

/** Inputs which alter a native capture pipeline or its declarations. */
export function captureDeclarationContextKey(context: CaptureCompileContext): string {
  return JSON.stringify([
    context.commonCode ?? "",
    context.slangChannels ?? [],
    context.slangStorage ?? [],
    context.slangPassName ?? "",
    context.slangModules ?? [],
    context.slangSourcePath ?? "",
    context.nativeRender ? {
      vertexEntryPoint: context.nativeRender.vertexEntryPoint,
      fragmentEntryPoint: context.nativeRender.fragmentEntryPoint,
      geometry: context.nativeRender.geometry,
      topology: context.nativeRender.topology ?? "triangle-list",
      vertexSpace: context.nativeRender.vertexSpace ?? "world",
      vertexCode: context.nativeRender.vertexCode,
      outputCount: context.nativeRender.outputCount ?? 1,
      writesDepth: context.nativeRender.writesDepth ?? false,
      useViewerCamera: context.nativeRender.useViewerCamera !== false,
    } : null,
  ]);
}
