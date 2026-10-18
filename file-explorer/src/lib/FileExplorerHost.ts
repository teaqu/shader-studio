export interface WorkspaceFileEntry {
  path: string;
  asset: boolean;
  directory?: boolean;
}

export interface WorkspaceTreeEntry {
  path: string;
  name: string;
  directory: boolean;
  depth: number;
}

/** File operations supplied by the host; the pane owns no storage. */
export interface FileExplorerHost {
  onWorkspaceFiles(listener: (files: WorkspaceFileEntry[]) => void): () => void;
  flush(): Promise<void>;
  readEditorFile(path: string): Promise<string | null>;
  createWorkspaceFile(path: string): Promise<void>;
  createWorkspaceFolder(path: string): Promise<void>;
  renameWorkspacePath(from: string, to: string): Promise<void>;
  deleteWorkspacePath(path: string): Promise<void>;
  deleteWorkspacePaths(paths: readonly string[]): Promise<void>;
  moveWorkspacePaths(paths: readonly string[], directory: string): Promise<void>;
  uploadFiles(files: readonly File[], directory?: string): Promise<readonly string[] | void>;
}
