import * as vscode from "vscode";
import type { ShaderConfig } from "@shader-studio/types";

/**
 * Utility for converting config paths to webview URIs.
 * Shared between WebviewTransport and ShaderBrowserProvider.
 */
export class ConfigPathConverter {
  /**
   * Process a message config to convert absolute texture paths to webview URIs.
   */
  public static processConfigPaths(
    message: { type: string; config: ShaderConfig; [key: string]: any },
    webview: vscode.Webview
  ): typeof message {
    console.log(`ConfigPathConverter: Processing config paths for message type: ${message.type}`);
    
    // Clone the message to avoid modifying the original
    const processedMessage = JSON.parse(JSON.stringify(message));
    const config = processedMessage.config;

    if (!config?.passes) {
      console.log(`ConfigPathConverter: No passes found in config`);
      return processedMessage;
    }

    console.log(`ConfigPathConverter: Processing ${Object.keys(config.passes).length} passes`);

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
            if (input.type === "texture") {
              console.log(`ConfigPathConverter: Found ${input.type} input: ${input.path}`);
              input.path = this.convertUriForClient(input.path, webview);
            } else if (input.type === "video") {
              console.log(`ConfigPathConverter: Found video input, leaving path as-is for video handling: ${input.path}`);
              // Don't convert video paths - let the transport handle them
              // Videos need special handling (file:// or HTTP) not webview URIs
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
      console.log(`ConfigPathConverter: Converting path: ${filePath}`);
      const webviewUri = webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
      console.log(`ConfigPathConverter: File converted to webview URI: ${webviewUri}`);
      return webviewUri;
    } catch (error) {
      console.error(`ConfigPathConverter: Error converting ${filePath}:`, error);
      return filePath;
    }
  }
}
