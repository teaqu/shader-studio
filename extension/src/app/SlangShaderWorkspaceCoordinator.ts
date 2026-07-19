import * as path from "path";
import * as vscode from "vscode";
import type { SlangWorkspaceSnapshot } from "@shader-studio/types";

import { SlangDependencyGraph } from "./SlangDependencyGraph";
import {
  SlangWorkspaceSnapshotBuilder,
  type SlangWorkspaceSnapshotHost,
} from "./SlangWorkspaceSnapshotBuilder";

interface ActiveRootState {
  entryUris: ReadonlySet<string>;
  graph: SlangDependencyGraph;
  rootPath: string;
  rootUri: string;
}

export interface SlangRootSpec {
  configuredFilePaths: readonly string[];
  rootPath: string;
}

export interface PreparedSlangRoot extends ActiveRootState {
  rootFileUri: string;
  snapshot: SlangWorkspaceSnapshot;
}

export interface SlangOwnerRequest {
  ownerId: string;
  rootUri: string;
  token: number;
}

export interface SlangShaderWorkspaceHost extends SlangWorkspaceSnapshotHost {
  workspaceRoot(uri: string): string | undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fileUri(filePath: string): string {
  return vscode.Uri.file(filePath).toString();
}

export function createSlangShaderWorkspaceHost(): SlangShaderWorkspaceHost {
  return {
    workspaceRoot: (uri) => vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(uri))?.uri.toString(),
    findSlangFiles: async (rootUri) => {
      const root = vscode.Uri.parse(rootUri);
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root.fsPath, "**/*.slang"),
      );
      return files.map((uri) => uri.toString());
    },
    readFile: async (uri) => {
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri)));
      } catch {
        return undefined;
      }
    },
    get openDocuments() {
      return vscode.workspace.textDocuments
        .filter((document) => document.languageId === "slang" || document.fileName.endsWith(".slang"))
        .map((document) => ({
          uri: document.uri.toString(),
          source: document.getText(),
          version: document.version,
        }));
    },
  };
}

/** Owns active preview roots and their reverse dependency information. */
export class SlangShaderWorkspaceCoordinator {
  private readonly roots = new Map<string, ActiveRootState>();
  private readonly ownerRoots = new Map<string, string>();
  private readonly rootOwners = new Map<string, Set<string>>();
  private readonly ownerRequests = new Map<string, { rootUri: string; token: number }>();
  private nextOwnerToken = 1;

  constructor(private readonly host: SlangShaderWorkspaceHost) {}

  activateRoot(ownerId: string, rootPath: string): void {
    const rootUri = fileUri(rootPath);
    this.ownerRequests.set(ownerId, { rootUri, token: this.nextOwnerToken++ });
    if (!this.roots.has(rootUri)) {
      return;
    }
    this.commitOwnerRoot(ownerId, rootUri);
  }

  beginOwnerRequest(ownerId: string, rootPath: string): SlangOwnerRequest {
    const request = { ownerId, rootUri: fileUri(rootPath), token: this.nextOwnerToken++ };
    this.ownerRequests.set(ownerId, { rootUri: request.rootUri, token: request.token });
    return request;
  }

  isOwnerRequestCurrent(request: SlangOwnerRequest): boolean {
    const current = this.ownerRequests.get(request.ownerId);
    return current?.token === request.token && current.rootUri === request.rootUri;
  }

  commitOwnerRequest(request: SlangOwnerRequest, prepared: PreparedSlangRoot): boolean {
    if (!this.isOwnerRequestCurrent(request) || prepared.rootFileUri !== request.rootUri) {
      return false;
    }
    this.roots.set(prepared.rootFileUri, this.activeState(prepared));
    this.commitOwnerRoot(request.ownerId, request.rootUri);
    return true;
  }

  commitOwnerRelease(request: SlangOwnerRequest): boolean {
    if (!this.isOwnerRequestCurrent(request)) {
      return false;
    }
    const previous = this.ownerRoots.get(request.ownerId);
    if (previous !== undefined) {
      this.releaseRootOwner(request.ownerId, previous);
    }
    return true;
  }

  commitActiveRoots(preparedRoots: readonly PreparedSlangRoot[]): readonly PreparedSlangRoot[] {
    const committed = preparedRoots.filter((prepared) => this.rootOwners.has(prepared.rootFileUri));
    for (const prepared of committed) {
      this.roots.set(prepared.rootFileUri, this.activeState(prepared));
    }
    return committed;
  }

