export class Uri {
  readonly scheme = 'file';
  constructor(public readonly fsPath: string) {}
  static file(path: string): Uri {
    return new Uri(path);
  }
}
export class Range {
  constructor(public readonly start: number, public readonly end: number) {}
}
export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}
export class WorkspaceEdit {
  entries: { uri: Uri; range: Range; text: string }[] = [];
  creates: Uri[] = [];
  replace(uri: Uri, range: Range, text: string): void {
    this.entries.push({ uri, range, text });
  }
  createFile(uri: Uri): void {
    this.creates.push(uri);
  }
  insert(uri: Uri, _position: Position, text: string): void {
    this.entries.push({ uri, range: new Range(0, 0), text });
  }
}
export interface TestDocument {
  uri: Uri; text: string; isDirty: boolean; getText(): string; positionAt(offset: number): number;
}
export const workspace = {
  getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }),
  isTrusted: true,
  workspaceFolders: [] as { uri: Uri }[],
  textDocuments: [] as TestDocument[],
  rejectEdit: false,
  async openTextDocument(uri: Uri): Promise<TestDocument> {
    const doc = this.textDocuments.find(document => document.uri.fsPath === uri.fsPath);
    if (!doc) {
      throw new Error('Document not found');
    }
    return doc;
  },
  async findFiles(): Promise<Uri[]> {
    return this.textDocuments.map(doc => doc.uri);
  },
  async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    if (this.rejectEdit) {
      return false;
    }
    for (const uri of edit.creates) {
      this.textDocuments.push({
        uri, text: '', isDirty: true,
        getText() {
          return this.text;
        },
        positionAt: offset => offset,
      });
    }
    for (const entry of edit.entries) {
      const doc = await this.openTextDocument(entry.uri);
      doc.text = doc.text.slice(0, entry.range.start) + entry.text + doc.text.slice(entry.range.end);
      doc.isDirty = true;
    }
    return true;
  },
};
