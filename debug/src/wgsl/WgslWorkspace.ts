import type {
  DebugDiagnostic,
  DebugSourcePosition,
  DebugSourceUnit,
  DebugWorkspace,
} from "@shader-studio/types";

export interface WgslWorkspaceFile {
  source: Readonly<DebugSourceUnit>;
}

export interface WgslWorkspace {
  rootUri: string;
  rootPath: string;
  passName: string;
  contentHash: string;
  filesByUri: ReadonlyMap<string, WgslWorkspaceFile>;
}

export type CreateWgslWorkspaceResult =
  | { ok: true; workspace: WgslWorkspace }
  | { ok: false; diagnostics: DebugDiagnostic[] };

/**
 * Multi-document view over a WGSL debug workspace (common + image + buffers).
 * WGSL has no imports and no preprocessor, so unlike the Slang workspace this
 * only validates and canonicalizes file identities — each source is parsed
 * on demand from the analysis model instead of up front.
 */
export function createWgslWorkspace(workspace: DebugWorkspace): CreateWgslWorkspaceResult {
  const filesByUri = new Map<string, WgslWorkspaceFile>();
  const diagnostics: DebugDiagnostic[] = [];

  for (const file of workspace.files) {
    const sourceUri = canonicalizeWgslUri(file.uri || file.path);
    if (!Number.isInteger(file.version) || file.version < 0) {
      diagnostics.push(invalidWorkspaceDiagnostic(sourceUri, `WGSL source '${sourceUri}' has an invalid version.`));
    }
    if (filesByUri.has(sourceUri)) {
      diagnostics.push(invalidWorkspaceDiagnostic(sourceUri, `Duplicate WGSL source identity '${sourceUri}'.`));
      continue;
    }
    filesByUri.set(sourceUri, {
      source: Object.freeze({ ...file, uri: sourceUri, path: canonicalizeWgslPath(file.path || file.uri) }),
    });
  }

  const rootUri = canonicalizeWgslUri(workspace.rootUri || workspace.rootPath);
  if (!filesByUri.has(rootUri)) {
    diagnostics.push(invalidWorkspaceDiagnostic(rootUri, "The WGSL debug workspace root is not present in its files."));
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    workspace: {
      rootUri,
      rootPath: canonicalizeWgslPath(workspace.rootPath || workspace.rootUri),
      passName: workspace.passName,
      contentHash: workspace.contentHash,
      filesByUri,
    },
  };
}

export function canonicalizeWgslUri(value: string): string {
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

export function canonicalizeWgslPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("file:") || normalized.startsWith("shader-studio:")) {
    return canonicalizeWgslUri(normalized);
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
