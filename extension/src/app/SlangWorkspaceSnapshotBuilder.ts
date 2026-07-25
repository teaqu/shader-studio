import type { SlangWorkspaceSnapshot } from '@shader-studio/types';
import { SlangDependencyGraph, normalizeSlangUri, slangWorkspacePath } from './SlangDependencyGraph';

export interface SlangWorkspaceSnapshotHost {
  findSlangFiles(rootUri: string): Promise<readonly string[]>;
  readFile(uri: string): Promise<string | undefined>;
  readonly openDocuments: readonly { uri: string; source: string; version: number }[];
}

export class SlangWorkspaceSnapshotBuilder {
  constructor(private readonly host: SlangWorkspaceSnapshotHost) {}

  async build(input: { rootUri: string; rootFiles: readonly string[]; configuredPassFiles: readonly string[] }): Promise<SlangWorkspaceSnapshot> {
    const rootUri = normalizeSlangUri(input.rootUri);
    const open = new Map(this.host.openDocuments.map((document) => [normalizeSlangUri(document.uri), document]));
    const initial = [...await this.host.findSlangFiles(rootUri), ...input.rootFiles, ...input.configuredPassFiles]
      .map(normalizeSlangUri)
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
      const source = document?.source ?? await this.host.readFile(uri);
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
