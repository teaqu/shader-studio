import type { Position, TextEdit } from 'vscode-languageserver-protocol';

export interface WorkspaceTextChange { uri: string; before: string; after: string }

/** LSP offsets are UTF-16, just like JavaScript string offsets. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const lines = text.split('\n');
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) { starts.push(cursor); cursor += line.length + 1; }
  const offset = (position: Position): number => {
    const { line, character } = position;
    if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || line >= lines.length
      || character < 0 || character > lines[line].replace(/\r$/, '').length) {
      throw new Error('Rename contains an invalid text range. No files were changed.');
    }
    return starts[line] + character;
  };
  const changes = edits.map(edit => ({ start: offset(edit.range.start), end: offset(edit.range.end), text: edit.newText }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (change.end < change.start || (index > 0 && (change.start < changes[index - 1].end || change.start === changes[index - 1].start))) {
      throw new Error('Rename contains overlapping text edits. No files were changed.');
    }
  }
  for (const change of changes.reverse()) text = text.slice(0, change.start) + change.text + text.slice(change.end);
  return text;
}
