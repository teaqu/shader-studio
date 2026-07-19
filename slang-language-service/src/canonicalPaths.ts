const INTERNAL_ROOT = "/workspace";

function outsideWorkspace(path: string): Error {
  return new Error(`Path "${path}" is outside the Slang workspace`);
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    throw new Error(`Path "${path}" contains invalid percent encoding`);
  }
}

export function normalizeInternalPath(input: string): string {
  const path = input.replaceAll("\\", "/");
  const absolute = path.startsWith("/");
  if (absolute && path !== INTERNAL_ROOT && !path.startsWith(`${INTERNAL_ROOT}/`)) {
    throw outsideWorkspace(input);
  }
  const segments = path.split("/");
  const normalized: string[] = absolute ? [] : ["workspace"];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalized.length <= 1) {
        throw outsideWorkspace(input);
      }
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }

  const result = `/${normalized.join("/")}`;
  if (result !== INTERNAL_ROOT && !result.startsWith(`${INTERNAL_ROOT}/`)) {
    throw outsideWorkspace(input);
  }
  return result;
}

function parsedFilePath(uri: string): string | undefined {
  const parsed = new URL(uri);
  if (parsed.protocol !== "file:") {
    return undefined;
  }
  return decodePath(parsed.pathname).replaceAll("\\", "/").replace(/\/$/, "");
}

function isWindowsPath(path: string): boolean {
  return /^\/[A-Za-z]:(?:\/|$)/.test(path);
}

function relativeFilePath(rootPath: string, filePath: string): string {
  const windows = isWindowsPath(rootPath);
  const comparableRoot = windows ? rootPath.toLowerCase() : rootPath;
  const comparableFile = windows ? filePath.toLowerCase() : filePath;

  if (comparableFile === comparableRoot) {
    return "";
  }
  if (!comparableFile.startsWith(`${comparableRoot}/`)) {
    throw new Error(`URI path "${filePath}" is outside the Slang workspace root "${rootPath}"`);
  }
  return filePath.slice(rootPath.length + 1);
}

export class SlangPathMap {
  private readonly rootFilePath: string | undefined;
  private readonly uriToPath = new Map<string, string>();
  private readonly pathToUri = new Map<string, string>();

  constructor(readonly rootUri: string) {
    this.rootFilePath = parsedFilePath(rootUri);
  }

  register(uri: string, relativePath?: string): string {
    const existing = this.uriToPath.get(uri);
    if (existing) {
      return existing;
    }

    let path: string;
    if (relativePath !== undefined) {
      if (relativePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relativePath)) {
        throw new Error(`Explicit relative path "${relativePath}" must be relative`);
      }
      path = normalizeInternalPath(relativePath);
    } else {
      if (this.rootFilePath === undefined) {
        throw new Error(`A relative path is required for non-file URI "${uri}"`);
      }
      const filePath = parsedFilePath(uri);
      if (filePath === undefined) {
        throw new Error(`A relative path is required for non-file URI "${uri}"`);
      }
      path = normalizeInternalPath(relativeFilePath(this.rootFilePath, filePath));
    }

    const mappedUri = this.pathToUri.get(path);
    if (mappedUri !== undefined && mappedUri !== uri) {
      throw new Error(`Canonical path "${path}" is already mapped to "${mappedUri}"`);
    }
    this.uriToPath.set(uri, path);
    this.pathToUri.set(path, uri);
    return path;
  }

  toInternalPath(uri: string): string {
    const path = this.uriToPath.get(uri);
    if (path === undefined) {
      throw new Error(`URI "${uri}" is not mapped`);
    }
    return path;
  }

  toUri(path: string): string {
    const canonicalPath = normalizeInternalPath(path);
    const uri = this.pathToUri.get(canonicalPath);
    if (uri === undefined) {
      throw new Error(`Path "${canonicalPath}" is not mapped`);
    }
    return uri;
  }
}
