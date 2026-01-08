import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Messenger } from "./transport/Messenger";
import { Logger } from "./services/Logger";
import { Constants } from "./Constants";
import { isGlslDocument } from "./GlslFileTracker";
import { PathResolver } from "./PathResolver";
import { ShaderConfigProcessor } from "./ShaderConfigProcessor";
import type { ShaderConfig, ShaderSourceMessage } from "@shader-studio/types";

export class ShaderProvider {
  private logger = Logger.getInstance();

  constructor(private messenger: Messenger) { }

  public sendShaderToWebview(
    editor: vscode.TextEditor,
  ): void {
    if (!this.messenger) {
      return;
    }
    const doc = editor?.document;
    if (!doc || !isGlslDocument(doc)) {
      return;
    }

    const code = editor.document.getText();

    // Ignore GLSL files that do not contain mainImage
    if (!code.includes("mainImage")) {
      vscode.window.showWarningMessage(
        "GLSL file ignored: missing mainImage function.",
      );
      return;
    }

    const shaderPath = editor.document.uri.fsPath;

    // Collect buffer contents
    const buffers: Record<string, string> = {};

    // Load and process config
    const config = ShaderConfigProcessor.loadAndProcessConfig(shaderPath, buffers);

    // Always update the shader - no change detection
    this.logger.debug(`Sending shader update for ${shaderPath}`);
    this.logger.debug(
      `Sending ${Object.keys(buffers).length} buffer(s)`,
    );

    const message: ShaderSourceMessage = {
      type: "shaderSource",
      code,
      config,
      path: shaderPath,
      buffers,
    };

    this.messenger.send(message);
    this.logger.debug("Shader message sent to webview");
  }
}
