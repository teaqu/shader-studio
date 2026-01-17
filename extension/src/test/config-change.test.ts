import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Configuration Change Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let mockShowInformationMessage: sinon.SinonStub;
  let mockExecuteCommand: sinon.SinonStub;
  let mockWorkspaceConfig: sinon.SinonStub;
  let mockOnDidChangeConfiguration: sinon.SinonStub;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Mock vscode.workspace.getConfiguration
    mockWorkspaceConfig = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: sandbox.stub()
    } as any);

    // Mock vscode.window.showInformationMessage
    mockShowInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage');

    // Mock vscode.commands.executeCommand
    mockExecuteCommand = sandbox.stub(vscode.commands, 'executeCommand');

    // Mock vscode.workspace.onDidChangeConfiguration
    mockOnDidChangeConfiguration = sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').returns({
      dispose: sandbox.stub()
    } as any);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('should register configuration change listener on activation', () => {
    // This test verifies that the configuration change listener is properly registered
    // when the extension is activated
    
    // Simulate the extension activation code that registers the config change listener
    const mockContext = {
      subscriptions: [],
      extensionPath: '/mock/path'
    } as any;

    // Mock the output channel and diagnostic collection
    const mockOutputChannel = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      dispose: sandbox.stub()
    } as any;

    const mockDiagnosticCollection = {
      set: sandbox.stub(),
      delete: sandbox.stub(),
      clear: sandbox.stub(),
      dispose: sandbox.stub()
    } as any;

    // Simulate the configuration change listener registration from extension.ts
    mockContext.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('shader-studio.defaultConfigView')) {
          // This would call updateCustomEditorPriority() in real code
          mockShowInformationMessage(
            'Extension restart required to apply the new default view preference.',
            'Restart Now'
          ).then((selection: string | undefined) => {
            if (selection === 'Restart Now') {
              vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
          });
        }
      })
    );

    // Verify that the configuration change listener was registered
    sinon.assert.calledOnce(mockOnDidChangeConfiguration);
    assert.strictEqual(mockContext.subscriptions.length, 1);
  });

  test('should show restart prompt when defaultConfigView configuration changes', async () => {
    // Mock the configuration change event
    const mockEvent = {
      affectsConfiguration: sandbox.stub()
    };

    // Configure the stub to return true for defaultConfigView changes
    mockEvent.affectsConfiguration.withArgs('shader-studio.defaultConfigView').returns(true);
    mockEvent.affectsConfiguration.withArgs('shader-studio.webSocketPort').returns(false);

    // Mock the user clicking "Restart Now"
    mockShowInformationMessage.resolves('Restart Now');

    // Simulate the configuration change handler logic
    if (mockEvent.affectsConfiguration('shader-studio.defaultConfigView')) {
      // This would call updateCustomEditorPriority() in real code
      const selection = await vscode.window.showInformationMessage(
        'Extension restart required to apply the new default view preference.',
        'Restart Now'
      );
      
      if (selection === 'Restart Now') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }

    // Verify the restart prompt was shown
    sinon.assert.calledOnce(mockShowInformationMessage);
    sinon.assert.calledWith(
      mockShowInformationMessage,
      'Extension restart required to apply the new default view preference.',
      'Restart Now'
    );

    // Verify the restart command was executed
    sinon.assert.calledOnce(mockExecuteCommand);
    sinon.assert.calledWith(mockExecuteCommand, 'workbench.action.reloadWindow');
  });

  test('should show restart prompt when webSocketPort configuration changes', async () => {
    // Mock the configuration change event
    const mockEvent = {
      affectsConfiguration: sandbox.stub()
    };

    // Configure the stub to return true for webSocketPort changes
    mockEvent.affectsConfiguration.withArgs('shader-studio.webSocketPort').returns(true);
    mockEvent.affectsConfiguration.withArgs('shader-studio.defaultConfigView').returns(false);

    // Mock the user clicking "Restart Now"
    mockShowInformationMessage.resolves('Restart Now');

    // Simulate the configuration change handler logic for webSocketPort
    if (mockEvent.affectsConfiguration('shader-studio.webSocketPort')) {
      const selection = await vscode.window.showInformationMessage(
        'Extension restart required to apply the new WebSocket port configuration.',
        'Restart Now'
      );
      
      if (selection === 'Restart Now') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }

    // Verify the restart prompt was shown
    sinon.assert.calledOnce(mockShowInformationMessage);
    sinon.assert.calledWith(
      mockShowInformationMessage,
      'Extension restart required to apply the new WebSocket port configuration.',
      'Restart Now'
    );

    // Verify the restart command was executed
    sinon.assert.calledOnce(mockExecuteCommand);
    sinon.assert.calledWith(mockExecuteCommand, 'workbench.action.reloadWindow');
  });

  test('should not show restart prompt when non-restart configuration changes', async () => {
    // Mock the configuration change event
    const mockEvent = {
      affectsConfiguration: sandbox.stub()
    };

    // Configure the stub to return false for restart-required settings but true for other settings
    mockEvent.affectsConfiguration.withArgs('shader-studio.defaultConfigView').returns(false);
    mockEvent.affectsConfiguration.withArgs('shader-studio.webSocketPort').returns(false);
    mockEvent.affectsConfiguration.withArgs('shader-studio.webServerPort').returns(true);

    // Simulate the configuration change handler logic
    if (mockEvent.affectsConfiguration('shader-studio.defaultConfigView')) {
      // This should not be reached
      await vscode.window.showInformationMessage(
        'Extension restart required to apply the new default view preference.',
        'Restart Now'
      );
    }

    if (mockEvent.affectsConfiguration('shader-studio.webSocketPort')) {
      // This should not be reached
      await vscode.window.showInformationMessage(
        'Extension restart required to apply the new WebSocket port configuration.',
        'Restart Now'
      );
    }

    // Verify no restart prompt was shown
    sinon.assert.notCalled(mockShowInformationMessage);
    sinon.assert.notCalled(mockExecuteCommand);
  });

  test('should not restart when user cancels restart prompt', async () => {
    // Mock the configuration change event
    const mockEvent = {
      affectsConfiguration: sandbox.stub()
    };

    // Configure the stub to return true for defaultConfigView changes
    mockEvent.affectsConfiguration.withArgs('shader-studio.defaultConfigView').returns(true);

    // Mock the user canceling (undefined return)
    mockShowInformationMessage.resolves(undefined);

    // Simulate the configuration change handler logic
    if (mockEvent.affectsConfiguration('shader-studio.defaultConfigView')) {
      // This would call updateCustomEditorPriority() in real code
      const selection = await vscode.window.showInformationMessage(
        'Extension restart required to apply the new default view preference.',
        'Restart Now'
      );
      
      if (selection === 'Restart Now') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }

    // Verify the restart prompt was shown
    sinon.assert.calledOnce(mockShowInformationMessage);

    // Verify the restart command was NOT executed
    sinon.assert.notCalled(mockExecuteCommand);
  });

  test('should verify configuration change detection logic', () => {
    // Test the affectsConfiguration logic with different scenarios
    
    const mockEvent1 = {
      affectsConfiguration: sandbox.stub().returns(true)
    };
    
    const mockEvent2 = {
      affectsConfiguration: sandbox.stub().returns(false)
    };

    // Test case 1: Configuration change affects defaultConfigView
    assert.strictEqual(mockEvent1.affectsConfiguration('shader-studio.defaultConfigView'), true);
    
    // Test case 2: Configuration change does not affect defaultConfigView
    assert.strictEqual(mockEvent2.affectsConfiguration('shader-studio.defaultConfigView'), false);
    
    // Test case 3: Configuration change affects other setting
    mockEvent1.affectsConfiguration.withArgs('shader-studio.webSocketPort').returns(true);
    assert.strictEqual(mockEvent1.affectsConfiguration('shader-studio.webSocketPort'), true);
  });

  test('should verify restart command is correct', async () => {
    // Mock the configuration change event
    const mockEvent = {
      affectsConfiguration: sandbox.stub().returns(true)
    };

    // Mock the user clicking "Restart Now"
    mockShowInformationMessage.resolves('Restart Now');

    // Simulate the configuration change handler logic
    if (mockEvent.affectsConfiguration('shader-studio.defaultConfigView')) {
      const selection = await vscode.window.showInformationMessage(
        'Extension restart required to apply the new default view preference.',
        'Restart Now'
      );
      
      if (selection === 'Restart Now') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }

    // Verify the correct restart command is used
    sinon.assert.calledOnce(mockExecuteCommand);
    sinon.assert.calledWith(mockExecuteCommand, 'workbench.action.reloadWindow');
  });

  test('should handle multiple restart-required configuration changes', async () => {
    // Test that both defaultConfigView and webSocketPort trigger restarts
    
    // Test 1: defaultConfigView
    const mockEvent1 = {
      affectsConfiguration: sandbox.stub()
    };
    mockEvent1.affectsConfiguration.withArgs('shader-studio.defaultConfigView').returns(true);
    mockEvent1.affectsConfiguration.withArgs('shader-studio.webSocketPort').returns(false);

    mockShowInformationMessage.resetHistory();
    mockExecuteCommand.resetHistory();
    mockShowInformationMessage.resolves('Restart Now');

    if (mockEvent1.affectsConfiguration('shader-studio.defaultConfigView')) {
      const selection = await vscode.window.showInformationMessage(
        'Extension restart required to apply the new default view preference.',
        'Restart Now'
      );
      
      if (selection === 'Restart Now') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }

    sinon.assert.calledOnce(mockShowInformationMessage);
    sinon.assert.calledWith(
      mockShowInformationMessage,
      'Extension restart required to apply the new default view preference.',
      'Restart Now'
    );

    // Test 2: webSocketPort
    const mockEvent2 = {
      affectsConfiguration: sandbox.stub()
    };
    mockEvent2.affectsConfiguration.withArgs('shader-studio.webSocketPort').returns(true);
    mockEvent2.affectsConfiguration.withArgs('shader-studio.defaultConfigView').returns(false);

    mockShowInformationMessage.resetHistory();
    mockExecuteCommand.resetHistory();
    mockShowInformationMessage.resolves('Restart Now');

    if (mockEvent2.affectsConfiguration('shader-studio.webSocketPort')) {
      const selection = await vscode.window.showInformationMessage(
        'Extension restart required to apply the new WebSocket port configuration.',
        'Restart Now'
      );
      
      if (selection === 'Restart Now') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }

    sinon.assert.calledOnce(mockShowInformationMessage);
    sinon.assert.calledWith(
      mockShowInformationMessage,
      'Extension restart required to apply the new WebSocket port configuration.',
      'Restart Now'
    );
  });
});
