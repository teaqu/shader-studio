import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { closeNativeEditor, revertFixtureEditors } from './editor-actions.mjs';

const Uri = { file: path => ({ fsPath: resolve(path) }) };

function fakeVscode(documents, { rejectCommand = false } = {}) {
  const shown = [];
  const commands = [];
  const host = {
    Uri,
    workspace: { textDocuments: documents },
    window: {
      showTextDocument: async (document, options) => {
        shown.push({ document, options });
      },
    },
    commands: {
      executeCommand: async (command) => {
        commands.push(command);
        if (rejectCommand) {
          throw new Error('revert failed');
        }
      },
    },
  };
  return {
    evaluateInHost: async (callback, ...args) => callback(host, ...args),
    shown,
    commands,
  };
}

test('revertFixtureEditors reverts only dirty fixture editors before cleanup', async () => {
  const ownedDirty = { isDirty: true, uri: Uri.file('/fixtures/worker-0/update.wgsl') };
  const ownedClean = { isDirty: false, uri: Uri.file('/fixtures/worker-0/image.wgsl') };
  const otherDirty = { isDirty: true, uri: Uri.file('/fixtures/worker-1/update.wgsl') };
  const siblingDirty = { isDirty: true, uri: Uri.file('/fixtures/worker-0-other/update.wgsl') };
  const vscode = fakeVscode([ownedDirty, ownedClean, otherDirty, siblingDirty]);

  await revertFixtureEditors(vscode, '/fixtures/worker-0');

  assert.deepEqual(vscode.shown, [{
    document: ownedDirty,
    options: { preserveFocus: false, preview: false },
  }]);
  assert.deepEqual(vscode.commands, ['workbench.action.revertAndCloseActiveEditor']);
});

test('revertFixtureEditors surfaces a failed fixture revert', async () => {
  const vscode = fakeVscode([{ isDirty: true, uri: Uri.file('/fixtures/worker-0/update.wgsl') }], {
    rejectCommand: true,
  });

  await assert.rejects(() => revertFixtureEditors(vscode, '/fixtures/worker-0'), /revert failed/);
});

test('closeNativeEditor clicks the named active tab without depending on browser or host-command focus', async () => {
  let activePath = Uri.file('/fixtures/inference.wgsl').fsPath;
  const locators = [];
  const vscode = {
    window: {
      keyboard: {
        press: async () => assert.fail('browser keybindings must not be used to close the native editor'),
      },
      locator: selector => {
        locators.push(selector);
        return {
          filter: ({ hasText }) => {
            assert.equal(hasText, 'inference.wgsl');
            return {
              locator: childSelector => {
                locators.push(childSelector);
                return { click: async () => {
                  activePath = undefined;
                } };
              },
            };
          },
        };
      },
    },
    evaluateInHost: async (callback, target) => callback({
      Uri,
      window: { activeTextEditor: activePath ? { document: { uri: { fsPath: activePath } } } : undefined },
      commands: {
        executeCommand: () => assert.fail('host close commands must not be used'),
      },
    }, target),
  };

  await closeNativeEditor(vscode, activePath);

  assert.deepEqual(locators, ['.tab.active', '.codicon-close']);
});


test('cleanup unlocks the preview without clicking controls that move during editor-group resizing', async () => {
  const { unlockPreviewForCleanup } = await import('./editor-actions.mjs');
  let locked = true;
  const commands = [];
  const vscode = {
    evaluateInHost: callback => callback({ commands: { executeCommand: async command => {
      commands.push(command);
      locked = false;
    } } }),
  };
  const frame = { evaluate: async () => locked };
  await unlockPreviewForCleanup(vscode, frame);
  assert.deepEqual(commands, ['shader-studio.toggleLock']);
  await unlockPreviewForCleanup(vscode, frame);
  assert.deepEqual(commands, ['shader-studio.toggleLock']);
});

function nativeEditorVscode(statusTexts) {
  const typed = [];
  let selection;
  const texts = [...statusTexts];
  const document = {
    uri: Uri.file('/fixtures/inference.wgsl'),
    positionAt: offset => ({ line: 2, character: offset - 40 }),
  };
  return {
    typed,
    selection: () => selection,
    evaluateInHost: async (callback, ...args) => callback({
      Uri,
      Selection: class {
        constructor(anchor, active) {
          this.anchor = anchor;
          this.active = active;
        }
      },
      workspace: { textDocuments: [document] },
      window: {
        showTextDocument: async () => ({
          set selection(value) {
            selection = value;
          },
        }),
      },
    }, ...args),
    window: {
      evaluate: async () => true,
      locator: selector => {
        assert.equal(selector, '[id="status.editor.selection"]');
        return { first: () => ({ textContent: async () => (texts.length > 1 ? texts.shift() : texts[0]) }) };
      },
    },
  };
}

test('focusNativeEditor returns only once the workbench caret reaches the requested position', async () => {
  const { focusNativeEditor } = await import('./editor-actions.mjs');
  // The status bar lags the host selection: first the old caret, then the new one.
  const vscode = nativeEditorVscode(['Ln 3, Col 28', ' Ln 3, Col 29 ']);

  await focusNativeEditor(vscode, '/fixtures/inference.wgsl', 68);

  assert.deepEqual(vscode.selection().active, { line: 2, character: 28 });
});

test('focusNativeEditor fails when the workbench caret never moves', async () => {
  const { focusNativeEditor } = await import('./editor-actions.mjs');
  // Col 290 must not count as Col 29.
  const vscode = nativeEditorVscode(['Ln 3, Col 290']);

  await assert.rejects(() => focusNativeEditor(vscode, '/fixtures/inference.wgsl', 68), /never moved the caret/);
});
