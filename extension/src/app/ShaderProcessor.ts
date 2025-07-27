import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Messenger } from "./transport/Messenger";
import { Logger } from "./services/Logger";
import type { ShaderConfig, ShaderSourceMessage } from "@shader-view/types";

export class ShaderProcessor {
  private shaderBuffersMap = new Map<string, Set<string>>();
  private logger = Logger.getInstance();

  constructor(private messenger: Messenger) {}

  public sendShaderToWebview(
    editor: vscode.TextEditor,
  ): void {
    if (!this.messenger || editor?.document.languageId !== "glsl") {
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

    let config: ShaderConfig | null = null;
    const configPath = shaderPath.replace(/\.glsl$/i, ".sv.json");

    // Collect buffer contents
    const buffers: Record<string, string> = {};

    if (fs.existsSync(configPath)) {
      try {
        // Use the latest config from disk
        const configRaw = fs.readFileSync(configPath, "utf-8");
        config = JSON.parse(configRaw);

        // Process buffers
        if (config) {
          this.processBuffers(config, shaderPath, buffers);
        }
      } catch (e) {
        vscode.window.showWarningMessage(
          `Failed to parse config: ${configPath}`,
        );
        config = null;
      }
    }

    // Track buffer files used by this shader
    if (config) {
      this.updateShaderBuffersMap(config, shaderPath);
    }

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

  private processBuffers(
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

      // Process inputs
      if (pass.inputs && typeof pass.inputs === "object") {
        this.processInputs(pass, passName, shaderPath);
      }
    }
  }

  private processBufferPath(
    pass: any,
    passName: string,
    shaderPath: string,
    buffers: Record<string, string>,
  ): void {
    const bufferPath = path.isAbsolute(pass.path)
      ? pass.path
      : path.join(path.dirname(shaderPath), pass.path);

    // Check if we have this buffer in memory first
    const bufferDoc = vscode.workspace.textDocuments.find(
      (doc) => doc.fileName === bufferPath,
    );

    this.logger.debug(
      `Processing buffer for pass ${passName}: ${bufferPath}`,
    );
    this.logger.debug(`Buffer file name: ${path.basename(bufferPath)}`);

    if (bufferDoc) {
      // Get content from memory directly
      const bufferContent = bufferDoc.getText();
      this.logger.debug(bufferContent);
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
      }
    }

    pass.path = bufferPath;
  }

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
        const imgPath = path.isAbsolute(input.path)
          ? input.path
          : path.join(path.dirname(shaderPath), input.path);

        if (fs.existsSync(imgPath)) {
          input.path = imgPath;
          this.logger.debug(
            `Resolved image path for ${passName}.inputs.${key}: ${imgPath}`,
          );
        } else {
          this.logger.warn(
            `Image not found for ${passName}.inputs.${key}: ${imgPath}`,
          );
        }
      }
    }
  }

  private updateShaderBuffersMap(
    config: ShaderConfig,
    shaderPath: string,
  ): void {
    const bufferFiles = new Set<string>();

    if (!config.passes) {
      this.shaderBuffersMap.set(shaderPath, bufferFiles);
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
      if ("path" in pass && pass.path && typeof pass.path === "string") {
        const bufferPath = path.isAbsolute(pass.path)
          ? pass.path
          : path.join(path.dirname(shaderPath), pass.path);

        bufferFiles.add(bufferPath);
      }
    }

    this.shaderBuffersMap.set(shaderPath, bufferFiles);
  }
}
