import * as vscode from "vscode";
import * as path from "path";
import type { ShaderConfig } from "@shader-studio/types";

/**
 * Utility for converting config paths to webview URIs.
 * Shared between WebviewTransport and ShaderExplorerProvider.
 */
export class ConfigPathConverter {
  /**
   * Process a message config to add resolved_path (webview URI) alongside original path.
   * The original path is preserved for display in the UI config panel.
   */
  public static processConfigPaths(
    message: { type: string; config: ShaderConfig; path?: string; [key: string]: any },
    webview: vscode.Webview,
    options: { skipVideoProcessing?: boolean } = {}
  ): typeof message {
    // Clone the message to avoid modifying the original
    const processedMessage = JSON.parse(JSON.stringify(message));
    const config = processedMessage.config;

    if (!config?.passes) {
      return processedMessage;
    }

    // Use the shader path's directory to resolve relative paths
    const configDir = processedMessage.path ? path.dirname(processedMessage.path) : '';

    // Process all passes in the passes object
    for (const passName of Object.keys(config.passes) as Array<keyof typeof config.passes>) {
      const pass = config.passes[passName];
      if (!pass || typeof pass !== "object") {
        continue;
      }

      // Process inputs for texture paths
      if (pass.inputs && typeof pass.inputs === "object") {
        for (const key of Object.keys(pass.inputs)) {
          const input = pass.inputs[key as keyof typeof pass.inputs];
          if (input && input.path) {
            if (input.type === "texture" || (input.type === "video" && !options.skipVideoProcessing)) {
              // Resolve relative path to absolute before converting to webview URI
              const absolutePath = path.isAbsolute(input.path)
                ? input.path
                : path.join(configDir, input.path);
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
