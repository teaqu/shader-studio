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

  constructor(private readonly host: SlangShaderWorkspaceHost) {}

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
      const conservativeModuleInvalidation = source === undefined || /\bmodule\s+[A-Za-z_]\w*/.test(source);
      if (state.graph.affectedRoots(uri, state.entryUris, conservativeModuleInvalidation).size > 0) {
        owners.push(state.rootPath);
      }
    }
    return owners.sort(compareText);
  }

  removeRoot(rootPath: string): void {
    this.roots.delete(fileUri(rootPath));
  }
}
