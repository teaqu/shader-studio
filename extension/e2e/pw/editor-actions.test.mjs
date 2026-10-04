import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { closeNativeEditor, revertFixtureEditors } from './editor-actions.mjs';

const Uri = { file: path => ({ fsPath: resolve(path) }) };

function fakeVscode(documents, { rejectCommand = false, rejectClose = false } = {}) {
  const shown = [];
  const commands = [];
  const closed = [];
  let activeDocument;
  const host = {
    Uri,
    workspace: { textDocuments: documents },
    window: {
      get activeTextEditor() {
        return activeDocument ? { document: activeDocument } : undefined;
      },
      showTextDocument: async (document, options) => {
        shown.push({ document, options });
        activeDocument = document;
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
    window: { locator: () => ({ filter: ({ hasText }) => ({ locator: () => ({ click: async () => {
      if (rejectClose) {
        throw new Error('close failed');
      }
      assert.equal(activeDocument.uri.fsPath.split(/[\\/]/).at(-1), hasText);
      closed.push(activeDocument); activeDocument = undefined;
    } }) }) }) },
    shown,
    commands,
    closed,
  };
}

test('revertFixtureEditors reverts dirty fixture editors and closes clean fixture editors before cleanup', async () => {
  const ownedDirty = { isDirty: true, uri: Uri.file('/fixtures/worker-0/update.wgsl') };
  const ownedClean = { isDirty: false, uri: Uri.file('/fixtures/worker-0/image.wgsl') };
  const otherDirty = { isDirty: true, uri: Uri.file('/fixtures/worker-1/update.wgsl') };
  const siblingDirty = { isDirty: true, uri: Uri.file('/fixtures/worker-0-other/update.wgsl') };
  const vscode = fakeVscode([ownedDirty, ownedClean, otherDirty, siblingDirty]);

  await revertFixtureEditors(vscode, '/fixtures/worker-0');

  assert.deepEqual(vscode.shown, [{
    document: ownedDirty,
    options: { preserveFocus: false, preview: false },
  }, { document: ownedClean, options: { preserveFocus: false, preview: false } }]);
  assert.deepEqual(vscode.commands, ['workbench.action.revertAndCloseActiveEditor']);
  assert.deepEqual(vscode.closed, [ownedClean]);
});

test('revertFixtureEditors surfaces a failed fixture revert', async () => {
  const vscode = fakeVscode([{ isDirty: true, uri: Uri.file('/fixtures/worker-0/update.wgsl') }], {
    rejectCommand: true,
  });

  await assert.rejects(() => revertFixtureEditors(vscode, '/fixtures/worker-0'), /revert failed/);
});

test('revertFixtureEditors surfaces a failed clean fixture close', async () => {
  const vscode = fakeVscode([{ isDirty: false, uri: Uri.file('/fixtures/worker-0/image.wgsl') }], { rejectClose: true });
  await assert.rejects(() => revertFixtureEditors(vscode, '/fixtures/worker-0'), /close failed/);
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


test('cleanup skips a clean fixture document already closed after the snapshot', async () => {
  const document = { isDirty: false, uri: Uri.file('/fixtures/worker-0/image.wgsl') };
  const documents = [document];
  const vscode = fakeVscode(documents);
  const evaluate = vscode.evaluateInHost;
  let calls = 0;
  vscode.evaluateInHost = async (...args) => {
    const result = await evaluate(...args);
    if (++calls === 1) {
      documents.length = 0;
    }
    return result;
  };
  await revertFixtureEditors(vscode, '/fixtures/worker-0');
  assert.deepEqual(vscode.shown, []);
  assert.deepEqual(vscode.closed, []);
});
