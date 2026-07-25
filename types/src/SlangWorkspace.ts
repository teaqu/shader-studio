export const NEW_SLANG_FILE_LANGUAGE_VERSION = "2026" as const;

export type SlangLanguageVersion = "legacy" | "2025" | "2026" | "latest";

export interface SlangPosition { line: number; character: number; }
export interface SlangRange { start: SlangPosition; end: SlangPosition; }
export interface SlangWorkspaceFile { uri: string; path: string; source: string; version?: SlangLanguageVersion; }
export interface SlangWorkspaceSnapshot { rootUri: string; files: SlangWorkspaceFile[]; }
export interface SlangDiagnostic {
  severity: "error" | "warning" | "information" | "hint";
  message: string;
  source: "slang-compile" | "webgpu";
  range?: SlangRange;
  code?: string | number;
  passName?: string;
}
export interface CompileDiagnosticScope { rootUris: string[]; ownerId?: string; generationId?: string; }
export interface ShaderCompileGeneration { id: string; rootIndex: number; rootCount: number; rootPath: string; }
