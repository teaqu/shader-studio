import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Messenger } from "./transport/Messenger";
import { Logger } from "./services/Logger";
import { isGlslDocument } from "./GlslFileTracker";
import { ShaderConfigProcessor } from "./ShaderConfigProcessor";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import type { ShaderConfig, ShaderSourceMessage } from "@shader-studio/types";

export class ShaderProvider {
  private logger = Logger.getInstance();
  private activeShaders: Set<string> = new Set(); // Track currently active shader paths
  private configProcessor: ShaderConfigProcessor;
  private getDebugModeEnabled: () => boolean;

  constructor(
    private messenger: Messenger,
    getDebugModeEnabled?: () => boolean
  ) {
    this.configProcessor = new ShaderConfigProcessor(this.messenger.getErrorHandler());
    this.getDebugModeEnabled = getDebugModeEnabled || (() => false);
  }

  public sendShaderToWebview(
    editor: vscode.TextEditor,
    options?: { forceCleanup?: boolean },
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
    const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);

    // Always update the shader - no change detection
    this.logger.debug(`Sending shader update for ${shaderPath}`);
    this.logger.debug(
      `Sending ${Object.keys(buffers).length} buffer(s)`,
    );

    // Build path map for resource URIs
    const pathMap = this.buildPathMap(config, shaderPath);

    const message: ShaderSourceMessage = {
      type: "shaderSource",
      code,
      config,
      path: shaderPath,
      buffers,
      forceCleanup: options?.forceCleanup,
      pathMap,
    };

    // Only include cursor position if debug mode is enabled
    if (this.getDebugModeEnabled()) {
      const line = editor.selection.active.line;
      const character = editor.selection.active.character;
      const lineContent = editor.document.lineAt(line).text;

      message.cursorPosition = {
        line,
        character,
        lineContent,
        filePath: shaderPath,
      };
    }

    this.messenger.send(message);
    this.logger.debug("Shader message sent to webview");

    // Track this shader as active
    this.activeShaders.add(shaderPath);
  }

  public async sendShaderFromPath(
    shaderPath: string,
    options?: { forceCleanup?: boolean },
  ): Promise<void> {
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
      const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);

      // Always update the shader - no change detection
      this.logger.debug(`Sending shader update for ${shaderPath}`);
      this.logger.debug(
        `Sending ${Object.keys(buffers).length} buffer(s)`,
      );

      // Build path map for resource URIs
      const pathMap = this.buildPathMap(config, shaderPath);

      const message: ShaderSourceMessage = {
        type: "shaderSource",
        code,
        config,
        path: shaderPath,
        buffers,
        forceCleanup: options?.forceCleanup,
        pathMap,
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
   * Build a path map for converting resource paths to webview URIs
   */
  private buildPathMap(config: ShaderConfig | null, shaderPath: string): Record<string, string> {
    const pathMap: Record<string, string> = {};

    if (!config) {
      return pathMap;
    }

    try {
      const configDir = path.dirname(shaderPath);
      const webview = this.messenger.getWebview();

      if (!webview) {
        return pathMap;
      }

      // Collect all texture/video paths and convert them
      for (const passName of Object.keys(config.passes || {})) {
        const pass = config.passes[passName as keyof typeof config.passes];
        if (pass && typeof pass === 'object' && 'inputs' in pass) {
          const inputs = pass.inputs;
          if (inputs) {
            for (const key of Object.keys(inputs)) {
              const input = inputs[key as keyof typeof inputs];
              if (input && typeof input === 'object' && 'path' in input && input.path) {
                const originalPath = input.path as string;
                // Resolve relative path to absolute
                const absolutePath = path.isAbsolute(originalPath)
                  ? originalPath
                  : path.join(configDir, originalPath);
                // Convert to webview URI
                const webviewUri = ConfigPathConverter.convertUriForClient(absolutePath, webview);
                pathMap[originalPath] = webviewUri;
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to build path map: ${error}`);
    }

    return pathMap;
  }

  /**
   * Check if the given file path is used as a common buffer in any currently active shader config
   */
  private isCommonBufferFile(shaderPath: string): boolean {
    try {
      // Check only currently active shaders
      for (const activeShaderPath of this.activeShaders) {
        const config = this.configProcessor.loadAndProcessConfig(activeShaderPath, {});
        
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
        const config = this.configProcessor.loadAndProcessConfig(activeShaderPath, {});
        // Check if this active shader uses the commonBufferPath as common
        if (config?.passes?.common?.path === commonBufferPath) {
          // Collect buffer contents (including the updated common buffer)
          const buffers: Record<string, string> = {};
          this.configProcessor.processConfig(config, activeShaderPath, buffers);

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

          // Build path map for resource URIs
          const pathMap = this.buildPathMap(config, activeShaderPath);

          const message: ShaderSourceMessage = {
            type: "shaderSource",
            code: imageCode,
            config,
            path: activeShaderPath,
            buffers,
            pathMap,
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
