import type { SlangWorkspaceSnapshot } from '@shader-studio/types';
import { SlangDependencyGraph, normalizeSlangUri } from './SlangDependencyGraph';

export interface SlangWorkspaceSnapshotHost {
  findSlangFiles(rootUri: string): Promise<readonly string[]>;
  readFile(uri: string): Promise<string | undefined>;
  readonly openDocuments: readonly { uri: string; source: string; version: number }[];
}

function pathname(uri: string): string {
  return uri.startsWith('file:') ? decodeURIComponent(new URL(uri).pathname) : uri;
}

function internalPath(rootUri: string, uri: string): string | undefined {
  const root = pathname(normalizeSlangUri(rootUri)).replace(/\/$/, '');
  const candidate = pathname(normalizeSlangUri(uri));
  if (candidate !== root && !candidate.startsWith(`${root}/`)) {
    return undefined;
  }
  return `/workspace${candidate.slice(root.length)}`;
}

export class SlangWorkspaceSnapshotBuilder {
  constructor(private readonly host: SlangWorkspaceSnapshotHost) {}

  async build(input: { rootUri: string; rootFiles: readonly string[]; configuredPassFiles: readonly string[] }): Promise<SlangWorkspaceSnapshot> {
    const rootUri = normalizeSlangUri(input.rootUri);
    const open = new Map(this.host.openDocuments.map((document) => [normalizeSlangUri(document.uri), document]));
    const initial = [...await this.host.findSlangFiles(rootUri), ...input.rootFiles, ...input.configuredPassFiles]
      .map(normalizeSlangUri)
      .filter((uri) => internalPath(rootUri, uri) !== undefined);
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
        if (internalPath(rootUri, dependency) !== undefined && !files.has(dependency)) {
          pending.push(dependency);
        }
      }
    }
    const snapshotFiles = [...files.values()]
      .map((file) => ({ ...file, path: internalPath(rootUri, file.uri)! }))
      .sort((left, right) => left.path.localeCompare(right.path) || left.uri.localeCompare(right.uri));
    return { rootUri, files: snapshotFiles };
  }
}
