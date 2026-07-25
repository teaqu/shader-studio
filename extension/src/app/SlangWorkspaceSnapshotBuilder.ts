import type { SlangWorkspaceSnapshot } from '@shader-studio/types';
import { SlangDependencyGraph, normalizeSlangUri, slangWorkspacePath } from './SlangDependencyGraph';

export interface SlangWorkspaceSnapshotHost {
  findSlangFiles(rootUri: string): Promise<readonly string[]>;
  readFile(uri: string): Promise<string | undefined>;
  readonly openDocuments: readonly { uri: string; source: string; version: number }[];
}

function safeNormalizeSlangUri(uri: string): string | undefined {
  try {
    return normalizeSlangUri(uri);
  } catch {
    return undefined;
  }
}

export class SlangWorkspaceSnapshotBuilder {
  constructor(private readonly host: SlangWorkspaceSnapshotHost) {}

  async build(input: { rootUri: string; rootFiles: readonly string[]; configuredPassFiles: readonly string[] }): Promise<SlangWorkspaceSnapshot> {
    const rootUri = normalizeSlangUri(input.rootUri);
    const open = new Map(this.host.openDocuments.flatMap((document) => {
      const uri = safeNormalizeSlangUri(document.uri);
      return uri === undefined ? [] : [[uri, document] as const];
    }));
    let discovered: readonly string[] = [];
    try {
      discovered = await this.host.findSlangFiles(rootUri);
    } catch {
      // A workspace scan can race deletion/permission changes; explicit files remain usable.
    }
    const initial = [...discovered, ...input.rootFiles, ...input.configuredPassFiles]
      .flatMap((uri) => {
        const canonical = safeNormalizeSlangUri(uri);
        return canonical === undefined ? [] : [canonical];
      })
      .filter((uri) => {
        const workspacePath = slangWorkspacePath(rootUri, uri);
        return workspacePath !== undefined && workspacePath !== '/workspace';
      });
    const files = new Map<string, { uri: string; source: string; version?: number }>();
    const graph = new SlangDependencyGraph(rootUri);
    const pending = [...new Set(initial)];
    while (pending.length) {
      const uri = pending.pop()!;
      if (files.has(uri)) {
        continue;
      }
      const document = open.get(uri);
      let source = document?.source;
      if (source === undefined) {
        try {
          source = await this.host.readFile(uri);
        } catch {
          continue;
        }
      }
      if (source === undefined) {
        continue;
      }
      files.set(uri, { uri, source, version: document?.version });
      graph.update(uri, source);
      for (const dependency of graph.directDependencies(uri)) {
        const workspacePath = slangWorkspacePath(rootUri, dependency);
        if (workspacePath !== undefined && workspacePath !== '/workspace' && !files.has(dependency)) {
          pending.push(dependency);
        }
      }
    }
    // Canonical URIs make equal internal paths aliases of one workspace file, so the URI tie-breaker is defensive only.
    const snapshotFiles = [...files.values()]
      .map((file) => ({ ...file, path: slangWorkspacePath(rootUri, file.uri)! }))
      .filter((file) => file.path !== '/workspace')
      .sort((left, right) => left.path.localeCompare(right.path) || left.uri.localeCompare(right.uri));
    return { rootUri, files: snapshotFiles };
  }
}
