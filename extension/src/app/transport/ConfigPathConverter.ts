import * as vscode from "vscode";
import * as path from "path";
import type { ShaderConfig } from "@shader-studio/types";
import { PathResolver } from "../PathResolver";
import { VideoAudioConverter } from "../services/VideoAudioConverter";

/**
 * Utility for converting config paths to webview URIs.
 * Shared between WebviewTransport and ShaderExplorerProvider.
 */
export class ConfigPathConverter {
  /** Tracks video files the user has chosen to ignore AAC conversion for. */
  private static readonly ignoredVideoFiles: Set<string> = new Set();
  /**
   * Process a message config to add resolved_path (webview URI) alongside original path.
   * The original path is preserved for display in the UI config panel.
   *
   * For video inputs with unsupported audio codecs (e.g. AAC), a notification is shown
   * offering to create a compatible copy with MP3 audio. The video still loads immediately
   * (video plays, but audio won't work until conversion).
   */
  public static async processConfigPaths(
    message: { type: string; config: ShaderConfig; path?: string; [key: string]: any },
    webview: vscode.Webview,
    options: {
      skipVideoProcessing?: boolean;
      videoAudioConverter?: VideoAudioConverter;
      onVideoConverted?: (originalConfigPath: string, convertedAbsolutePath: string) => void;
    } = {}
  ): Promise<typeof message> {
    // Clone the message to avoid modifying the original
    const processedMessage = JSON.parse(JSON.stringify(message));
    const config = processedMessage.config;

    if (!config?.passes) {
      return processedMessage;
    }

    // Use the shader path's directory to resolve relative paths
    const configDir = processedMessage.path ? path.dirname(processedMessage.path) : '';

    // Process all passes in the passes object
    for (const passName of Object.keys(config.passes)) {
      const pass = config.passes[passName];
      if (!pass || typeof pass !== "object") {
        continue;
      }

      // Process inputs for texture paths
      if (pass.inputs && typeof pass.inputs === "object") {
        for (const key of Object.keys(pass.inputs)) {
          const input = pass.inputs[key as keyof typeof pass.inputs];
          if (input && input.path) {
            if (input.type === "texture" || (input.type === "video" && !options.skipVideoProcessing) || input.type === "audio") {
              // Resolve path to absolute (handles @ workspace-relative, absolute, and relative paths)
              const shaderPath = processedMessage.path || '';
              const absolutePath = shaderPath
                ? PathResolver.resolvePath(shaderPath, input.path)
                : (path.isAbsolute(input.path) ? input.path : path.join(configDir, input.path));

              // For video inputs, check for unsupported audio and notify (fire-and-forget)
              if (input.type === "video" && options.videoAudioConverter) {
                this.checkVideoAudio(absolutePath, input.path, options.videoAudioConverter, options.onVideoConverted);
              }

              // Add resolved_path for rendering, keep original path for UI display
              input.resolved_path = this.convertUriForClient(absolutePath, webview);
            }
          }
        }
      }
    }

    return processedMessage;
  }

  /**
   * Check if a video has unsupported audio and show a notification offering conversion.
   * Fire-and-forget — does not block sending the shader.
   */
  private static checkVideoAudio(
    absolutePath: string,
    originalConfigPath: string,
    converter: VideoAudioConverter,
    onVideoConverted?: (originalConfigPath: string, convertedAbsolutePath: string) => void,
  ): void {
    converter.getUnsupportedAudioCodec(absolutePath).then(async (unsupportedCodec) => {
      if (!unsupportedCodec) {
        return;
      }

      // Skip if user previously chose to ignore this file
      if (this.ignoredVideoFiles.has(absolutePath)) {
        return;
      }

      const selection = await vscode.window.showWarningMessage(
        `Video "${path.basename(absolutePath)}" uses ${unsupportedCodec.toUpperCase()} audio which is not supported in VS Code webviews. ` +
        `Audio will not play. Would you like to create a compatible copy with MP3 audio?`,
        'Convert',
        'Ignore'
      );

      if (selection === 'Ignore') {
        this.ignoredVideoFiles.add(absolutePath);
        return;
      }

      if (selection === 'Convert') {
        try {
          const newPath = await converter.convertAudio(absolutePath);
          if (onVideoConverted) {
            onVideoConverted(originalConfigPath, newPath);
            vscode.window.showInformationMessage(
              `Created ${path.basename(newPath)} — config updated automatically.`
            );
          } else {
            vscode.window.showInformationMessage(
              `Created ${path.basename(newPath)} with compatible audio. Update your config to use this file for audio playback.`
            );
          }
        } catch (e) {
          vscode.window.showErrorMessage(
            `Failed to convert video audio: ${e instanceof Error ? e.message : e}`
          );
        }
      }
    }).catch((e) => {
      console.warn(`[ConfigPathConverter] Video audio check failed for ${absolutePath}:`, e);
    });
  }

  /**
   * Convert a file path to a webview URI.
   */
  public static convertUriForClient(filePath: string, webview: vscode.Webview): string {
    try {
      const webviewUri = webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
      return webviewUri;
    } catch (error) {
      console.error(`ConfigPathConverter: Error converting ${filePath}:`, error);
      return filePath;
    }
  }
}
