import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { GlslFileTracker } from "../GlslFileTracker";
import { Messenger } from "../transport/Messenger";
import { WorkspaceFileScanner } from "../WorkspaceFileScanner";
import { writeWorkspaceTypeDefs } from "../WorkspaceTypeDefs";
import { Logger } from "../services/Logger";
import type { ErrorMessage } from "@shader-studio/types";
import { GLSL_EXTENSIONS, SCRIPT_EXTENSIONS, TEXTURE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, CUBEMAP_EXTENSIONS } from "@shader-studio/types";

function fileTypeToFilters(fileType: string): { [name: string]: string[] } {
  switch (fileType) {
    case 'script':   return { 'Script files': SCRIPT_EXTENSIONS };
    case 'texture':  return { 'Texture files': TEXTURE_EXTENSIONS };
    case 'video':    return { 'Video files': VIDEO_EXTENSIONS };
    case 'audio':    return { 'Audio files': AUDIO_EXTENSIONS };
    case 'cubemap':  return { 'Cubemap files': CUBEMAP_EXTENSIONS };
    default:         return { 'GLSL files': GLSL_EXTENSIONS };
  }
}

export class FileDialogHandler {
  constructor(
    private context: vscode.ExtensionContext,
    private glslFileTracker: GlslFileTracker,
    private extensionPath: string,
    private messenger: Messenger | null,
    private resolveTargetColumn: (shaderPath: string) => vscode.ViewColumn,
    private logger: Logger,
  ) {}

  async handleSelectFile(
    payload: { shaderPath: string; fileType: string; requestId: string },
    respondFn: (msg: any) => void,
  ): Promise<void> {
    try {
      const shaderDir = payload.shaderPath
        ? path.dirname(payload.shaderPath)
        : (() => {
          const e = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
          return e ? path.dirname(e.document.uri.fsPath) : null;
        })();
      const isScript = payload.fileType === 'script';
      const filters = fileTypeToFilters(payload.fileType);
      const result = await vscode.window.showOpenDialog({
        defaultUri: shaderDir ? vscode.Uri.file(shaderDir) : undefined,
        filters,
        canSelectMany: false,
        title: 'Select file',
      });
      if (!result || result.length === 0) {
        return; 
      }
      const selectedPath = result[0].fsPath;
      const outputPath = this.resolveOutputPath(selectedPath, shaderDir);
      if (isScript && selectedPath.endsWith('.ts')) {
        writeWorkspaceTypeDefs(this.extensionPath, true); 
      }
      respondFn({ type: 'fileSelected', payload: { path: outputPath, requestId: payload.requestId } });
    } catch (error) {
      this.logger.error(`Failed to select file: ${error}`);
    }
  }

