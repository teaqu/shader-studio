import type { SlangWorkspaceFile, SlangWorkspaceSnapshot } from "@shader-studio/types";

import { SlangDependencyGraph } from "./SlangDependencyGraph";

export interface SlangOpenDocumentSnapshot {
  uri: string;
  source: string;
  version?: number;
}

export interface SlangWorkspaceSnapshotHost {
  findSlangFiles(rootUri: string): Promise<readonly string[]>;
  readFile(uri: string): Promise<string | undefined>;
  openDocuments: readonly SlangOpenDocumentSnapshot[];
}

export interface SlangWorkspaceSnapshotBuildOptions {
  rootUri: string;
  rootFiles?: readonly string[];
  configuredPassFiles?: readonly string[];
  commonFiles?: readonly string[];
  dependencyFiles?: readonly string[];
}

interface CanonicalFile {
  uri: string;
  path: string;
  key: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decodeUriPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    throw new Error(`Slang workspace URI path "${path}" contains invalid percent encoding`);
  }
}

function parsedFileUri(uri: string): URL {
  for (const match of uri.matchAll(/%([0-9a-f]{2})/gi)) {
    const decoded = String.fromCharCode(Number.parseInt(match[1] ?? "", 16));
    if (decoded === "/" || decoded === "\\" || /[A-Za-z0-9._~-]/.test(decoded)) {
      throw new Error(`Slang workspace URI "${uri}" contains an unsafe encoded path`);
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid Slang workspace URI "${uri}"`);
  }
  if (parsed.protocol !== "file:") {
    throw new Error(`Unsupported Slang workspace URI "${uri}"`);
  }
  if (parsed.hostname.toLowerCase() === "localhost") {
    parsed.hostname = "";
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed;
}

function canonicalFile(rootUri: string, uri: string): CanonicalFile {
  const root = parsedFileUri(rootUri);
  const file = parsedFileUri(uri);
  const rootAuthority = root.hostname.toLowerCase();
  const fileAuthority = file.hostname.toLowerCase();
  if (rootAuthority !== fileAuthority) {
    throw new Error(`URI "${uri}" is outside the Slang workspace root "${rootUri}"`);
  }

  const rootPath = decodeUriPath(root.pathname).replace(/\/$/, "");
  const filePath = decodeUriPath(file.pathname);
  const windows = /^\/[A-Za-z]:(?:\/|$)/.test(rootPath);
  const comparableRoot = windows ? rootPath.toLowerCase() : rootPath;
  const comparableFile = windows ? filePath.toLowerCase() : filePath;
  if (comparableFile !== comparableRoot && !comparableFile.startsWith(`${comparableRoot}/`)) {
    throw new Error(`URI "${uri}" is outside the Slang workspace root "${rootUri}"`);
  }
  const relativePath = filePath.slice(rootPath.length).replace(/^\/+/, "");
  if (relativePath.length === 0) {
    throw new Error(`URI "${uri}" does not identify a file inside the Slang workspace root`);
  }
  return {
    uri: file.href,
    path: `/workspace/${relativePath}`,
    key: windows ? `/workspace/${relativePath.toLowerCase()}` : `/workspace/${relativePath}`,
  };
}

export class SlangWorkspaceSnapshotBuilder {
  constructor(private readonly host: SlangWorkspaceSnapshotHost) {}

  async build(options: SlangWorkspaceSnapshotBuildOptions): Promise<SlangWorkspaceSnapshot> {
    const discovered = await this.host.findSlangFiles(options.rootUri);
    const explicitUris = [
      ...(options.rootFiles ?? []),
      ...(options.configuredPassFiles ?? []),
      ...(options.commonFiles ?? []),
      ...(options.dependencyFiles ?? []),
    ];
    const queued = new Map<string, { canonical: CanonicalFile; readUri: string; required: boolean }>();
    const pending: string[] = [];
    const enqueue = (uri: string, required: boolean): void => {
      const canonical = canonicalFile(options.rootUri, uri);
      const existing = queued.get(canonical.key);
      if (existing !== undefined) {
        existing.required ||= required;
        return;
      }
      queued.set(canonical.key, { canonical, readUri: uri, required });
      pending.push(canonical.key);
    };
    for (const uri of [...discovered].sort(compareText)) {
      enqueue(uri, false);
    }
    for (const uri of explicitUris) {
      enqueue(uri, true);
    }

    const openDocuments = new Map<string, SlangOpenDocumentSnapshot>();
    for (const document of this.host.openDocuments) {
      let canonical: CanonicalFile;
      try {
        canonical = canonicalFile(options.rootUri, document.uri);
      } catch {
        continue;
      }
      openDocuments.set(canonical.key, document);
    }

    const graph = new SlangDependencyGraph(options.rootUri);
    const files = new Map<string, SlangWorkspaceFile>();
    for (let index = 0; index < pending.length; index++) {
      const next = queued.get(pending[index] ?? "");
      if (next === undefined) {
        continue;
      }
      const open = openDocuments.get(next.canonical.key);
      const diskSource = open === undefined ? await this.host.readFile(next.readUri) : undefined;
      const source = open?.source ?? diskSource;
      if (source === undefined) {
        if (next.required) {
          throw new Error(`Could not read required Slang workspace file "${next.readUri}"`);
        }
        continue;
      }

      files.set(next.canonical.key, {
        uri: next.canonical.uri,
        path: next.canonical.path,
        source,
        ...(open?.version === undefined ? {} : { version: open.version }),
      });
      graph.update(next.canonical.uri, source);
      for (const dependencyUri of graph.directDependencies(next.canonical.uri)) {
        enqueue(dependencyUri, false);
      }
    }

    return {
      rootUri: options.rootUri,
      files: [...files.values()].sort((left, right) => compareText(left.path, right.path)),
    };
  }
}
