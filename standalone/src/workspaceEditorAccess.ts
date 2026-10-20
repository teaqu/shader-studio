import { Uri, editor } from 'monaco-editor/editor/editor.api.js';
import type { McpEditorAccess } from './StandaloneMcpApplication';

/** Commands operate on Monaco's shared URI model, including focused panes. */
export const workspaceEditorAccess: McpEditorAccess = {
  read(path) {
    return editor.getModel(Uri.file(path))?.getValue();
  },
  commit(path, text) {
    const model = editor.getModel(Uri.file(path));
    if (!model || model.getValue() === text) {
      return;
    }
    model.pushStackElement();
    model.pushEditOperations(null, [{ range: model.getFullModelRange(), text }], () => null);
    model.pushStackElement();
  },
};
