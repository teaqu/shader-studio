/** Active editor identity, scoped to its root shader so projects cannot leak targets. */
let current = $state({ projectPath: "", sourcePath: "" });

export function setCurrentEditorSource(projectPath: string, sourcePath: string): void {
  current = { projectPath, sourcePath };
}

export function clearCurrentEditorSource(projectPath?: string): void {
  if (!projectPath || current.projectPath === projectPath) {
    current = { projectPath: "", sourcePath: "" };
  }
}

export function getCurrentEditorSource(projectPath: string): string {
  return projectPath && current.projectPath === projectPath ? current.sourcePath : "";
}
