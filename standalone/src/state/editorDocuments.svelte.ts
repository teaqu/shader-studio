/** Source text shared by standalone panes displaying the same workspace file. */
let documents = $state<Record<string, string | null>>({});
export function getEditorDocument(path: string): string | null | undefined {
  return documents[path];
}
export function setEditorDocument(path: string, code: string | null): void {
  documents[path] = code;
}
export function clearEditorDocuments(): void {
  documents = {};
}
