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

  constructor(private readonly host: SlangShaderWorkspaceHost) {}

  activateRoot(ownerId: string, rootPath: string): void {
    const rootUri = fileUri(rootPath);
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
    const rootUri = this.ownerRoots.get(ownerId);
    if (rootUri !== undefined) {
      this.releaseRootOwner(ownerId, rootUri);
    }
  }

  async registerRoot(rootPath: string, configuredFilePaths: readonly string[]): Promise<SlangWorkspaceSnapshot> {
    const rootFileUri = fileUri(rootPath);
    const fallbackRootUri = vscode.Uri.file(path.dirname(rootPath)).toString();
    const rootUri = this.host.workspaceRoot(rootFileUri) ?? fallbackRootUri;
    const configuredUris = configuredFilePaths.map(fileUri);
    const snapshot = await new SlangWorkspaceSnapshotBuilder(this.host).build({
      rootUri,
      rootFiles: [rootFileUri],
      configuredPassFiles: configuredUris,
    });
    const graph = new SlangDependencyGraph(rootUri);
    for (const file of snapshot.files) {
      graph.update(file.uri, file.source);
    }
    const entryUris = new Set([rootFileUri, ...configuredUris]);
    if (!this.rootOwners.has(rootFileUri)) {
      this.activateRoot(`implicit:${rootFileUri}`, rootPath);
    }
    this.roots.set(rootFileUri, { entryUris, graph, rootPath, rootUri });
    return snapshot;
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
}
