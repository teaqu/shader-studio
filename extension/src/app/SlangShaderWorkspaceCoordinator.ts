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
}

/** The small VS Code boundary of the coordinator; keeping it injected makes graph tests deterministic. */
export interface SlangShaderWorkspaceCoordinatorHost extends SlangWorkspaceSnapshotHost {
  toUri(filePath: string): string;
  toPath(uri: string): string;
}

interface OwnerState { token: number; rootUri: string; }

export class SlangShaderWorkspaceCoordinator {
  private readonly owners = new Map<string, OwnerState>();
  private readonly roots = new Map<string, PreparedSlangRoot>();
  private nextToken = 0;

  constructor(private readonly host: SlangShaderWorkspaceCoordinatorHost) {}

  beginOwnerRequest(ownerId: string, rootPath: string): SlangOwnerRequest {
    const rootUri = normalizeSlangUri(this.host.toUri(rootPath));
    const request = { ownerId, rootUri, token: ++this.nextToken };
    this.owners.set(ownerId, { rootUri, token: request.token });
    return request;
  }

  isOwnerRequestCurrent(request: SlangOwnerRequest): boolean {
    const state = this.owners.get(request.ownerId);
    return state?.token === request.token && state.rootUri === request.rootUri;
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
    return Promise.all([...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(async ([rootUri, spec]) => {
      const workspaceUri = normalizeSlangUri(this.host.toUri(path.dirname(spec.rootPath)));
      const builder = new SlangWorkspaceSnapshotBuilder(this.host);
      const snapshot = await builder.build({
        rootUri: workspaceUri,
        rootFiles: [rootUri],
        configuredPassFiles: spec.configuredFilePaths.map((filePath) => this.host.toUri(filePath)),
      });
      const graph = new SlangDependencyGraph(workspaceUri);
      for (const file of snapshot.files) {
        graph.update(file.uri, file.source);
      }
      return { rootPath: spec.rootPath, rootUri, snapshot, graph };
    }));
  }

  commitOwnerRequest(request: SlangOwnerRequest, prepared: PreparedSlangRoot): boolean {
    if (!this.isOwnerRequestCurrent(request) || request.rootUri !== prepared.rootUri) {
      return false;
    }
    this.roots.set(prepared.rootUri, prepared);
    return true;
  }

  commitOwnerRelease(request: SlangOwnerRequest): boolean {
    if (!this.isOwnerRequestCurrent(request)) {
      return false;
    }
    this.owners.delete(request.ownerId);
    this.removeUnusedRoot(request.rootUri);
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
        prepared.graph.update(uri, source);
      }
    }
    const active = new Set([...this.owners.values()].map((owner) => owner.rootUri));
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
    this.removeUnusedRoot(owner.rootUri);
  }

  removeRoot(rootPath: string): void {
    const rootUri = normalizeSlangUri(this.host.toUri(rootPath));
    this.roots.delete(rootUri);
    for (const [ownerId, owner] of this.owners) {
      if (owner.rootUri === rootUri) {
        this.owners.delete(ownerId);
      }
    }
  }

  private removeUnusedRoot(rootUri: string): void {
    if (![...this.owners.values()].some((owner) => owner.rootUri === rootUri)) {
      this.roots.delete(rootUri);
    }
  }
}
