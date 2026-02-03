import * as vscode from "vscode";
import * as fs from "fs";
import { PathResolver } from "./PathResolver";
import { Logger } from "./services/Logger";
import { Constants } from "./Constants";
import type { ShaderConfig } from "@shader-studio/types";
import type { ErrorHandler } from "./ErrorHandler";

const noopErrorHandler = {
  handleError: () => {},
  handlePersistentError: () => {},
};

/**
 * Shared utility for processing shader configurations.
 * Used by both ShaderProvider and Shader ExplorerProvider.
 */
export class ShaderConfigProcessor {
  private logger = Logger.getInstance();
  private errorHandler: Pick<ErrorHandler, 'handleError' | 'handlePersistentError'>;

  constructor(errorHandler?: ErrorHandler) {
    this.errorHandler = errorHandler || noopErrorHandler;
  }

  /**
   * Load and process a shader configuration file.
   * Returns the config and buffers, or null if config doesn't exist or fails to load.
   * If the config file is open in an editor, reads from the editor to capture unsaved changes.
   */
  public loadAndProcessConfig(
    shaderPath: string,
    buffers: Record<string, string>,
  ): ShaderConfig | null {
    const configPath = ShaderConfigProcessor.getConfigPath(shaderPath);

    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      // Check if config file is open in an editor (to capture unsaved changes)
      const configDocument = vscode.workspace.textDocuments.find(
        doc => doc.uri.fsPath === configPath
      );
      
      const configContent = configDocument 
        ? configDocument.getText() 
        : fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      if (config) {
        this.processConfig(config, shaderPath, buffers);
      }

      return config;
    } catch (e) {
      this.logger.warn(`Failed to parse config: ${configPath}`);
      this.errorHandler.handleError({
        type: 'error',
        payload: [`Failed to parse config: ${configPath}`]
      });
      return null;
    }
  }

  /**
   * Get the config file path for a shader file.
   */
  public static getConfigPath(shaderPath: string): string {
    return shaderPath.replace(/\.(glsl|frag)$/i, Constants.CONFIG_FILE_EXTENSION);
  }

  /**
   * Process buffers and inputs in a shader config.
   * Resolves buffer paths, loads buffer content, and resolves texture input paths.
   */
  public processConfig(
    config: ShaderConfig,
    shaderPath: string,
    buffers: Record<string, string>,
  ): void {
    if (!config.passes) {
      return;
    }

    for (
      const passName of Object.keys(config.passes) as Array<
        keyof typeof config.passes
      >
    ) {
      const pass = config.passes[passName];
      if (!pass || typeof pass !== "object") {
        continue;
      }

      // Process pass-level "path" (for buffer source files)
      if ("path" in pass && pass.path && typeof pass.path === "string") {
        this.processBufferPath(pass, passName, shaderPath, buffers);
      }

      // Process inputs - resolve texture paths to absolute paths
      if (pass.inputs && typeof pass.inputs === "object") {
        this.processInputs(pass, passName, shaderPath);
      }
    }
  }

  /**
   * Process a buffer path for a shader pass.
   * Resolves the path and loads the buffer content from memory or disk.
   */
  private processBufferPath(
    pass: any,
    passName: string,
    shaderPath: string,
    buffers: Record<string, string>,
  ): void {
    const bufferPath = PathResolver.resolvePath(shaderPath, pass.path);

    // Check if we have this buffer in memory first
    const bufferDoc = vscode.workspace.textDocuments.find(
      (doc) => doc.fileName === bufferPath,
    );

    this.logger.debug(
      `Processing buffer for pass ${passName}: ${bufferPath}`,
    );

    if (bufferDoc) {
      // Get content from memory directly
      const bufferContent = bufferDoc.getText();
      buffers[passName] = bufferContent;
      this.logger.debug(
        `Loaded buffer content from memory for ${passName}`,
      );
    } else if (fs.existsSync(bufferPath)) {
      // Read buffer file content from disk
      try {
        const bufferContent = fs.readFileSync(bufferPath, "utf-8");
        buffers[passName] = bufferContent;
        this.logger.debug(
          `Loaded buffer content from disk for ${passName}: ${bufferPath}`,
        );
      } catch (e) {
        this.logger.warn(
          `Failed to read buffer content for ${passName}: ${bufferPath}`,
        );
        this.errorHandler.handleError({
          type: 'error',
          payload: [`Failed to read buffer file: ${bufferPath}`]
        });
      }
    } else {
      // File not found
      this.errorHandler.handlePersistentError({
        type: 'error',
        payload: [`Buffer file not found: ${bufferPath}`]
      });
    }

    pass.path = bufferPath;
  }

  /**
   * Process texture inputs in a shader pass.
   * Resolves relative texture paths to absolute paths.
   */
  private processInputs(
    pass: any,
    passName: string,
    shaderPath: string,
  ): void {
    if (!pass.inputs) {
      return;
    }

    for (const key of Object.keys(pass.inputs)) {
      const input = pass.inputs[key];
      if (input.type === "texture" && input.path) {
        const imgPath = PathResolver.resolvePath(shaderPath, input.path);

        if (fs.existsSync(imgPath)) {
          input.path = imgPath;
          this.logger.debug(
            `Resolved image path for ${passName}.inputs.${key}: ${imgPath}`,
          );
        } else {
          this.errorHandler.handlePersistentError({
            type: 'error',
            payload: [`Texture file not found: ${imgPath}`]
          });
        }
      } else if (input.type === "video" && input.path) {
        const videoPath = PathResolver.resolvePath(shaderPath, input.path);

        if (fs.existsSync(videoPath)) {
          input.path = videoPath;
          this.logger.debug(
            `Resolved video path for ${passName}.inputs.${key}: ${videoPath}`,
          );
        } else {
          this.errorHandler.handlePersistentError({
            type: 'error',
            payload: [`Video file not found: ${videoPath}`]
          });
        }
      }
    }
  }
}
