import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";

export class ShaderCreator {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  private getShaderTemplate(): string {
    return `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));

    // Output to screen
    fragColor = vec4(col,1.0);
}`;
  }

  private findUniqueFileName(rootPath: string): string {
    let filePath = path.join(rootPath, "shadertoy.glsl");
    let counter = 1;

    // Check if file exists and increment counter if needed
    while (fs.existsSync(filePath)) {
      filePath = path.join(rootPath, `shadertoy${counter}.glsl`);
      counter++;
    }

    return filePath;
  }

  async create(): Promise<void> {
    try {
      // Get the workspace root folder
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder is open");
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const filePath = this.findUniqueFileName(rootPath);

      // Create a basic shader template
      const shaderTemplate = this.getShaderTemplate();

      // Write the shader file
      fs.writeFileSync(filePath, shaderTemplate);

      // Open the newly created file
      const fileUri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(fileUri);
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
