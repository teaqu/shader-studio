import * as vscode from "vscode";
import * as path from "path";

/**
 * Resolves paths for shader files and their dependencies.
 * Supports three types of paths:
 * - @ prefix: Workspace-relative paths (e.g., @/buffers/test.glsl)
 * - Absolute paths: Full paths (e.g., C:\path\file.glsl or /usr/path/file.glsl)
 * - Relative paths: Paths relative to the shader file directory (e.g., ../buffers/test.glsl)
 */
export class PathResolver {
  /**
   * Resolves a path based on the shader file location and workspace root.
   * @param shaderPath - The absolute path to the shader file
   * @param targetPath - The path to resolve (can be @/, absolute, or relative)
   * @returns The resolved absolute path
   */
  public static resolvePath(shaderPath: string, targetPath: string): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(shaderPath));
    const workspaceRoot = workspaceFolder?.uri.fsPath || path.dirname(shaderPath);
    
    if (targetPath.startsWith('@/')) {
      // Workspace-relative path with @/ prefix
      return path.join(workspaceRoot, targetPath.substring(2));
    } else if (path.isAbsolute(targetPath)) {
      // Absolute path (C:\... on Windows, /... on Mac/Linux)
      return targetPath;
    } else {
      // Regular relative path - resolve from shader file directory
      return path.join(path.dirname(shaderPath), targetPath);
    }
  }
}
