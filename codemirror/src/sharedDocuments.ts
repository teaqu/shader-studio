import { Annotation, EditorState, Transaction } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';

/** Distinguishes mirrored changes from the view that must notify the host. */
export const sharedDocumentChange = Annotation.define<'history' | 'replica'>();
const documents = new Map<string | symbol, SharedDocument>();

/** One canonical history per file, with independently configured editor views. */
export class SharedDocument {
  private state: EditorState;
  private readonly views = new Set<EditorView>();
  private owners = 0;
  private pendingLocalChanges = false;

  private constructor(private readonly key: string | symbol, code: string) {
    this.state = EditorState.create({ doc: code, extensions: [history(), EditorState.allowMultipleSelections.of(true)] });
  }

  static acquire(key: string | symbol, code: string): SharedDocument {
    let document = documents.get(key);
    if (!document) {
      document = new SharedDocument(key, code);
      documents.set(key, document);
    }
    document.owners++;
    return document;
  }

  get text(): string {
    return this.state.doc.toString();
  }

  acknowledge(code: string): void {
    if (code === this.text) {
      this.pendingLocalChanges = false;
    }
  }

  get hasPendingChanges(): boolean {
    return this.pendingLocalChanges;
  }

  get hasFocus(): boolean {
    return [...this.views].some(view => view.hasFocus);
  }

  attach(view: EditorView): void {
    this.views.add(view);
  }
  detach(view: EditorView): void {
    this.views.delete(view);
  }
  release(): void {
    this.owners--;
    if (this.owners === 0) {
      documents.delete(this.key);
    }
  }

  apply(transaction: Transaction, origin: EditorView): void {
    if (transaction.annotation(Transaction.addToHistory) !== false) {
      this.pendingLocalChanges = true;
    }
    this.state = this.state.update({ selection: transaction.startState.selection,
      annotations: Transaction.addToHistory.of(false) }).state;
    this.state = this.state.update({
      changes: transaction.changes,
      selection: transaction.newSelection,
      annotations: [
        Transaction.addToHistory.of(transaction.annotation(Transaction.addToHistory) ?? true),
        Transaction.userEvent.of(transaction.annotation(Transaction.userEvent) ?? 'input'),
      ],
    }).state;
    for (const view of this.views) {
      if (view !== origin) {
        view.dispatch({ changes: transaction.changes, annotations: sharedDocumentChange.of('replica') });
      }
    }
  }

  runHistory(origin: EditorView, direction: 'undo' | 'redo'): boolean {
    return (direction === 'undo' ? undo : redo)({ state: this.state, dispatch: transaction => {
      this.state = transaction.state;
      this.pendingLocalChanges = true;
      // Update peers first: host callbacks from the originating view may save immediately.
      for (const view of this.views) {
        if (view !== origin) {
          view.dispatch({ changes: transaction.changes, annotations: sharedDocumentChange.of('replica') });
        }
      }
      origin.dispatch({ changes: transaction.changes, selection: transaction.newSelection,
        annotations: [sharedDocumentChange.of('history'), Transaction.userEvent.of(direction)], scrollIntoView: true });
    } });
  }
}
