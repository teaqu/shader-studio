import * as vscode from "vscode";
import * as fs from "fs";
import { Messenger } from "./transport/Messenger";
import { Logger } from "./services/Logger";
import { isGlslDocument } from "./GlslFileTracker";
import { ShaderConfigProcessor } from "./ShaderConfigProcessor";
import type { ShaderConfig, ShaderSourceMessage } from "@shader-studio/types";

export class ShaderProvider {
  private logger = Logger.getInstance();
  private activeShaders: Set<string> = new Set(); // Track currently active shader paths

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
    const shaderPath = editor.document.uri.fsPath;

    // Check if this file is a common buffer (referenced as common in any config)
    // This check should happen BEFORE the mainImage check
    if (this.isCommonBufferFile(shaderPath)) {
      this.logger.debug(`common buffer file updated: ${shaderPath}. Updating previewed shaders that use it...`);
      this.updatePreviewedShadersUsingCommonBuffer(shaderPath);
      return;
    }

    // For regular shaders, check for mainImage function
    if (!code.includes("mainImage")) {
      vscode.window.showWarningMessage(
        "GLSL file ignored: missing mainImage function.",
      );
      return;
    }

    // Collect buffer contents
    const buffers: Record<string, string> = {};

    // Load and process config
    const config = ShaderConfigProcessor.loadAndProcessConfig(shaderPath, buffers, this.messenger.getErrorHandler());

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

    // Track this shader as active
    this.activeShaders.add(shaderPath);
  }

  public async sendShaderFromPath(shaderPath: string): Promise<void> {
    if (!this.messenger) {
      return;
    }

    try {
      if (!fs.existsSync(shaderPath)) {
        return;
      }

      const code = fs.readFileSync(shaderPath, "utf-8");

      // Ignore GLSL files that do not contain mainImage
      if (!code.includes("mainImage")) {
        vscode.window.showWarningMessage(
          "GLSL file ignored: missing mainImage function.",
        );
        return;
      }

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
    } catch {
      return;
    }
  }

  /**
   * Remove a shader from the active tracking set
   */
  public removeActiveShader(shaderPath: string): void {
    this.activeShaders.delete(shaderPath);
  }

  /**
   * Check if the given file path is used as a common buffer in any currently active shader config
   */
  private isCommonBufferFile(shaderPath: string): boolean {
    try {
      // Check only currently active shaders
      for (const activeShaderPath of this.activeShaders) {
        const config = ShaderConfigProcessor.loadAndProcessConfig(activeShaderPath, {}, this.messenger.getErrorHandler());
        
        // Check both "common" and "CommonBuffer" keys for backward compatibility
        if (config?.passes?.common?.path === shaderPath) {
          return true;
        }
      }
    } catch (e) {
      this.logger.warn('Failed to check for common buffer usage in active shaders');
    }

    return false;
  }

  /**
   * Update only the currently active shaders that use the given common buffer
   */
  private updatePreviewedShadersUsingCommonBuffer(commonBufferPath: string): void {
    for (const activeShaderPath of this.activeShaders) {
      try {
        const config = ShaderConfigProcessor.loadAndProcessConfig(activeShaderPath, {}, this.messenger.getErrorHandler());
        // Check if this active shader uses the commonBufferPath as common
        if (config?.passes?.common?.path === commonBufferPath) {
          // Collect buffer contents (including the updated common buffer)
          const buffers: Record<string, string> = {};
          ShaderConfigProcessor.processConfig(config, activeShaderPath, buffers, this.messenger.getErrorHandler());

          // Read the main shader file directly to ensure we have the correct Image code
          let imageCode = "";
          try {
            // For Image pass, the code is the main shader file itself
            // Read the active shader file directly
            const fs = require('fs');
            imageCode = fs.readFileSync(activeShaderPath, 'utf8');
          } catch (e) {
            this.logger.warn(`Failed to read Image shader for ${activeShaderPath}: ${e}`);
            imageCode = buffers.Image || "";
          }

          const message: ShaderSourceMessage = {
            type: "shaderSource",
            code: imageCode,
            config,
            path: activeShaderPath,
            buffers,
          };

          this.messenger.send(message);
          this.logger.debug(`Updated active shader: ${activeShaderPath}`);
        }
      } catch (e) {
        this.logger.warn(`Failed to update active shader using common buffer: ${activeShaderPath}`);
      }
    }
  }
}
