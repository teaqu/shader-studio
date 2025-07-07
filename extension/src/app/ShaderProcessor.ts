import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parse as parseJSONC } from "jsonc-parser";
import { MessageTransporter } from "./communication/MessageTransporter";

export class ShaderProcessor {
  private shaderBuffersMap = new Map<string, Set<string>>();

  constructor(
    private outputChannel: vscode.LogOutputChannel,
    private messenger: MessageTransporter,
  ) {}

  public sendShaderToWebview(
    editor: vscode.TextEditor,
    isLocked: boolean = false,
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

    const name = path.basename(editor.document.uri.fsPath);
    const shaderPath = editor.document.uri.fsPath;

    // Try to load config from a sibling .config.json file
    let config: any = null;
    const configPath = shaderPath.replace(/\.glsl$/i, ".config.json");

    // Collect buffer contents
    const buffers: Record<string, string> = {};

    if (fs.existsSync(configPath)) {
      try {
        // Use the latest config from disk
        const configRaw = fs.readFileSync(configPath, "utf-8");
        config = parseJSONC(configRaw);

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
    this.outputChannel.debug(`Sending shader update (${name})`);
    this.outputChannel.debug(
      `Sending ${Object.keys(buffers).length} buffer(s)`,
    );

    this.messenger.send({
      type: "shaderSource",
      code,
      config,
      name,
      isLocked,
      buffers,
    });
    this.outputChannel.debug("Shader message sent to webview");
  }

  private processBuffers(
    config: any,
    shaderPath: string,
    buffers: Record<string, string>,
  ): void {
    for (const passName of Object.keys(config)) {
      if (passName === "version") {
        continue;
      }
      const pass = config[passName];
      if (typeof pass !== "object") {
        continue;
      }
      // Process pass-level "path" (for buffer source files)
      if (pass.path && typeof pass.path === "string") {
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

    this.outputChannel.debug(
      `Processing buffer for pass ${passName}: ${bufferPath}`,
    );
    this.outputChannel.debug(`Buffer file name: ${path.basename(bufferPath)}`);

    if (bufferDoc) {
      // Get content from memory directly
      const bufferContent = bufferDoc.getText();
      this.outputChannel.debug(bufferContent);
      buffers[passName] = bufferContent;
      this.outputChannel.debug(
        `Loaded buffer content from memory for ${passName}`,
      );
    } else if (fs.existsSync(bufferPath)) {
      // Read buffer file content from disk
      try {
        const bufferContent = fs.readFileSync(bufferPath, "utf-8");
        buffers[passName] = bufferContent;
        this.outputChannel.debug(
          `Loaded buffer content from disk for ${passName}: ${bufferPath}`,
        );
      } catch (e) {
        this.outputChannel.warn(
          `Failed to read buffer content for ${passName}: ${bufferPath}`,
        );
      }
    }

    // Always update client URI (webview URI for panel, or file path for web server)
    const clientUri = this.messenger.convertUriForClient(bufferPath);
    pass.path = clientUri;
  }

  private processInputs(
    pass: any,
    passName: string,
    shaderPath: string,
  ): void {
    for (const key of Object.keys(pass.inputs)) {
      const input = pass.inputs[key];
      if (input.type && input.path) {
        const imgPath = path.isAbsolute(input.path)
          ? input.path
          : path.join(path.dirname(shaderPath), input.path);
        if (fs.existsSync(imgPath)) {
          const clientUri = this.messenger.convertUriForClient(imgPath);
          input.path = clientUri;
          this.outputChannel.debug(
            `Patched image path for ${passName}.inputs.${key}: ${input.path}`,
          );
        } else {
          this.outputChannel.warn(
            `Image not found for ${passName}.inputs.${key}: ${imgPath}`,
          );
        }
      }
    }
  }

  private updateShaderBuffersMap(config: any, shaderPath: string): void {
    const bufferFiles = new Set<string>();

    for (const passName of Object.keys(config)) {
      if (passName === "version") {
        continue;
      }
      const pass = config[passName];
      if (typeof pass !== "object") {
        continue;
      }
      if (pass.path && typeof pass.path === "string") {
        const bufferPath = path.isAbsolute(pass.path)
          ? pass.path
          : path.join(path.dirname(shaderPath), pass.path);

        bufferFiles.add(bufferPath);
      }
    }

    this.shaderBuffersMap.set(shaderPath, bufferFiles);
  }
}
