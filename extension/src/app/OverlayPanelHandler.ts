import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";

export class OverlayPanelHandler {
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
  }

  public async handleUpdateShaderSource(payload: { code: string; path: string }): Promise<void> {
    try {
      const filePath = payload?.path;
      const code = payload?.code;
      this.logger.info(`Updating shader source: ${filePath} (${code?.length ?? 0} chars)`);

      if (!filePath || !code) {
        this.logger.warn(`Missing path or code in updateShaderSource payload`);
        return;
      }

      // Try to find an open TextDocument for this file
      const uri = vscode.Uri.file(filePath);
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === uri.fsPath
      );

      if (openDoc) {
        // Apply edit via WorkspaceEdit to update the open document
        this.logger.debug(`Found open document, applying WorkspaceEdit`);
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          openDoc.positionAt(0),
          openDoc.positionAt(openDoc.getText().length)
        );
        edit.replace(uri, fullRange, code);
        const applied = await vscode.workspace.applyEdit(edit);
        this.logger.debug(`WorkspaceEdit applied: ${applied}`);
        if (applied) {
          await openDoc.save();
          this.logger.debug(`Document saved`);
        }
      } else {
        // File not open — write directly to disk
        // The UI handles recompilation directly, so no need to trigger a shader refresh
        this.logger.debug(`No open document, writing directly to file`);
        fs.writeFileSync(filePath, code, 'utf-8');
      }
    } catch (error) {
      this.logger.error(`Failed to update shader source: ${error}`);
    }
  }

  public async handleRequestFileContents(
    payload: { bufferName: string; shaderPath: string },
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    try {
      const { bufferName, shaderPath: mainShaderPath } = payload;
      if (!mainShaderPath || !bufferName) return;

      // Load the config to find the buffer's relative path
      const configPath = mainShaderPath.replace(/\.(glsl|frag)$/, '.sha.json');
      if (!fs.existsSync(configPath)) {
        this.logger.warn(`Config file not found: ${configPath}`);
        return;
      }

      const configText = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configText);
      const pass = config?.passes?.[bufferName];
      if (!pass?.path) {
        this.logger.warn(`No path found for buffer ${bufferName}`);
        return;
      }

      // Resolve the buffer file path relative to the main shader
      const shaderDir = path.dirname(mainShaderPath);
      const bufferFilePath = path.resolve(shaderDir, pass.path);

      if (!fs.existsSync(bufferFilePath)) {
        this.logger.warn(`Buffer file not found: ${bufferFilePath}`);
        panel.webview.postMessage({
          type: 'fileContents',
          payload: { code: '', path: bufferFilePath, bufferName },
        });
        return;
      }

      // Prefer in-memory document if open
      const uri = vscode.Uri.file(bufferFilePath);
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === uri.fsPath,
      );
      const code = openDoc ? openDoc.getText() : fs.readFileSync(bufferFilePath, 'utf-8');

      panel.webview.postMessage({
        type: 'fileContents',
        payload: { code, path: bufferFilePath, bufferName },
      });

      this.logger.info(`Sent file contents for ${bufferName}: ${bufferFilePath}`);
    } catch (error) {
      this.logger.error(`Failed to read file contents: ${error}`);
    }
  }
}