  async prepareRoots(specs: readonly SlangRootSpec[]): Promise<readonly PreparedSlangRoot[]> {
    const uniqueSpecs = new Map<string, SlangRootSpec>();
    for (const spec of specs) {
      uniqueSpecs.set(fileUri(spec.rootPath), spec);
    }
    const groups = new Map<string, SlangRootSpec[]>();
    for (const [rootFileUri, spec] of uniqueSpecs) {
      const fallbackRootUri = vscode.Uri.file(path.dirname(spec.rootPath)).toString();
      const workspaceRootUri = this.host.workspaceRoot(rootFileUri) ?? fallbackRootUri;
      const group = groups.get(workspaceRootUri) ?? [];
      group.push(spec);
      groups.set(workspaceRootUri, group);
    }

    const prepared: PreparedSlangRoot[] = [];
    for (const [workspaceRootUri, group] of groups) {
      const rootFiles = group.map((spec) => fileUri(spec.rootPath));
      const configuredPassFiles = [...new Set(group.flatMap((spec) => (
        spec.configuredFilePaths.map(fileUri)
      )))];
      const snapshot = await new SlangWorkspaceSnapshotBuilder(this.host).build({
        rootUri: workspaceRootUri,
        rootFiles,
        configuredPassFiles,
      });
      for (const spec of group) {
        const graph = new SlangDependencyGraph(workspaceRootUri);
        for (const file of snapshot.files) {
          graph.update(file.uri, file.source);
        }
        const rootFileUri = fileUri(spec.rootPath);
        prepared.push({
          entryUris: new Set([
            rootFileUri,
            ...spec.configuredFilePaths.map(fileUri),
          ]),
          graph,
          rootPath: spec.rootPath,
          rootFileUri,
          rootUri: workspaceRootUri,
          snapshot,
        });
      }
    }
    return prepared.sort((left, right) => compareText(left.rootPath, right.rootPath));
  }

  /** @deprecated Use prepareRoots with an explicit owner request and conditional commit. */
  async registerRoot(rootPath: string, configuredFilePaths: readonly string[]): Promise<SlangWorkspaceSnapshot> {
    const prepared = await this.prepareRoots([{ rootPath, configuredFilePaths }]);
    const root = prepared[0];
    if (!root) {
      throw new Error(`Could not prepare Slang root "${rootPath}"`);
    }
    this.commitActiveRoots([root]);
    return root.snapshot;
  }

  private commitOwnerRoot(ownerId: string, rootUri: string): void {
    const previous = this.ownerRoots.get(ownerId);
    if (previous === rootUri) {
      return;
    }
    if (previous !== undefined) {
      this.releaseRootOwner(ownerId, previous);
    }
    this.ownerRoots.set(ownerId, rootUri);
    const owners = this.rootOwners.get(rootUri) ?? new Set<string>();
    owners.add(ownerId);
    this.rootOwners.set(rootUri, owners);
  }

  releaseOwner(ownerId: string): void {
    this.ownerRequests.delete(ownerId);
    this.nextOwnerToken++;
    const rootUri = this.ownerRoots.get(ownerId);
    if (rootUri !== undefined) {
      this.releaseRootOwner(ownerId, rootUri);
    }
  }

  owningRoots(filePath: string, source?: string): readonly string[] {
    const uri = fileUri(filePath);
    const owners: string[] = [];
    for (const state of this.roots.values()) {
      if (!uri.startsWith(`${state.rootUri.replace(/\/$/, "")}/`) && uri !== state.rootUri) {
        continue;
      }
      if (source === undefined) {
        state.graph.remove(uri);
      } else {
        state.graph.update(uri, source);
      }
      if (state.graph.affectedRoots(uri, state.entryUris).size > 0) {
        owners.push(state.rootPath);
      }
    }
    return owners.sort(compareText);
  }

  removeRoot(rootPath: string): void {
    const rootUri = fileUri(rootPath);
    this.roots.delete(rootUri);
    for (const owner of this.rootOwners.get(rootUri) ?? []) {
      this.ownerRoots.delete(owner);
    }
    this.rootOwners.delete(rootUri);
  }

  private releaseRootOwner(ownerId: string, rootUri: string): void {
    this.ownerRoots.delete(ownerId);
    const owners = this.rootOwners.get(rootUri);
    owners?.delete(ownerId);
    if (owners?.size === 0) {
      this.rootOwners.delete(rootUri);
      this.roots.delete(rootUri);
    }
  }

  private activeState(prepared: PreparedSlangRoot): ActiveRootState {
    return {
      entryUris: prepared.entryUris,
      graph: prepared.graph,
      rootPath: prepared.rootPath,
      rootUri: prepared.rootUri,
    };
  }
}
