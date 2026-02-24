import * as vscode from "vscode";
import * as path from "path";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import type { WorkspaceFileInfo } from "@shader-studio/types";

export class WorkspaceFileScanner {
  public static async scanFiles(
    extensions: string[],
    shaderPath: string,
    webview: vscode.Webview,
  ): Promise<WorkspaceFileInfo[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    const shaderDir = path.dirname(shaderPath);
    const extGlob = extensions.join(",");
    const files: WorkspaceFileInfo[] = [];

    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, `**/*.{${extGlob}}`);
      const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 500);

      for (const uri of uris) {
        const filePath = uri.fsPath;
        const fileName = path.basename(filePath);
        const workspaceRoot = folder.uri.fsPath;
        const relativePath = path.relative(workspaceRoot, filePath);
        const workspacePath = `@/${relativePath.replace(/\\/g, "/")}`;
        const isSameDirectory = path.dirname(filePath) === shaderDir;
        const thumbnailUri = ConfigPathConverter.convertUriForClient(filePath, webview);

        files.push({
          name: fileName,
          workspacePath,
          thumbnailUri,
          isSameDirectory,
        });
      }
    }

    // Sort: same-directory first, then alphabetical by name
    files.sort((a, b) => {
      if (a.isSameDirectory !== b.isSameDirectory) {
        return a.isSameDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return files;
  }
}
