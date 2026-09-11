/** Minimal `vscode` API surface for tests that exercise extension modules
 * outside the extension host (notably the project-derivation parity test).
 * Only what the imported modules touch at runtime is stubbed: an empty open
 * document set with the corpus root standing in for the workspace folder. */
export interface StubUri {
  scheme: string;
  fsPath: string;
  toString(): string;
}

export const textDocuments: { uri: StubUri; languageId: string; getText(): string; version: number }[] = [];

let workspaceRoot: string | undefined;

export function setWorkspaceRoot(root: string | undefined): void {
  workspaceRoot = root;
}

export const workspace = {
  textDocuments,
  getWorkspaceFolder: (): { uri: StubUri; name: string; index: number } | undefined =>
    workspaceRoot === undefined
      ? undefined
      : { uri: file(workspaceRoot), name: 'stub', index: 0 },
};

export function file(fsPath: string): StubUri {
  return { scheme: 'file', fsPath, toString: () => `file://${fsPath}` };
}

function parse(value: string): StubUri {
  return { scheme: 'file', fsPath: value.replace(/^file:\/\//, ''), toString: () => value };
}

export const Uri = { file, parse };
