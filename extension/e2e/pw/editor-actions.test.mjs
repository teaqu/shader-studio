import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { closeNativeEditor, replaceSource, revertFixtureEditors } from './editor-actions.mjs';

const Uri = { file: path => ({ fsPath: resolve(path) }) };

function fakeVscode(documents, { rejectCommand = false, rejectClose = false, groups, removeEmptyGroups = false } = {}) {
  const shown = [];
  const commands = [];
  const closed = [];
  let activeDocument;
  groups ??= [{ viewColumn: 1, tabs: documents.map(document => ({ input: { uri: document.uri } })) }];
  let activeGroup = groups[0];
  const host = {
    Uri,
    workspace: { textDocuments: documents },
    window: {
      tabGroups: { all: groups, get activeTabGroup() {
        return { ...activeGroup, activeTab: activeGroup.tabs.find(tab => tab.input.uri.fsPath === activeDocument?.uri.fsPath) ?? activeGroup.tabs[0] };
} },
      get activeTextEditor() {
        return activeDocument ? { document: activeDocument } : undefined;
      },
      showTextDocument: async (document, options) => {
        shown.push({ document, options });
        activeDocument = document;
        activeGroup = groups.find(group => group.viewColumn === (options.viewColumn ?? activeGroup.viewColumn));
      },
    },
    commands: {
      executeCommand: async (command) => {
        commands.push(command);
        if (rejectCommand) {
          throw new Error('revert failed');
        }
        activeDocument.isDirty = false;
        activeGroup.tabs = activeGroup.tabs.filter(tab => tab.input.uri.fsPath !== activeDocument.uri.fsPath);
      },
    },
  };
  return {
    evaluateInHost: async (callback, ...args) => callback(host, ...args),
    window: { locator: selector => ({ filter: ({ hasText }) => ({ locator: () => ({ click: async () => {
      if (rejectClose) {
        throw new Error('close failed');
      }
      assert.equal(activeDocument.uri.fsPath.split(/[\\/]/).at(-1), hasText);
      const matches = (selector.includes('.editor-group-container.active') ? [activeGroup] : groups)
        .filter(group => group.tabs.some(tab => tab.input.uri.fsPath.split(/[\\/]/).at(-1) === hasText));
      assert.equal(matches.length, 1, 'the close locator must identify one active editor group');
      activeGroup.tabs = activeGroup.tabs.filter(tab => tab.input.uri.fsPath !== activeDocument.uri.fsPath);
      closed.push(activeDocument); activeDocument = undefined;
      if (removeEmptyGroups && activeGroup.tabs.length === 0) {
        groups.splice(groups.indexOf(activeGroup), 1);
        groups.forEach((group, index) => {
 group.viewColumn = index + 1; 
});
        activeGroup = groups[0];
      }
    } }) }) }) },
    shown,
    commands,
    closed,
    groups,
  };
}

test('cleanup closes duplicate fixture tabs in every group and preserves outside tabs', async () => {
  const owned = { isDirty: false, uri: Uri.file('/fixtures/worker-0/recovery.wgsl') };
  const outside = { isDirty: false, uri: Uri.file('/fixtures/worker-1/recovery.wgsl') };
  const groups = [
    { viewColumn: 1, tabs: [{ input: { uri: owned.uri } }] },
    { viewColumn: 2, tabs: [{ input: { uri: owned.uri } }] },
    { viewColumn: 3, tabs: [{ input: { uri: outside.uri } }] },
  ];
  const vscode = fakeVscode([owned, outside], { groups });
  await revertFixtureEditors(vscode, '/fixtures/worker-0');
  assert.deepEqual(groups.map(group => group.tabs.length), [0, 0, 1]);
  assert.deepEqual(vscode.closed, [owned, owned]);
});

test('cleanup follows the remaining duplicate when closing a group renumbers viewColumns', async () => {
  const owned = { isDirty: false, uri: Uri.file('/fixtures/worker-0/recovery.wgsl') };
  const outside = { isDirty: false, uri: Uri.file('/fixtures/worker-1/recovery.wgsl') };
  const groups = [owned, owned, outside].map((document, index) => ({
    viewColumn: index + 1, tabs: [{ input: { uri: document.uri } }],
  }));
  const vscode = fakeVscode([owned, outside], { groups, removeEmptyGroups: true });
  await revertFixtureEditors(vscode, '/fixtures/worker-0');
  assert.deepEqual(vscode.closed, [owned, owned]);
  assert.deepEqual(groups, [{ viewColumn: 1, tabs: [{ input: { uri: outside.uri } }] }]);
});

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
  }, { document: ownedClean, options: { viewColumn: 1, preserveFocus: false, preview: false } }]);
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
    evaluateInHost: async (callback, ...args) => callback({
      Uri,
      window: {
        activeTextEditor: activePath ? { document: { uri: { fsPath: activePath } } } : undefined,
        tabGroups: {
          get activeTabGroup() {
            return { viewColumn: 1, activeTab: { input: { uri: { fsPath: activePath } } } };
          },
          get all() {
 return [{ viewColumn: 1, tabs: activePath ? [{ input: { uri: { fsPath: activePath } } }] : [] }]; 
},
        },
      },
      commands: {
        executeCommand: () => assert.fail('host close commands must not be used'),
      },
    }, ...args),
  };

  await closeNativeEditor(vscode, activePath);

  assert.deepEqual(locators, ['.editor-group-container.active .tab.active', '.codicon-close']);
});

