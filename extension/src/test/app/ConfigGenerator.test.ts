import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConfigGenerator } from '../../app/ConfigGenerator';
import { GlslFileTracker } from '../../app/GlslFileTracker';
import { Messenger } from '../../app/transport/Messenger';
import { Logger } from '../../app/services/Logger';

suite('ConfigGenerator Test Suite', () => {
  let configGenerator: ConfigGenerator;
  let glslFileTracker: GlslFileTracker;
  let messenger: Messenger;
  let logger: Logger;
  let sandbox: sinon.SinonSandbox;
  let mockContext: vscode.ExtensionContext;
  let mockOutputChannel: vscode.LogOutputChannel;
  let mockDiagnosticCollection: vscode.DiagnosticCollection;

  setup(() => {
    sandbox = sinon.createSandbox();
    
    mockOutputChannel = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      dispose: sandbox.stub(),
      appendLine: sandbox.stub(),
      append: sandbox.stub(),
      clear: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub(),
      name: 'Test Output',
      replace: sandbox.stub(),
    } as any;

    mockDiagnosticCollection = {
      set: sandbox.stub(),
      delete: sandbox.stub(),
      clear: sandbox.stub(),
      dispose: sandbox.stub(),
      name: 'Test Diagnostics',
      has: sandbox.stub().returns(false),
      get: sandbox.stub().returns([]),
      forEach: sandbox.stub(),
    } as any;

    mockContext = {
      extensionPath: '/mock/extension/path',
      globalState: {
        get: sandbox.stub().callsFake((key: string, defaultValue?: any) => defaultValue),
        update: sandbox.stub().resolves(),
        keys: sandbox.stub().returns([]),
        setKeysForSync: sandbox.stub()
      } as any,
      workspaceState: {
        get: sandbox.stub().callsFake((key: string, defaultValue?: any) => defaultValue),
        update: sandbox.stub().resolves(),
        keys: sandbox.stub().returns([]),
        setKeysForSync: sandbox.stub()
      } as any,
      subscriptions: [],
      asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
      extensionMode: vscode.ExtensionMode.Test,
      extension: {} as any,
      extensionUri: vscode.Uri.file('/mock/extension/path'),
      globalStorageUri: vscode.Uri.file('/mock/global/storage'),
      logUri: vscode.Uri.file('/mock/log'),
      storagePath: '/mock/storage',
      globalStoragePath: '/mock/global/storage',
      logPath: '/mock/log',
      secrets: {} as any,
      environmentVariableCollection: {} as any,
      storageUri: vscode.Uri.file('/mock/storage'),
      languageModelAccessInformation: {} as any,
    };

    // Initialize logger
    Logger.initialize(mockOutputChannel);
    logger = Logger.getInstance();

    // Create dependencies
    glslFileTracker = new GlslFileTracker(mockContext);
    messenger = new Messenger(mockOutputChannel, mockDiagnosticCollection);
    
    // Create ConfigGenerator
    configGenerator = new ConfigGenerator(glslFileTracker, messenger, logger);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('should generate config using last viewed GLSL file when no active editor and preview is focused', async () => {
    const fs = require('fs');
    const path = require('path');
    
    // Mock the last viewed GLSL file
    const lastViewedFile = '/mock/path/last_viewed_shader.glsl';
    glslFileTracker.setLastViewedGlslFile(lastViewedFile);
    
    // Mock active clients (preview is open)
    sandbox.stub(messenger, 'hasActiveClients').returns(true);
    
    // Mock file system operations - need to handle both the GLSL file check and config file check
    const existsSyncStub = sandbox.stub(fs, 'existsSync').callsFake((filePath: any) => {
      if (filePath === lastViewedFile) {
        return true; // GLSL file exists
      }
      if (filePath.endsWith('.sha.json')) {
        return false; // Config file doesn't exist
      }
      return false;
    });
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    
    // Mock vscode commands and window
    const showOpenDialogStub = sandbox.stub(vscode.window, 'showOpenDialog').resolves([]);
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();
    
    // Mock active editor as null or non-GLSL
    sandbox.stub(vscode.window, 'activeTextEditor').value(null);
    
    // Call generateConfig
    await configGenerator.generateConfig();
    
    // Verify it used the last viewed file instead of showing open dialog
    sinon.assert.notCalled(showOpenDialogStub);
    sinon.assert.called(existsSyncStub);
    sinon.assert.calledWith(existsSyncStub, lastViewedFile);
    
    // Verify config file was created and opened
    const expectedConfigPath = path.join(path.dirname(lastViewedFile), 'last_viewed_shader.sha.json');
    sinon.assert.calledOnce(writeFileSyncStub);
    sinon.assert.calledWith(writeFileSyncStub, expectedConfigPath, sinon.match(/"version": "1.0"/));
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(executeCommandStub, 'vscode.open', vscode.Uri.file(expectedConfigPath));
    
    // Verify success message
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWith(showInfoStub, 'Generated config file: last_viewed_shader.sha.json');
  });

  test('should fall back to file dialog when no active preview and no active editor', async () => {
    const fs = require('fs');
    
    // Mock no last viewed file by setting the internal state directly
    glslFileTracker['lastViewedGlslFile'] = null;
    
    // Mock no active clients (no preview)
    sandbox.stub(messenger, 'hasActiveClients').returns(false);
    
    // Mock file system operations
    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(false);
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    
    // Mock file dialog selection
    const selectedFile = vscode.Uri.file('/mock/path/selected_shader.glsl');
    const showOpenDialogStub = sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedFile]);
    
    // Mock vscode commands and window
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();
    
    // Mock active editor as null
    sandbox.stub(vscode.window, 'activeTextEditor').value(null);
    
    // Call generateConfig
    await configGenerator.generateConfig();
    
    // Verify it showed the open dialog since no active preview
    sinon.assert.calledOnce(showOpenDialogStub);
    // existsSync should be called once for the config file check
    sinon.assert.calledOnce(existsSyncStub);
    
    // Verify config file was created and opened
    sinon.assert.calledOnce(writeFileSyncStub);
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledOnce(showInfoStub);
  });

  test('should fall back to file dialog when last viewed GLSL file does not exist even with active preview', async () => {
    const fs = require('fs');
    
    // Mock last viewed file that doesn't exist
    const lastViewedFile = '/mock/path/nonexistent_shader.glsl';
    glslFileTracker.setLastViewedGlslFile(lastViewedFile);
    
    // Mock active clients (preview is open)
    sandbox.stub(messenger, 'hasActiveClients').returns(true);
    
    // Mock file system operations - GLSL file doesn't exist, config file doesn't exist
    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(false);
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    
    // Mock file dialog selection
    const selectedFile = vscode.Uri.file('/mock/path/selected_shader.glsl');
    const showOpenDialogStub = sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedFile]);
    
    // Mock vscode commands and window
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();
    
    // Mock active editor as null
    sandbox.stub(vscode.window, 'activeTextEditor').value(null);
    
    // Call generateConfig
    await configGenerator.generateConfig();
    
    // Verify it checked for file existence, then fell back to dialog
    // Should be called twice: once for GLSL file, once for config file
    sinon.assert.calledTwice(existsSyncStub);
    sinon.assert.calledWith(existsSyncStub, lastViewedFile);
    sinon.assert.calledOnce(showOpenDialogStub);
    
    // Verify config file was created and opened
    sinon.assert.calledOnce(writeFileSyncStub);
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledOnce(showInfoStub);
  });

  test('should use active GLSL editor when available', async () => {
    const fs = require('fs');
    const path = require('path');
    
    // Mock active GLSL editor
    const activeEditor = {
      document: {
        fileName: '/mock/path/active_shader.glsl',
        languageId: 'glsl',
        uri: vscode.Uri.file('/mock/path/active_shader.glsl'),
      }
    } as vscode.TextEditor;
    
    sandbox.stub(vscode.window, 'activeTextEditor').value(activeEditor);
    
    // Mock file system operations
    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(false);
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    
    // Mock vscode commands and window
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();
    
    // Call generateConfig
    await configGenerator.generateConfig();
    
    // Verify it used the active editor file
    const expectedConfigPath = path.join(path.dirname(activeEditor.document.fileName), 'active_shader.sha.json');
    sinon.assert.calledOnce(writeFileSyncStub);
    sinon.assert.calledWith(writeFileSyncStub, expectedConfigPath, sinon.match(/"version": "1.0"/));
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(executeCommandStub, 'vscode.open', vscode.Uri.file(expectedConfigPath));
    
    // Verify success message
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWith(showInfoStub, 'Generated config file: active_shader.sha.json');
  });

  test('should use provided URI when available', async () => {
    const fs = require('fs');
    const path = require('path');
    
    // Mock provided URI
    const providedUri = vscode.Uri.file('/mock/path/provided_shader.glsl');
    
    // Mock file system operations
    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(false);
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    
    // Mock vscode commands and window
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();
    
    // Call generateConfig with URI
    await configGenerator.generateConfig(providedUri);
    
    // Verify it used the provided URI
    const expectedConfigPath = path.join(path.dirname(providedUri.fsPath), 'provided_shader.sha.json');
    sinon.assert.calledOnce(writeFileSyncStub);
    sinon.assert.calledWith(writeFileSyncStub, expectedConfigPath, sinon.match(/"version": "1.0"/));
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(executeCommandStub, 'vscode.open', vscode.Uri.file(expectedConfigPath));
    
    // Verify success message
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWith(showInfoStub, 'Generated config file: provided_shader.sha.json');
  });

  test('should show confirmation when showConfirmation is true', async () => {
    const fs = require('fs');
    
    // Mock active GLSL editor
    const activeEditor = {
      document: {
        fileName: '/mock/path/active_shader.glsl',
        languageId: 'glsl',
        uri: vscode.Uri.file('/mock/path/active_shader.glsl'),
      }
    } as vscode.TextEditor;
    
    sandbox.stub(vscode.window, 'activeTextEditor').value(activeEditor);
    
    // Mock file system operations
    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(false);
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    
    // Mock confirmation dialog
    const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Yes' as any);
    
    // Mock vscode commands
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    
    // Call generateConfig with confirmation
    await configGenerator.generateConfig(undefined, true);
    
    // Verify it showed confirmation and created the config
    sinon.assert.calledTwice(showInfoStub);
    sinon.assert.calledWith(showInfoStub, 'Generate config file for active_shader.glsl?', 'Yes' as any, 'No' as any);
    sinon.assert.calledOnce(writeFileSyncStub);
    sinon.assert.calledOnce(executeCommandStub);
  });

  test('should handle file dialog cancellation', async () => {
    const fs = require('fs');
    
    // Mock no last viewed file and no active preview
    glslFileTracker['lastViewedGlslFile'] = null;
    sandbox.stub(messenger, 'hasActiveClients').returns(false);
    
    // Mock file dialog cancellation
    const showOpenDialogStub = sandbox.stub(vscode.window, 'showOpenDialog').resolves([]);
    
    // Mock active editor as null
    sandbox.stub(vscode.window, 'activeTextEditor').value(null);
    
    // Call generateConfig and expect it to not throw
    await configGenerator.generateConfig();
    
    // Verify it showed the dialog and cancelled gracefully
    sinon.assert.calledOnce(showOpenDialogStub);
  });

  test('should handle errors gracefully', async () => {
    // Mock file system error
    const fs = require('fs');
    sandbox.stub(fs, 'existsSync').throws(new Error('File system error'));
    
    // Mock active editor as null to trigger file dialog path
    sandbox.stub(vscode.window, 'activeTextEditor').value(null);
    sandbox.stub(messenger, 'hasActiveClients').returns(false);
    
    // Mock file dialog to return a file
    const selectedFile = vscode.Uri.file('/mock/path/selected_shader.glsl');
    sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedFile]);
    
    // Mock error message
    const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();
    
    // Call generateConfig
    await configGenerator.generateConfig();
    
    // Verify error was handled
    sinon.assert.calledOnce(showErrorStub);
    sinon.assert.calledWith(showErrorStub, 'Failed to generate config: Error: File system error');
  });
});
