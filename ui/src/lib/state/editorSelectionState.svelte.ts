export interface SharedEditorSelection {
  source: number;
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

let selections = $state<Record<string, SharedEditorSelection>>({});
let nextSource = 0;

export function createEditorSelectionSource(): number {
  nextSource += 1;
  return nextSource;
}

export function getEditorSelection(path: string): SharedEditorSelection | null {
  return selections[path] ?? null;
}

export function setEditorSelection(
  path: string,
  source: number,
  selection: SharedEditorSelection['selection'],
): void {
  if (!path) {
    return;
  }
  selections = { ...selections, [path]: { source, selection: { ...selection } } };
}

export function resetEditorSelectionState(): void {
  selections = {};
  nextSource = 0;
}