test('replaceSource edits the active native group while another editor remains visible', async () => {
  const groups = [{ source: 'outside source' }, { source: 'owned source' }];
  let focused = 1;
  const documents = groups.map((group, index) => ({ uri: { fsPath: `/fixtures/group-${index}/recovery.wgsl` }, eol: 1, getText: () => group.source }));
  const host = {
    workspace: { textDocuments: documents },
    window: {
      get activeTextEditor() {
 return { document: documents[focused], viewColumn: focused + 1 }; 
},
      showTextDocument: async (_document, options) => {
 focused = options.viewColumn - 1; 
},
      tabGroups: {
        all: documents.map((document, index) => ({ viewColumn: index + 1, tabs: [{ input: { uri: document.uri } }] })),
        get activeTabGroup() {
 return { viewColumn: focused + 1, activeTab: { input: { uri: documents[focused].uri } } }; 
},
      },
    },
  };
  const locator = candidates => ({
    filter: () => locator(candidates),
    first: () => locator(candidates.slice(0, 1)),
    click: async () => {
      assert.equal(candidates.length, 1);
      focused = candidates[0];
    },
  });
  const vscode = {
    window: {
      locator: selector => locator(selector.includes('.editor-group-container.active') ? [1] : [0, 1]),
      keyboard: { press: async () => {} },
      evaluate: async (_callback, source) => {
 groups[focused].source = source; 
},
    },
    evaluateInHost: async (callback, ...args) => callback(host, ...args),
  };
  await replaceSource(vscode, 'malformed source\n}');
  assert.equal(groups[1].source, 'malformed source\n}');
  assert.equal(groups[0].source, 'outside source');
});

function retainedNativeEditor({ vanished = false, missingColumn = false } = {}) {
  let text = 'original source';
  const document = { uri: Uri.file('/fixtures/group-2/recovery.wgsl'), eol: 2, getText: () => text };
  const documents = [document];
  const native = { viewColumn: 2, tabs: [{ input: { uri: document.uri } }] };
  const preview = { viewColumn: 3, tabs: [{ input: { viewType: 'shader-studio' } }] };
  let activeGroup = preview;
  let evaluations = 0;
  let pastes = 0;
  const shown = [];
  const host = {
    window: {
      activeTextEditor: { document, viewColumn: 2 },
      tabGroups: { all: missingColumn ? [preview] : [native, preview], get activeTabGroup() {
        return { ...activeGroup, activeTab: activeGroup.tabs[0] };
      } },
      showTextDocument: async (selected, options) => {
        assert.equal(selected, document);
        assert.equal(options.viewColumn, 2);
        shown.push(options);
        activeGroup = native;
      },
    },
    workspace: { textDocuments: documents },
  };
  const vscode = {
    evaluateInHost: async (callback, ...args) => {
      const value = await callback(host, ...args);
      if (++evaluations === 1 && vanished) {
        documents.length = 0;
      }
      return value;
    },
    window: {
      locator: () => ({ filter: () => ({ click: async () => {
        assert.equal(activeGroup, native, 'a preview-active group has no native Monaco editor');
      } }) }),
      keyboard: { press: async () => {} },
      evaluate: async (_callback, source) => {
        pastes++;
        text = source.replace(/\r?\n/g, '\r\n');
      },
    },
  };
  return { vscode, shown, get pastes() {
 return pastes; 
}, document };
}

test('replaceSource restores the retained native editor group before one paste from preview focus', async () => {
  const fixture = retainedNativeEditor();
  await replaceSource(fixture.vscode, 'updated\nsource');
  assert.deepEqual(fixture.shown, [{ viewColumn: 2, preserveFocus: false, preview: false }]);
  assert.equal(fixture.pastes, 1);
  assert.equal(fixture.document.getText(), 'updated\r\nsource');
});

test('replaceSource refuses to reopen a native document that closed after its snapshot', async () => {
  const fixture = retainedNativeEditor({ vanished: true });
  await assert.rejects(() => replaceSource(fixture.vscode, 'replacement'), /native editor is no longer open/);
  assert.equal(fixture.pastes, 0);
  assert.deepEqual(fixture.shown, []);
});

test('replaceSource refuses a missing original editor group before a paste', async () => {
  const fixture = retainedNativeEditor({ missingColumn: true });
  await assert.rejects(() => replaceSource(fixture.vscode, 'replacement'), /native editor group is no longer open/);
  assert.equal(fixture.pastes, 0);
  assert.deepEqual(fixture.shown, []);
});

test('cleanup reverts a dirty fixture once and closes its remaining duplicate tab', async () => {
  const owned = { isDirty: true, uri: Uri.file('/fixtures/worker-0/recovery.wgsl') };
  const groups = [1, 2].map(viewColumn => ({ viewColumn, tabs: [{ input: { uri: owned.uri } }] }));
  const vscode = fakeVscode([owned], { groups });
  await revertFixtureEditors(vscode, '/fixtures/worker-0');
  assert.deepEqual(vscode.commands, ['workbench.action.revertAndCloseActiveEditor']);
  assert.deepEqual(groups.map(group => group.tabs.length), [0, 0]);
});

test('closing a same-named outside tab is refused before the UI gesture', async () => {
  const outside = { isDirty: false, uri: Uri.file('/fixtures/worker-1/recovery.wgsl') };
  const owned = { isDirty: false, uri: Uri.file('/fixtures/worker-0/recovery.wgsl') };
  const vscode = fakeVscode([outside, owned]);
  await assert.rejects(() => closeNativeEditor(vscode, owned.uri.fsPath), /active editor does not match/);
  assert.deepEqual(vscode.closed, []);
  assert.equal(vscode.groups[0].tabs.length, 2);
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
