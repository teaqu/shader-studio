import * as path from 'path';
import type { SlangWorkspaceSnapshot } from '@shader-studio/types';
import { SlangDependencyGraph, normalizeSlangUri } from './SlangDependencyGraph';
import { SlangWorkspaceSnapshotBuilder, type SlangWorkspaceSnapshotHost } from './SlangWorkspaceSnapshotBuilder';

export interface SlangRootSpec {
  rootPath: string;
  configuredFilePaths: readonly string[];
}

export interface SlangOwnerRequest {
  ownerId: string;
  rootUri: string;
  token: number;
}

export interface PreparedSlangRoot {
  rootPath: string;
  rootUri: string;
  snapshot: SlangWorkspaceSnapshot;
  graph: SlangDependencyGraph;
  /** Stable ordering within one coalesced prepare transaction. */
  rootIndex: number;
  rootCount: number;
}

/** The small VS Code boundary of the coordinator; keeping it injected makes graph tests deterministic. */
export interface SlangShaderWorkspaceCoordinatorHost extends SlangWorkspaceSnapshotHost {
  toUri(filePath: string): string;
  toPath(uri: string): string;
}

interface OwnerState { token: number; rootUris: ReadonlySet<string>; }

export class SlangShaderWorkspaceCoordinator {
  private readonly owners = new Map<string, OwnerState>();
  private readonly roots = new Map<string, PreparedSlangRoot>();
  private nextToken = 0;

  constructor(private readonly host: SlangShaderWorkspaceCoordinatorHost) {}

  beginOwnerRequest(ownerId: string, rootPath: string): SlangOwnerRequest {
    return this.beginOwnerRequests(ownerId, [rootPath])[0];
  }

  /** Starts one atomic generation for every root a provider will send. */
  beginOwnerRequests(ownerId: string, rootPaths: readonly string[]): readonly SlangOwnerRequest[] {
    const rootUris = [...new Set(rootPaths.map((rootPath) => normalizeSlangUri(this.host.toUri(rootPath))))]
      .sort((left, right) => left.localeCompare(right));
    const token = ++this.nextToken;
    this.owners.set(ownerId, { token, rootUris: new Set(rootUris) });
    return rootUris.map((rootUri) => ({ ownerId, rootUri, token }));
  }

  isOwnerRequestCurrent(request: SlangOwnerRequest): boolean {
    const state = this.owners.get(request.ownerId);
    return state?.token === request.token && state.rootUris.has(request.rootUri);
  }

  async prepareRoots(specs: readonly SlangRootSpec[]): Promise<readonly PreparedSlangRoot[]> {
    const unique = new Map<string, { rootPath: string; configuredFilePaths: string[] }>();
    for (const spec of specs) {
      const rootUri = normalizeSlangUri(this.host.toUri(spec.rootPath));
      const existing = unique.get(rootUri);
      if (existing) {
        existing.configuredFilePaths.push(...spec.configuredFilePaths);
      } else {
        unique.set(rootUri, { rootPath: this.host.toPath(rootUri), configuredFilePaths: [...spec.configuredFilePaths] });
      }
    }
    const ordered = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b));
    return Promise.all(ordered.map(async ([rootUri, spec], rootIndex) => {
      const workspaceUri = normalizeSlangUri(this.host.toUri(path.dirname(spec.rootPath)));
      const builder = new SlangWorkspaceSnapshotBuilder(this.host);
      const snapshot = await builder.build({
        rootUri: workspaceUri,
        rootFiles: [rootUri],
        configuredPassFiles: [...new Set(spec.configuredFilePaths.map((filePath) => normalizeSlangUri(this.host.toUri(filePath))))]
          .sort((left, right) => left.localeCompare(right)),
      });
      const graph = new SlangDependencyGraph(workspaceUri);
      for (const file of snapshot.files) {
        graph.update(file.uri, file.source);
      }
      return { rootPath: spec.rootPath, rootUri, snapshot, graph, rootIndex, rootCount: ordered.length };
    }));
  }

  commitOwnerRequest(request: SlangOwnerRequest, prepared: PreparedSlangRoot): boolean {
    if (!this.isOwnerRequestCurrent(request) || request.rootUri !== prepared.rootUri) {
      return false;
    }
    this.roots.set(prepared.rootUri, prepared);
    return true;
  }

  /** Commits a complete generation together, never leaving a prefix installed. */
  commitOwnerRequests(entries: readonly { request: SlangOwnerRequest; prepared: PreparedSlangRoot }[]): boolean {
    if (entries.length === 0 || !entries.every(({ request, prepared }) => (
      this.isOwnerRequestCurrent(request) && request.rootUri === prepared.rootUri
    ))) {
      return false;
    }
    for (const { prepared } of entries) {
      this.roots.set(prepared.rootUri, prepared);
    }
    return true;
  }

  commitOwnerRelease(request: SlangOwnerRequest): boolean {
    if (!this.isOwnerRequestCurrent(request)) {
      return false;
    }
    const owner = this.owners.get(request.ownerId)!;
    this.owners.delete(request.ownerId);
    for (const rootUri of owner.rootUris) {
      this.removeUnusedRoot(rootUri);
    }
    return true;
  }

  owningRoots(filePath: string, source?: string): readonly string[] {
    let uri: string;
    try {
      uri = normalizeSlangUri(this.host.toUri(filePath)); 
    } catch {
      return []; 
    }
    if (source !== undefined) {
      for (const prepared of this.roots.values()) {
        if (prepared.snapshot.files.some((file) => file.uri === uri)) {
          prepared.graph.update(uri, source);
        }
      }
    }
    const active = new Set([...this.owners.values()].flatMap((owner) => [...owner.rootUris]));
    const roots = new Set<string>();
    for (const prepared of this.roots.values()) {
      for (const root of prepared.graph.affectedRoots(uri, active)) {
        roots.add(root);
      }
    }
    return [...roots].map((rootUri) => this.roots.get(rootUri)?.rootPath ?? this.host.toPath(rootUri))
      .sort((a, b) => a.localeCompare(b));
  }

  releaseOwner(ownerId: string): void {
    const owner = this.owners.get(ownerId);
    if (!owner) {
      return;
    }
    this.owners.delete(ownerId);
    for (const rootUri of owner.rootUris) {
      this.removeUnusedRoot(rootUri);
    }
  }

  removeRoot(rootPath: string): void {
    const rootUri = normalizeSlangUri(this.host.toUri(rootPath));
    this.roots.delete(rootUri);
    for (const [ownerId, owner] of this.owners) {
      if (owner.rootUris.has(rootUri)) {
        const retained = new Set(owner.rootUris);
        retained.delete(rootUri);
        if (retained.size === 0) {
          this.owners.delete(ownerId);
        } else {
          this.owners.set(ownerId, { token: owner.token, rootUris: retained });
        }
      }
    }
  }

  private removeUnusedRoot(rootUri: string): void {
    if (![...this.owners.values()].some((owner) => owner.rootUris.has(rootUri))) {
      this.roots.delete(rootUri);
    }
  }
}
