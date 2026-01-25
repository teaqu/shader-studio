import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConfigViewToggler } from '../../app/ConfigViewToggler';
import { Logger } from '../../app/services/Logger';
import { Constants } from '../../app/Constants';

suite('ConfigViewToggler Test Suite', () => {
  let configViewToggler: ConfigViewToggler;
  let sandbox: sinon.SinonSandbox;

  suiteSetup(async () => {
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      dispose: () => {},
      outputChannel: {} as vscode.LogOutputChannel
    } as unknown as Logger;
    
    configViewToggler = new ConfigViewToggler(mockLogger);
  });

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('ConfigViewToggler can be instantiated', () => {
    assert.ok(configViewToggler, 'ConfigViewToggler should be instantiated');
  });

  test('toggle method handles no active editor gracefully', async () => {
    // Close all editors and tabs to ensure clean state
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Also close any remaining tab groups
    const tabGroups = vscode.window.tabGroups.all;
    for (const group of tabGroups) {
      for (const tab of group.tabs) {
        await vscode.window.tabGroups.close(tab);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should not throw when there's no active editor or config file
    await assert.doesNotReject(async () => {
      await configViewToggler.toggle();
    }, 'toggle should handle no active editor gracefully');
  });

  test('getCurrentEditorInfo returns correct info for custom editor tab', () => {
    const mockConfigUri = vscode.Uri.file('/test/config.sha.json');
    
    // Create a proper mock that passes instanceof check
    const mockCustomInput = Object.create(vscode.TabInputCustom.prototype);
    mockCustomInput.viewType = Constants.CONFIG_EDITOR_VIEW_TYPE;
    mockCustomInput.uri = mockConfigUri;
    
    const mockCustomTab = {
      input: mockCustomInput
    } as vscode.Tab;

    const result = configViewToggler['getCurrentEditorInfo'](mockCustomTab, undefined);

    assert.deepStrictEqual(result.documentUri, mockConfigUri, 'Should return config URI from custom tab');
    assert.strictEqual(result.isInCustomEditor, true, 'Should identify as custom editor');
  });

  test('getCurrentEditorInfo returns correct info for text editor with config file', () => {
    const mockConfigUri = vscode.Uri.file('/test/config.sha.json');
    const mockTextEditor = {
      document: {
        fileName: '/test/config.sha.json',
        uri: mockConfigUri
      }
    } as vscode.TextEditor;

    const result = configViewToggler['getCurrentEditorInfo'](undefined, mockTextEditor);

    assert.deepStrictEqual(result.documentUri, mockConfigUri, 'Should return config URI from text editor');
    assert.strictEqual(result.isInCustomEditor, false, 'Should identify as text editor');
  });

  test('getCurrentEditorInfo returns undefined for non-config file', () => {
    const mockGlslEditor = {
      document: {
        fileName: '/test/shader.glsl',
        uri: vscode.Uri.file('/test/shader.glsl')
      }
    } as vscode.TextEditor;

    const result = configViewToggler['getCurrentEditorInfo'](undefined, mockGlslEditor);

    assert.strictEqual(result.documentUri, undefined, 'Should return undefined for non-config file');
    assert.strictEqual(result.isInCustomEditor, false, 'Should not be in custom editor');
  });

  test('getCurrentEditorInfo prefers custom editor over text editor', () => {
    const mockConfigUri = vscode.Uri.file('/test/config.sha.json');
    
    // Create a proper mock that passes instanceof check
    const mockCustomInput = Object.create(vscode.TabInputCustom.prototype);
    mockCustomInput.viewType = Constants.CONFIG_EDITOR_VIEW_TYPE;
    mockCustomInput.uri = mockConfigUri;
    
    const mockCustomTab = {
      input: mockCustomInput
    } as vscode.Tab;
    
    const mockTextEditor = {
      document: {
        fileName: '/test/different.sha.json',
        uri: vscode.Uri.file('/test/different.sha.json')
      }
    } as vscode.TextEditor;

    const result = configViewToggler['getCurrentEditorInfo'](mockCustomTab, mockTextEditor);

    assert.deepStrictEqual(result.documentUri, mockConfigUri, 'Should prefer custom editor URI');
    assert.strictEqual(result.isInCustomEditor, true, 'Should identify as custom editor');
  });

  test('getCurrentEditorInfo handles undefined inputs gracefully', () => {
    const result = configViewToggler['getCurrentEditorInfo'](undefined, undefined);

    assert.strictEqual(result.documentUri, undefined, 'Should return undefined when no inputs');
    assert.strictEqual(result.isInCustomEditor, false, 'Should not be in custom editor');
  });

  test('getCurrentEditorInfo handles custom editor with different view type', () => {
    // Create a proper mock that passes instanceof check but with different view type
    const mockCustomInput = Object.create(vscode.TabInputCustom.prototype);
    mockCustomInput.viewType = 'different.view.type';
    mockCustomInput.uri = vscode.Uri.file('/test/config.sha.json');
    
    const mockCustomTab = {
      input: mockCustomInput
    } as vscode.Tab;
    
    const mockTextEditor = {
      document: {
        fileName: '/test/config.sha.json',
        uri: vscode.Uri.file('/test/config.sha.json')
      }
    } as vscode.TextEditor;

    const result = configViewToggler['getCurrentEditorInfo'](mockCustomTab, mockTextEditor);

    assert.deepStrictEqual(result.documentUri, vscode.Uri.file('/test/config.sha.json'), 'Should fall back to text editor');
    assert.strictEqual(result.isInCustomEditor, false, 'Should identify as text editor');
  });

  test('getCurrentEditorInfo handles empty file name', () => {
    const mockTextEditor = {
      document: {
        fileName: '',
        uri: vscode.Uri.file('')
      }
    } as vscode.TextEditor;

    const result = configViewToggler['getCurrentEditorInfo'](undefined, mockTextEditor);

    assert.strictEqual(result.documentUri, undefined, 'Should return undefined for empty file name');
    assert.strictEqual(result.isInCustomEditor, false, 'Should not be in custom editor');
  });

  test('toggle method logs warning when no document found', async () => {
    const warnSpy = sandbox.spy(configViewToggler['logger'], 'warn');
    
    // Mock scenario with no config file
    const mockGlslEditor = {
      document: {
        fileName: '/test/shader.glsl',
        uri: vscode.Uri.file('/test/shader.glsl')
      }
    } as vscode.TextEditor;
    
    // Use Object.defineProperty to stub the activeTextEditor
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: mockGlslEditor,
      configurable: true,
      writable: true
    });
    
    // Mock tabGroups
    const mockTabGroups = {
      activeTabGroup: {
        activeTab: undefined
      }
    };
    Object.defineProperty(vscode.window, 'tabGroups', {
      value: mockTabGroups,
      configurable: true,
      writable: true
    });

    await configViewToggler.toggle();

    assert.ok(warnSpy.calledOnce, 'Should log warning when no config file found');
    assert.ok(warnSpy.calledWith('No shader config file found to toggle'), 'Should log specific warning message');
    
    // Clean up
    delete (vscode.window as any).activeTextEditor;
    delete (vscode.window as any).tabGroups;
  });

  test('toggle method handles switchToTextEditor errors', async () => {
    const errorSpy = sandbox.spy(configViewToggler['logger'], 'error');
    const showMessageSpy = sandbox.stub(vscode.window, 'showErrorMessage').resolves();
    
    const mockConfigUri = vscode.Uri.file('/test/config.sha.json');
    
    // Create a proper mock that passes instanceof check
    const mockCustomInput = Object.create(vscode.TabInputCustom.prototype);
    mockCustomInput.viewType = Constants.CONFIG_EDITOR_VIEW_TYPE;
    mockCustomInput.uri = mockConfigUri;
    
    const mockCustomTab = {
      input: mockCustomInput
    } as vscode.Tab;
    
    // Use Object.defineProperty to stub the activeTextEditor
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: undefined,
      configurable: true,
      writable: true
    });
    
    // Mock tabGroups
    const mockTabGroups = {
      activeTabGroup: {
        activeTab: mockCustomTab
      }
    };
    Object.defineProperty(vscode.window, 'tabGroups', {
      value: mockTabGroups,
      configurable: true,
      writable: true
    });
    
    // Mock switchToTextEditor to throw an error
    sandbox.stub(configViewToggler as any, 'switchToTextEditor').rejects(new Error('Test error'));

    await configViewToggler.toggle();

    assert.ok(errorSpy.called, 'Should log error when switchToTextEditor fails');
    assert.ok(showMessageSpy.called, 'Should show error message to user');
    
    // Clean up
    delete (vscode.window as any).activeTextEditor;
    delete (vscode.window as any).tabGroups;
  });

  test('toggle method handles switchToCustomEditor errors', async () => {
    const errorSpy = sandbox.spy(configViewToggler['logger'], 'error');
    const showMessageSpy = sandbox.stub(vscode.window, 'showErrorMessage').resolves();
    
    const mockConfigUri = vscode.Uri.file('/test/config.sha.json');
    const mockTextEditor = {
      document: {
        fileName: '/test/config.sha.json',
        uri: mockConfigUri
      }
    } as vscode.TextEditor;
    
    // Use Object.defineProperty to stub the activeTextEditor
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: mockTextEditor,
      configurable: true,
      writable: true
    });
    
    // Mock tabGroups
    const mockTabGroups = {
      activeTabGroup: {
        activeTab: undefined
      }
    };
    Object.defineProperty(vscode.window, 'tabGroups', {
      value: mockTabGroups,
      configurable: true,
      writable: true
    });
    
    // Mock switchToCustomEditor to throw an error
    sandbox.stub(configViewToggler as any, 'switchToCustomEditor').rejects(new Error('Test error'));

    await configViewToggler.toggle();

    assert.ok(errorSpy.called, 'Should log error when switchToCustomEditor fails');
    assert.ok(showMessageSpy.called, 'Should show error message to user');
    
    // Clean up
    delete (vscode.window as any).activeTextEditor;
    delete (vscode.window as any).tabGroups;
  });
});