  async handleCreateFile(
    payload: { shaderPath: string; suggestedPath: string; fileType: string; requestId: string },
    respondFn: (msg: any) => void,
  ): Promise<void> {
    try {
      const shaderDir = payload.shaderPath
        ? path.dirname(payload.shaderPath)
        : (() => {
          const e = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
          return e ? path.dirname(e.document.uri.fsPath) : null;
        })();
      const isScript = payload.fileType === 'script';
      const filters: { [name: string]: string[] } = isScript
        ? { 'Script files': ['ts', 'js'] }
        : { 'GLSL files': ['glsl', 'frag', 'vert'] };
      const defaultPath = shaderDir && payload.suggestedPath
        ? path.resolve(shaderDir, payload.suggestedPath)
        : shaderDir
          ? path.join(shaderDir, payload.suggestedPath || 'file')
          : undefined;
      const result = await vscode.window.showSaveDialog({
        defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined,
        filters,
        title: 'Create file',
      });
      if (!result) {
        return;
      }
      const filePath = result.fsPath;
      const outputPath = this.resolveOutputPath(filePath, shaderDir);
      if (!fs.existsSync(filePath)) {
        let template: string;
        if (isScript) {
          template = filePath.endsWith('.ts')
            ? this.buildTsTemplate(filePath, shaderDir || path.dirname(filePath))
            : `export function uniforms(ctx) {\n  return {\n    // iDayOfWeek: new Date().getDay(),\n  };\n}\n`;
        } else if (payload.fileType === 'glsl-common') {
          template = `// Common functions shared across all passes\n`;
        } else {
          template = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = vec4(uv, 0.0, 1.0);\n}\n`;
        }
        fs.writeFileSync(filePath, template, 'utf-8');
        this.logger.info(`Created file: ${filePath}`);
      } else {
        this.logger.info(`File already exists: ${filePath}`);
      }
      if (isScript && filePath.endsWith('.ts')) {
        writeWorkspaceTypeDefs(this.extensionPath, true);
      }
      respondFn({ type: 'fileSelected', payload: { path: outputPath, requestId: payload.requestId } });
    } catch (error) {
      this.logger.error(`Failed to create file: ${error}`);
    }
  }

  async handleSaveFile(
    payload: { data: string; defaultName: string; filters: Record<string, string[]> },
    respondFn: (msg: any) => void,
  ): Promise<void> {
    try {
      const saveFilters: Record<string, string[]> = {};
      for (const [label, exts] of Object.entries(payload.filters)) {
        saveFilters[label] = exts;
      }

      const result = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(payload.defaultName),
        filters: saveFilters,
      });

      if (!result) {
        respondFn({ type: 'saveFileResult', payload: { success: false, error: 'Cancelled' } });
        return;
      }

      const buffer = Buffer.from(payload.data, 'base64');
      fs.writeFileSync(result.fsPath, buffer);
      respondFn({ type: 'saveFileResult', payload: { success: true, path: result.fsPath } });
      this.logger.info(`File saved: ${result.fsPath}`);
    } catch (error) {
      respondFn({ type: 'saveFileResult', payload: { success: false, error: String(error) } });
      this.logger.error(`Failed to save file: ${error}`);
    }
  }

  async handleForkShader(payload: { shaderPath: string }): Promise<void> {
    try {
      const sourcePath = payload.shaderPath;
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        this.logger.warn("No shader path to fork");
        return;
      }

      const sourceDir = path.dirname(sourcePath);
      const sourceExt = path.extname(sourcePath);
      const rawBase = path.basename(sourcePath, sourceExt);
      const rootBase = rawBase.replace(/\.\d+$/, '');

      let counter = 1;
      while (fs.existsSync(path.join(sourceDir, `${rootBase}.${counter}${sourceExt}`))) {
        counter++;
      }

      const result = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(sourceDir, `${rootBase}.${counter}${sourceExt}`)),
        filters: { 'GLSL Shader': ['glsl'] },
      });

      if (!result) {
        return;
      }

      const destPath = result.fsPath;
      fs.copyFileSync(sourcePath, destPath);
      this.logger.info(`Forked shader: ${sourcePath} → ${destPath}`);

      const sourceConfigPath = sourcePath.replace(/\.(glsl|frag)$/, '.sha.json');
      if (fs.existsSync(sourceConfigPath)) {
        const destConfigPath = destPath.replace(/\.(glsl|frag)$/, '.sha.json');
        fs.copyFileSync(sourceConfigPath, destConfigPath);
        this.logger.info(`Forked config: ${sourceConfigPath} → ${destConfigPath}`);
      }

      const doc = await vscode.workspace.openTextDocument(result);
      const viewColumn = this.resolveTargetColumn(sourcePath);
      await vscode.window.showTextDocument(doc, { viewColumn, preview: false });
    } catch (error) {
      this.logger.error(`Failed to fork shader: ${error}`);
      const errorMsg: ErrorMessage = { type: "error", payload: [`Failed to fork shader: ${error}`] };
      this.messenger?.send(errorMsg);
    }
  }

  async handleRequestWorkspaceFiles(
    payload: { extensions: string[]; shaderPath: string },
    respondFn: (msg: any) => void,
    pathConverter: (absPath: string) => string,
  ): Promise<void> {
    try {
      console.log('FileDialogHandler: Scanning workspace files for extensions:', payload.extensions);
      const files = await WorkspaceFileScanner.scanFiles(
        payload.extensions,
        payload.shaderPath,
        pathConverter,
      );
      console.log(`FileDialogHandler: Found ${files.length} workspace files`);
      respondFn({ type: "workspaceFiles", payload: { files } });
    } catch (error) {
      console.error(`FileDialogHandler: Failed to scan workspace files:`, error);
      this.logger.error(`Failed to scan workspace files: ${error}`);
      respondFn({ type: "workspaceFiles", payload: { files: [] } });
    }
  }

  /**
   * Resolve the output path for a selected file:
   * - Outside workspace → absolute path
   * - Inside shader's directory subtree → relative path (./subdir/file)
   * - Elsewhere in workspace → workspace-relative path (@/path/from/root)
   */
  resolveOutputPath(selectedPath: string, shaderDir: string | null): string {
    if (!shaderDir) {
      return selectedPath;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Outside workspace (or no workspace) — use absolute path
    if (!workspaceRoot || !selectedPath.startsWith(workspaceRoot + path.sep) && selectedPath !== workspaceRoot) {
      const rel = path.relative(shaderDir, selectedPath);
      // Only use relative if the file is within the shader's directory subtree
      if (!rel.startsWith('..')) {
        return './' + rel.replace(/\\/g, '/');
      }
      return selectedPath;
    }

    // Within workspace — check if it's in shader's subtree (no need to go up)
    const relToShader = path.relative(shaderDir, selectedPath);
    if (!relToShader.startsWith('..')) {
      return './' + relToShader.replace(/\\/g, '/');
    }

    // Elsewhere in workspace — use @/ prefix
    const relToWorkspace = path.relative(workspaceRoot, selectedPath);
    return '@/' + relToWorkspace.replace(/\\/g, '/');
  }

  private buildTsTemplate(scriptFilePath: string, shaderDir: string): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let refLine = '';
    if (workspaceRoot) {
      const dtsPath = path.join(workspaceRoot, '.vscode', 'shader-studio.d.ts');
      const relToDts = path.relative(path.dirname(scriptFilePath), dtsPath).replace(/\\/g, '/');
      refLine = `/// <reference path="${relToDts}" />\n`;
    }
    const sep = refLine ? '\n' : '';
    return `${refLine}${sep}export function uniforms(ctx: UniformContext): Record<string, UniformValue> {\n  return {\n    // iDayOfWeek: new Date().getDay(),\n  };\n}\n`;
  }
}
