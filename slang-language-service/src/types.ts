export type SlangLanguageVersion = "legacy" | "2025" | "2026" | "latest";

export interface SlangPosition {
  line: number;
  character: number;
}

export interface SlangRange {
  start: SlangPosition;
  end: SlangPosition;
}

export interface SlangWorkspaceFile {
  uri: string;
  path: string;
  source: string;
  version?: number;
}

export interface SlangWorkspaceSnapshot {
  rootUri: string;
  files: SlangWorkspaceFile[];
}

export interface SlangDocumentSnapshot {
  uri: string;
  path: string;
  source: string;
  version: number;
}

export interface SlangDiagnostic {
  uri: string;
  range: SlangRange;
  severity: "error" | "warning" | "information" | "hint";
  code?: string;
  message: string;
  source: "slang-language" | "slang-compile" | "webgpu";
  passName?: string;
}
