import * as fs from "fs";
import * as vscode from "vscode";
import { ShaderProvider } from "../ShaderProvider";
import { GlslFileTracker } from "../GlslFileTracker";
import { Messenger } from "../transport/Messenger";
import { Logger } from "../services/Logger";
import type { ShaderConfig, ErrorMessage } from "@shader-studio/types";

export class ConfigUpdateHandler {
  constructor(
    private glslFileTracker: GlslFileTracker,
    private shaderProvider: ShaderProvider,
    private messenger: Messenger | null,
    private logger: Logger,
  ) {}

  async handleConfigUpdate(payload: {
    config: ShaderConfig;
    text: string;
    shaderPath?: string;
    skipRefresh?: boolean;
  }): Promise<void> {
    try {
      let shaderPath = payload.shaderPath;
      if (!shaderPath) {
        const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
        if (!editor) {
          this.logger.warn("No active shader to update config for");
          return;
        }
        shaderPath = editor.document.uri.fsPath;
      }

      const configPath = shaderPath.replace(/\.(glsl|frag)$/, '.sha.json');
      const openDocument = vscode.workspace.textDocuments.find(
        doc => doc.uri.fsPath === configPath,
      );

      let appliedToDocument = false;
      if (openDocument) {
        appliedToDocument = await this.applyToDocument(openDocument, payload.text);
      }

      if (!appliedToDocument) {
        fs.writeFileSync(configPath, payload.text, 'utf-8');
      }

      this.logger.info(`Config updated: ${configPath}`);

      if (payload.skipRefresh) {
        return;
      }

      // When the edit lands in an open TextDocument, the central onDidChangeTextDocument
      // watcher in ShaderStudio handles the refresh. Only schedule a refresh here for
      // the disk-write fallback (no document = no change event).
      if (appliedToDocument) {
        return;
      }

      setTimeout(() => {
        if (typeof (this.shaderProvider as any).sendShaderFromPath === "function") {
          this.shaderProvider.sendShaderFromPath(shaderPath, { forceCleanup: true });
          return;
        }
        this.logger.warn("ShaderProvider missing sendShaderFromPath during config refresh");
      }, 150);
    } catch (error) {
      this.logger.error(`Failed to update config: ${error}`);
      const errorMsg: ErrorMessage = { type: "error", payload: [`Failed to update shader config: ${error}`] };
      this.messenger?.send(errorMsg);
    }
  }

  private async applyToDocument(document: vscode.TextDocument, text: string): Promise<boolean> {
    try {
      const oldText = document.getText();
      if (oldText === text) {
        return true;
      }

      const slice = computeMinimalReplace(oldText, text);
      const edit = new vscode.WorkspaceEdit();
      const range = new vscode.Range(
        document.positionAt(slice.startOffset),
        document.positionAt(slice.endOffsetOld),
      );
      edit.replace(document.uri, range, slice.replacement);
      const ok = await vscode.workspace.applyEdit(edit);
      return ok;
    } catch (err) {
      this.logger.warn(`Failed to apply edit to open config document: ${err}`);
      return false;
    }
  }
}

export function computeMinimalReplace(oldText: string, newText: string): { startOffset: number; endOffsetOld: number; replacement: string } {
  let prefix = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefix < minLen && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  const maxSuffix = minLen - prefix;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  return {
    startOffset: prefix,
    endOffsetOld: oldText.length - suffix,
    replacement: newText.substring(prefix, newText.length - suffix),
  };
}
