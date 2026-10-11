import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";
import { getConfigPathForShaderPath } from "./ShaderConfigPaths";
import { createNativeFragmentSource, shaderStarterTemplate } from "@shader-studio/types";

export class ShaderCreator {
  private logger: Logger;
  private glslFileTracker: GlslFileTracker;

  constructor(logger: Logger, glslFileTracker: GlslFileTracker) {
    this.logger = logger;
    this.glslFileTracker = glslFileTracker;
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
      const lowerPath = filePath.toLowerCase();
      const isWebGpuLanguage = lowerPath.endsWith(".wgsl") || lowerPath.endsWith(".slang");
      const defaultMode = vscode.workspace.getConfiguration('shader-studio').get('webgpu.defaultRenderAuthoring', 'hooks');
      const authoringMode = isWebGpuLanguage
        ? await vscode.window.showQuickPick([
          { label: 'ShaderToy hooks', value: 'hooks' as const, description: 'Generate the familiar mainImage wrapper' },
          { label: 'Native entry points', value: 'native' as const, description: 'Start with a native fragment function and the viewer vertex shader' },
        ].sort((a, b) => Number(b.value === defaultMode) - Number(a.value === defaultMode)), { title: 'WebGPU authoring style' })
        : { value: 'hooks' as const };
      if (!authoringMode) {
        return;
      }
      const configPath = getConfigPathForShaderPath(filePath);
      if (authoringMode.value === 'native' && fs.existsSync(configPath)) {
        vscode.window.showErrorMessage(`Cannot create native shader because its config already exists: ${path.basename(configPath)}`);
        return;
      }

      // Create a basic shader template
      const nativeTemplate = authoringMode.value === 'native'
        ? createNativeFragmentSource(lowerPath.endsWith(".slang") ? 'slang' : 'wgsl', '', 'Image')
        : undefined;
      const shaderTemplate = nativeTemplate
        ? nativeTemplate.text.trimStart()
        : lowerPath.endsWith(".slang")
        ? shaderStarterTemplate('slang')
        : lowerPath.endsWith(".wgsl")
          ? shaderStarterTemplate('wgsl')
          : shaderStarterTemplate('glsl');

      // Write the shader file
      fs.writeFileSync(filePath, shaderTemplate);
      if (authoringMode.value === 'native') {
        fs.writeFileSync(configPath, JSON.stringify({
          version: '1.0',
          webgpu: { defaultRenderAuthoring: 'native' },
          passes: { Image: { inputs: {}, entryPoints: nativeTemplate!.entryPoints } },
        }, null, 2));
      }

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
