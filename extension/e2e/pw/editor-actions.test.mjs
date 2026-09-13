import test from 'node:test';
import assert from 'node:assert/strict';
import { revertFixtureEditors } from './editor-actions.mjs';

function fakeVscode(documents, { rejectCommand = false } = {}) {
  const shown = [];
  const commands = [];
  const host = {
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
  const ownedDirty = { isDirty: true, uri: { fsPath: '/fixtures/worker-0/update.wgsl' } };
  const ownedClean = { isDirty: false, uri: { fsPath: '/fixtures/worker-0/image.wgsl' } };
  const otherDirty = { isDirty: true, uri: { fsPath: '/fixtures/worker-1/update.wgsl' } };
  const vscode = fakeVscode([ownedDirty, ownedClean, otherDirty]);

  await revertFixtureEditors(vscode, '/fixtures/worker-0');

  assert.deepEqual(vscode.shown, [{
    document: ownedDirty,
    options: { preserveFocus: false, preview: false },
  }]);
  assert.deepEqual(vscode.commands, ['workbench.action.revertAndCloseActiveEditor']);
});

test('revertFixtureEditors surfaces a failed fixture revert', async () => {
  const vscode = fakeVscode([{ isDirty: true, uri: { fsPath: '/fixtures/worker-0/update.wgsl' } }], {
    rejectCommand: true,
  });

  await assert.rejects(() => revertFixtureEditors(vscode, '/fixtures/worker-0'), /revert failed/);
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
