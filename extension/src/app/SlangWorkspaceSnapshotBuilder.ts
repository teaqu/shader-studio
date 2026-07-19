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
}

interface CanonicalFile {
  uri: string;
  path: string;
}

function decodeUriPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    throw new Error(`Slang workspace URI path "${path}" contains invalid percent encoding`);
  }
}

function parsedFileUri(uri: string): URL {
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
  };
}

export class SlangWorkspaceSnapshotBuilder {
  constructor(private readonly host: SlangWorkspaceSnapshotHost) {}

  async build(options: SlangWorkspaceSnapshotBuildOptions): Promise<SlangWorkspaceSnapshot> {
    const discovered = await this.host.findSlangFiles(options.rootUri);
    const requiredUris = [
      ...discovered,
      ...(options.rootFiles ?? []),
      ...(options.configuredPassFiles ?? []),
      ...(options.commonFiles ?? []),
    ];
    const requiredPaths = new Set<string>();
    const queued = new Map<string, { canonical: CanonicalFile; readUri: string; required: boolean }>();
    for (const uri of requiredUris) {
      const canonical = canonicalFile(options.rootUri, uri);
      requiredPaths.add(canonical.path);
      const existing = queued.get(canonical.path);
      queued.set(canonical.path, {
        canonical,
        readUri: existing?.readUri ?? uri,
        required: true,
      });
    }

    const openDocuments = new Map<string, SlangOpenDocumentSnapshot>();
    for (const document of this.host.openDocuments) {
      let canonical: CanonicalFile;
      try {
        canonical = canonicalFile(options.rootUri, document.uri);
      } catch {
        continue;
      }
      openDocuments.set(canonical.path, document);
    }

    const graph = new SlangDependencyGraph(options.rootUri);
    const files = new Map<string, SlangWorkspaceFile>();
    const processed = new Set<string>();
    while (true) {
      const next = [...queued.values()]
        .filter((entry) => !processed.has(entry.canonical.path))
        .sort((left, right) => left.canonical.path.localeCompare(right.canonical.path))[0];
      if (next === undefined) {
        break;
      }
      processed.add(next.canonical.path);
      const open = openDocuments.get(next.canonical.path);
      const diskSource = open === undefined ? await this.host.readFile(next.readUri) : undefined;
      const source = open?.source ?? diskSource;
      if (source === undefined) {
        if (next.required || requiredPaths.has(next.canonical.path)) {
          throw new Error(`Could not read required Slang workspace file "${next.readUri}"`);
        }
        continue;
      }

      files.set(next.canonical.path, {
        uri: next.canonical.uri,
        path: next.canonical.path,
        source,
        ...(open?.version === undefined ? {} : { version: open.version }),
      });
      graph.update(next.canonical.uri, source);
      for (const dependencyUri of graph.directDependencies(next.canonical.uri)) {
        const dependency = canonicalFile(options.rootUri, dependencyUri);
        if (!queued.has(dependency.path)) {
          queued.set(dependency.path, {
            canonical: dependency,
            readUri: dependency.uri,
            required: false,
          });
        }
      }
    }

    return {
      rootUri: options.rootUri,
      files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
    };
  }
}
