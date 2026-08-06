import type { DebugDiagnostic, DebugSourcePosition, DebugSourceUnit, DebugWorkspace } from "@shader-studio/types";
import { buildSlangPreprocessorModel, type SlangPreprocessorModel } from "./SlangPreprocessor";
import { parseSlangStructure } from "./SlangStructuralParser";
import type { SlangStructuralDocument } from "./model";
import { tokenizeSlang } from "./SlangTokenizer";
import type { SlangTokenDocument } from "./tokens";

export interface SlangWorkspaceFile {
  source: Readonly<DebugSourceUnit>;
  document: SlangTokenDocument;
  preprocessor: SlangPreprocessorModel;
  structure: SlangStructuralDocument;
}

export interface SlangWorkspace {
  rootUri: string;
  rootPath: string;
  passName: string;
  contentHash: string;
  filesByUri: ReadonlyMap<string, SlangWorkspaceFile>;
  moduleUris: ReadonlyMap<string, string>;
}

export type CreateSlangWorkspaceResult =
  | { ok: true; workspace: SlangWorkspace }
  | { ok: false; diagnostics: DebugDiagnostic[] };

export function createSlangWorkspace(workspace: DebugWorkspace): CreateSlangWorkspaceResult {
  const filesByUri = new Map<string, SlangWorkspaceFile>();
  const moduleUris = new Map<string, string>();
  const diagnostics: DebugDiagnostic[] = [];

  for (const file of workspace.files) {
    const sourceUri = canonicalizeSlangUri(file.uri || file.path);
    if (!Number.isInteger(file.version) || file.version < 0) {
      diagnostics.push(invalidWorkspaceDiagnostic(sourceUri, `Slang source '${sourceUri}' has an invalid version.`));
    }
    if (filesByUri.has(sourceUri)) {
      diagnostics.push(invalidWorkspaceDiagnostic(sourceUri, `Duplicate Slang source identity '${sourceUri}'.`));
      continue;
    }
    const source = Object.freeze({ ...file, uri: sourceUri, path: canonicalizeSlangPath(file.path || file.uri) });
    const document = tokenizeSlang(sourceUri, source.source);
    const preprocessor = buildSlangPreprocessorModel(document);
    const structure = parseSlangStructure(document, preprocessor);
    filesByUri.set(sourceUri, { source, document, preprocessor, structure });

    const moduleName = structure.moduleName ?? source.moduleName;
    if (moduleName) {
      const existingUri = moduleUris.get(moduleName);
      if (existingUri && existingUri !== sourceUri) {
        diagnostics.push(invalidWorkspaceDiagnostic(sourceUri, `Duplicate Slang module '${moduleName}'.`));
      } else {
        moduleUris.set(moduleName, sourceUri);
      }
    }
  }

  const rootUri = canonicalizeSlangUri(workspace.rootUri || workspace.rootPath);
  if (!filesByUri.has(rootUri)) {
    diagnostics.push(invalidWorkspaceDiagnostic(rootUri, "The Slang debug workspace root is not present in its files."));
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    workspace: {
      rootUri,
      rootPath: canonicalizeSlangPath(workspace.rootPath || workspace.rootUri),
      passName: workspace.passName,
      contentHash: workspace.contentHash,
      filesByUri,
      moduleUris,
    },
  };
}

export function canonicalizeSlangUri(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("file:")) {
    const filePath = normalized.replace(/^file:\/*/, "/");
    return `file://${normalizePath(filePath)}`;
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalizePath(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalizePath(normalized)}`;
  }
  if (normalized.startsWith("shader-studio:")) {
    const virtualPath = normalized.replace(/^shader-studio:\/*/, "");
    return `shader-studio:///${normalizePath(virtualPath)}`;
  }
  return `shader-studio:///${normalizePath(normalized)}`;
}

export function canonicalizeSlangPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("file:") || normalized.startsWith("shader-studio:")) {
    return canonicalizeSlangUri(normalized);
  }
  return normalizePath(normalized);
}

function normalizePath(value: string): string {
  const absolute = value.startsWith("/");
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (!absolute) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}

function invalidWorkspaceDiagnostic(sourceUri: string, message: string): DebugDiagnostic {
  const position: DebugSourcePosition = { line: 0, character: 0 };
  return {
    code: "debug-invalid-workspace",
    message,
    sourceUri,
    range: { start: position, end: { ...position } },
  };
}
