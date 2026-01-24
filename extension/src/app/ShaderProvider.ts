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
  private activeShaders: Set<string> = new Set(); // Track currently active shader paths

  constructor(private messenger: Messenger) {}

  public async sendShaderToWebview(
    editor: vscode.TextEditor,
  ): Promise<void> {
    if (!this.messenger) {
      return;
    }
    const doc = editor?.document;
    if (!doc || !isGlslDocument(doc)) {
      return;
    }

    const code = editor.document.getText();
    const shaderPath = editor.document.uri.fsPath;

    // Check if this file is a CommonBuffer (referenced as CommonBuffer in any config)
    if (await this.isCommonBufferFile(shaderPath)) {
      this.logger.debug(`CommonBuffer file updated: ${shaderPath}. Updating previewed shaders that use it...`);
      await this.updatePreviewedShadersUsingCommonBuffer(shaderPath);
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
      
      // Track this shader as active
      this.activeShaders.add(shaderPath);
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
   * Check if the given file path is used as a CommonBuffer in any currently active shader config
   */
  private async isCommonBufferFile(shaderPath: string): Promise<boolean> {
    try {
      // Check only currently active shaders
      for (const activeShaderPath of this.activeShaders) {
        const config = ShaderConfigProcessor.loadAndProcessConfig(activeShaderPath, {});
        if (config?.passes?.CommonBuffer?.path === shaderPath) {
          return true;
        }
      }
    } catch (e) {
      this.logger.warn('Failed to check for CommonBuffer usage in active shaders');
    }
    
    return false;
  }

  /**
   * Update only the currently active shaders that use the given CommonBuffer
   */
  private async updatePreviewedShadersUsingCommonBuffer(commonBufferPath: string): Promise<void> {
    try {
      // Check only currently active shaders
      for (const activeShaderPath of this.activeShaders) {
        const config = ShaderConfigProcessor.loadAndProcessConfig(activeShaderPath, {});
        
        // Check if this active shader uses the commonBufferPath as CommonBuffer
        if (config?.passes?.CommonBuffer?.path === commonBufferPath) {
          this.logger.debug(`Updating active shader: ${activeShaderPath}`);
          
          // Re-read the shader file to get the latest content
          try {
            const shaderContent = fs.readFileSync(activeShaderPath, 'utf-8');
            
            // Collect buffer contents (including the updated CommonBuffer)
            const buffers: Record<string, string> = {};
            const dependentConfig = ShaderConfigProcessor.loadAndProcessConfig(activeShaderPath, buffers);
            
            const message: ShaderSourceMessage = {
              type: "shaderSource",
              code: shaderContent,
              config: dependentConfig,
              path: activeShaderPath,
              buffers,
            };
            
            this.messenger.send(message);
            this.logger.debug(`Updated active shader: ${activeShaderPath}`);
          } catch (e) {
            this.logger.warn(`Failed to update active shader ${activeShaderPath}`);
          }
        }
      }
    } catch (e) {
      this.logger.warn('Failed to update active shaders using CommonBuffer');
    }
  }
}
