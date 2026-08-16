import * as vscode from "vscode";
import { MessageEvent, LogMessage, DebugMessage, ErrorMessage, WarningMessage, RefreshMessage, GenerateConfigMessage, ShowConfigMessage, ShaderSourceMessage, DebugModeStateMessage, ShaderLockStateMessage } from "@shader-studio/types";
import { PathResolver } from "../PathResolver";
import { ErrorHandler } from "../ErrorHandler";

export class MessageHandler {
  private errorHandler: ErrorHandler;
  private onDebugModeChanged?: (enabled: boolean) => void;
  private onShaderLockChanged?: (lockedShaderPath?: string) => void;

  constructor(
    private outputChannel: vscode.LogOutputChannel,
    errorHandler: ErrorHandler,
    onDebugModeChanged?: (enabled: boolean) => void,
    onShaderLockChanged?: (lockedShaderPath?: string) => void,
  ) {
    this.errorHandler = errorHandler;
    this.onDebugModeChanged = onDebugModeChanged;
    this.onShaderLockChanged = onShaderLockChanged;
  }

  public handleMessage(message: MessageEvent): void {
    try {
      // Track current shader configuration when we receive shader source
      if (message.type === "shaderSource") {
        const shaderMsg = message as ShaderSourceMessage;
        const shaderConfig = {
          config: shaderMsg.config,
          shaderPath: shaderMsg.path,
          bufferPathMap: shaderMsg.bufferPathMap,
        };
        this.errorHandler.setShaderConfig(shaderConfig);
      }
      
      switch (message.type) {
        case "log":
          this.handleLogMessage(message);
          break;
        case "debug":
          this.handleDebugMessage(message);
          break;
        case "error": {
          const errorMessage = message as ErrorMessage;
          const errors = Array.isArray(errorMessage.payload)
            ? errorMessage.payload
            : [errorMessage.payload];
          const reportableErrors = errors.filter(
            (error) => !isMissingMainImageRenderabilityError(error),
          );
          if (reportableErrors.length > 0) {
            this.errorHandler.handleError({
              ...errorMessage,
              payload: reportableErrors,
            });
          }
          break;
        }
        case "warning":
          this.errorHandler.handlePersistentError(message as WarningMessage);
          break;
        case "refresh":
          this.handleRefreshMessage(message);
          break;
        case "generateConfig":
          this.handleGenerateConfigMessage(message);
          break;
        case "showConfig":
          this.handleShowConfigMessage(message);
          break;
        case "debugModeState":
          this.handleDebugModeStateMessage(message);
          break;
        case "shaderLockState":
          this.handleShaderLockStateMessage(message);
          break;
        default:
          this.outputChannel.debug(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('MessageHandler: Error processing message:', error);
      console.error('Message:', message);
      const errorMessage = error ? String(error) : 'Unknown error';
      if (errorMessage && errorMessage.trim()) {
        this.outputChannel.error(`Message handling error: ${errorMessage}`);
      }
    }
  }

  private handleLogMessage(message: LogMessage): void {
    const logText = Array.isArray(message.payload)
      ? message.payload.join(" ")
      : message.payload;
    this.outputChannel.debug(logText);

    // Clear errors for any success message (shader compilation or buffer updates)
    if (
      logText.includes("Shader compiled and linked") ||
      logText.includes("updated and pipeline recompiled")
    ) {
      this.errorHandler.clearErrors();
    }
  }

  private handleDebugMessage(message: DebugMessage): void {
    const debugText = Array.isArray(message.payload)
      ? message.payload.join(" ")
      : message.payload;
    this.outputChannel.debug(debugText);
  }

  private handleRefreshMessage(message: RefreshMessage): void {
    this.outputChannel.info("Refresh request received from UI");

    const shaderPath = message.payload?.path;
    if (shaderPath) {
      this.outputChannel.info(`Requesting refresh for shader at path: ${shaderPath}`);
      vscode.commands.executeCommand('shader-studio.refreshSpecificShaderByPath', shaderPath);
    } else {
      this.outputChannel.info("Requesting refresh for current/active shader");
      vscode.commands.executeCommand('shader-studio.refreshCurrentShader');
    }
  }

  private handleGenerateConfigMessage(message: GenerateConfigMessage): void {
    this.outputChannel.info("Generate config request received from UI");

    const shaderPath = message.payload?.shaderPath;
    if (shaderPath) {
      this.outputChannel.info(`Requesting config generation for shader at path: ${shaderPath}`);
      vscode.commands.executeCommand('shader-studio.generateConfigFromUI', vscode.Uri.file(shaderPath));
    } else {
      this.outputChannel.info("Requesting config generation for current/last viewed shader");
      vscode.commands.executeCommand('shader-studio.generateConfigFromUI');
    }
  }

  private handleShowConfigMessage(message: ShowConfigMessage): void {
    this.outputChannel.info("Show config request received from UI");

    const configPath = message.payload?.shaderPath;
    if (configPath) {
      this.outputChannel.info(`Requesting to open config at path: ${configPath}`);

      // Check if config file exists
      const fs = require('fs');
      if (fs.existsSync(configPath)) {
        // Open the existing config file
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(configPath));
        this.outputChannel.info(`Opened existing config file: ${configPath}`);
      } else {
        // Config doesn't exist, generate it
        this.outputChannel.info(`Config file not found: ${configPath}, generating new config`);
        // Convert config path back to shader path
        const shaderPath = message.payload.sourcePath
          ?? configPath.replace(/\.sha\.json$/, '.glsl');
        vscode.commands.executeCommand('shader-studio.generateConfigFromUI', vscode.Uri.file(shaderPath));
      }
    } else {
      this.outputChannel.info("No config path provided, requesting config generation");
      vscode.commands.executeCommand('shader-studio.generateConfigFromUI');
    }
  }

  private handleDebugModeStateMessage(message: DebugModeStateMessage): void {
    const enabled = message.payload.enabled;
    this.outputChannel.info(`Debug mode state changed: ${enabled ? 'enabled' : 'disabled'}`);

    if (this.onDebugModeChanged) {
      this.onDebugModeChanged(enabled);
    }
  }

  private handleShaderLockStateMessage(message: ShaderLockStateMessage): void {
    const lockedShaderPath = message.payload.lockedShaderPath;
    this.outputChannel.info(
      lockedShaderPath ? `Shader locked: ${lockedShaderPath}` : "Shader unlocked",
    );
    this.onShaderLockChanged?.(lockedShaderPath);
  }
}

function isMissingMainImageRenderabilityError(errorText: string): boolean {
  const text = errorText.trim();
  return /(?:^|:\s*)missing mainImage function$/i.test(text)
    || /(?:^|:\s*)entry points? not found \(is [`'"]?mainImage[`'"]? defined\?\)$/i.test(text)
    || /(?:^|:\s*)the Slang workspace root has no mainImage or supported compute entry function\.$/i.test(text)
    || /^(?:[^:\n]+:\s*)*(?:ERROR:\s*)?(?:\d+:\d+:\s*)?[`'"]?mainImage[`'"]?\s*:\s*no matching overloaded function found$/i.test(text);
}
