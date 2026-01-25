import * as vscode from "vscode";
import * as fs from "fs";
import { PathResolver } from "./PathResolver";
import { Logger } from "./services/Logger";
import { Constants } from "./Constants";
import type { ShaderConfig, ErrorMessage } from "@shader-studio/types";

/**
 * Shared utility for processing shader configurations.
 * Used by both ShaderProvider and ShaderBrowserProvider.
 */
export class ShaderConfigProcessor {
  private static getLogger(): Logger {
    return Logger.getInstance();
  }

  /**
   * Load and process a shader configuration file.
   * Returns the config and buffers, or null if config doesn't exist or fails to load.
   */
  public static loadAndProcessConfig(
    shaderPath: string,
    buffers: Record<string, string>,
    errorHandler?: { handleError: (message: ErrorMessage) => void; handlePersistentError?: (message: ErrorMessage) => void },
  ): ShaderConfig | null {
    const configPath = this.getConfigPath(shaderPath);

    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      if (config) {
        this.processConfig(config, shaderPath, buffers, errorHandler);
      }

      return config;
    } catch (e) {
      this.getLogger().warn(`Failed to parse config: ${configPath}`);
      // Send error to ErrorHandler instead of showing popup
      errorHandler?.handleError({
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
  public static processConfig(
    config: ShaderConfig,
    shaderPath: string,
    buffers: Record<string, string>,
    errorHandler?: { handleError: (message: ErrorMessage) => void; handlePersistentError?: (message: ErrorMessage) => void },
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
        this.processBufferPath(pass, passName, shaderPath, buffers, errorHandler);
      }

      // Process inputs - resolve texture paths to absolute paths
      if (pass.inputs && typeof pass.inputs === "object") {
        this.processInputs(pass, passName, shaderPath, errorHandler);
      }
    }
  }

  /**
   * Process a buffer path for a shader pass.
   * Resolves the path and loads the buffer content from memory or disk.
   */
  private static processBufferPath(
    pass: any,
    passName: string,
    shaderPath: string,
    buffers: Record<string, string>,
    errorHandler?: { handleError: (message: ErrorMessage) => void; handlePersistentError?: (message: ErrorMessage) => void },
  ): void {
    const bufferPath = PathResolver.resolvePath(shaderPath, pass.path);

    // Check if we have this buffer in memory first
    const bufferDoc = vscode.workspace.textDocuments.find(
      (doc) => doc.fileName === bufferPath,
    );

    this.getLogger().debug(
      `Processing buffer for pass ${passName}: ${bufferPath}`,
    );

    if (bufferDoc) {
      // Get content from memory directly
      const bufferContent = bufferDoc.getText();
      buffers[passName] = bufferContent;
      this.getLogger().debug(
        `Loaded buffer content from memory for ${passName}`,
      );
    } else if (fs.existsSync(bufferPath)) {
      // Read buffer file content from disk
      try {
        const bufferContent = fs.readFileSync(bufferPath, "utf-8");
        buffers[passName] = bufferContent;
        this.getLogger().debug(
          `Loaded buffer content from disk for ${passName}: ${bufferPath}`,
        );
      } catch (e) {
        this.getLogger().warn(
          `Failed to read buffer content for ${passName}: ${bufferPath}`,
        );
        // Send error to ErrorHandler instead of showing popup
        errorHandler?.handleError({
          type: 'error',
          payload: [`Failed to read buffer file: ${bufferPath}`]
        });
      }
    } else {
      // File not found
      // Send persistent error to ErrorHandler for missing buffer files
      errorHandler?.handlePersistentError?.({
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
  private static processInputs(
    pass: any,
    passName: string,
    shaderPath: string,
    errorHandler?: { handleError: (message: ErrorMessage) => void; handlePersistentError?: (message: ErrorMessage) => void },
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
          this.getLogger().debug(
            `Resolved image path for ${passName}.inputs.${key}: ${imgPath}`,
          );
        } else {
          // Send persistent error to ErrorHandler for missing texture files
          errorHandler?.handlePersistentError?.({
            type: 'error',
            payload: [`Texture file not found: ${imgPath}`]
          });
        }
      }
    }
  }
}
