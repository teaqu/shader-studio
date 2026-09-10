import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";

export class ShaderCreator {
  private logger: Logger;
  private glslFileTracker: GlslFileTracker;

  constructor(logger: Logger, glslFileTracker: GlslFileTracker) {
    this.logger = logger;
    this.glslFileTracker = glslFileTracker;
  }

  private getShaderTemplate(): string {
    return `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord / iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4));

    // Output to screen
    fragColor = vec4(col, 1.0);
}`;
  }

  private getSlangShaderTemplate(): string {
    return `float4 mainImage(float2 fragCoord)
{
    // Normalized pixel coordinates (from 0 to 1)
    float2 uv = fragCoord / iResolution.xy;

    // Time varying pixel color
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));

    // Output to screen
    return float4(col, 1.0);
}`;
  }

  private getWgslShaderTemplate(): string {
    return `fn mainImage(coord: vec2f) -> vec4f {
    let st = coord / vec2f(iResolution.x, iResolution.y);
    let uv = vec2f(st.x * iResolution.x / iResolution.y, st.y);

    // Time varying pixel color
    let col = vec3f(0.5) + vec3f(0.5) * cos(iTime + vec3f(uv.x, uv.y, uv.x) + vec3f(0.0, 2.0, 4.0));

    // Output to screen
    return vec4f(col, 1.0);
}`;
  }

  private getDefaultUri(): vscode.Uri {
    const lastViewedFile = this.glslFileTracker.getLastViewedGlslFile();
    if (lastViewedFile) {
      return vscode.Uri.file(path.join(path.dirname(lastViewedFile), "shadertoy.glsl"));
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, "shadertoy.glsl"));
    }

    return vscode.Uri.file("shadertoy.glsl");
  }

  async create(): Promise<void> {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: this.getDefaultUri(),
        filters: {
          "GLSL Shader": ["glsl"],
          "Slang Shader": ["slang"],
          "WGSL Shader": ["wgsl"],
        },
        title: "New Shader",
      });

      // User cancelled
      if (!uri) {
        return;
      }

      const filePath = uri.fsPath;

      // Create a basic shader template
      const lowerPath = filePath.toLowerCase();
      const shaderTemplate = lowerPath.endsWith(".slang")
        ? this.getSlangShaderTemplate()
        : lowerPath.endsWith(".wgsl")
          ? this.getWgslShaderTemplate()
          : this.getShaderTemplate();

      // Write the shader file
      fs.writeFileSync(filePath, shaderTemplate);

      // Open the newly created file
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: false,
      });

      this.logger.info(`Created new shader file: ${filePath}`);
      vscode.window.showInformationMessage(
        `Created new shader file: ${path.basename(filePath)}`,
      );
    } catch (error) {
      this.logger.error(`Failed to create new shader: ${error}`);
      vscode.window.showErrorMessage(`Failed to create new shader: ${error}`);
    }
  }
}
