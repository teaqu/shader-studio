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
        const currentCode = openDoc.getText();
        if (currentCode === code) {
          return;
        }

        const replacement = this.getMinimalReplacement(openDoc, currentCode, code);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, replacement.range, replacement.text);
        const applied = await vscode.workspace.applyEdit(edit);
        this.logger.debug(`WorkspaceEdit applied: ${applied}`);
      } else {
        // File not open — write directly to disk
        // Without an open TextDocument, VS Code won't emit a change event for us.
        // Refresh from disk so overlay edits still take effect.
        this.logger.debug(`No open document, writing directly to file`);
        fs.writeFileSync(filePath, code, 'utf-8');
        await vscode.commands.executeCommand('shader-studio.refreshSpecificShaderByPath', filePath);
      }
    } catch (error) {
      this.logger.error(`Failed to update shader source: ${error}`);
    }
  }

  public async handleRequestFileContents(
    payload: { bufferName: string; shaderPath: string },
    respondFn: (msg: any) => void,
  ): Promise<void> {
    try {
      const { bufferName, shaderPath: mainShaderPath } = payload;
      if (!mainShaderPath || !bufferName) {
        return;
      }

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
        respondFn({
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

      respondFn({
        type: 'fileContents',
        payload: { code, path: bufferFilePath, bufferName },
      });

      this.logger.info(`Sent file contents for ${bufferName}: ${bufferFilePath}`);
    } catch (error) {
      this.logger.error(`Failed to read file contents: ${error}`);
    }
  }

  private getMinimalReplacement(
    document: vscode.TextDocument,
    currentCode: string,
    nextCode: string,
  ): { range: vscode.Range; text: string } {
    let prefixLength = 0;
    const maxPrefixLength = Math.min(currentCode.length, nextCode.length);
    while (
      prefixLength < maxPrefixLength
      && currentCode.charCodeAt(prefixLength) === nextCode.charCodeAt(prefixLength)
    ) {
      prefixLength++;
    }

    let currentSuffixLength = currentCode.length;
    let nextSuffixLength = nextCode.length;
    while (
      currentSuffixLength > prefixLength
      && nextSuffixLength > prefixLength
      && currentCode.charCodeAt(currentSuffixLength - 1) === nextCode.charCodeAt(nextSuffixLength - 1)
    ) {
      currentSuffixLength--;
      nextSuffixLength--;
    }

    return {
      range: new vscode.Range(
        document.positionAt(prefixLength),
        document.positionAt(currentSuffixLength),
      ),
      text: nextCode.slice(prefixLength, nextSuffixLength),
    };
  }
}
