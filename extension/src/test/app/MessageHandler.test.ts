import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { MessageHandler } from '../../app/transport/MessageHandler';
import { ShowConfigMessage, GenerateConfigMessage } from '@shader-studio/types';

suite('MessageHandler Test Suite', () => {
  let messageHandler: MessageHandler;
  let mockOutputChannel: vscode.LogOutputChannel;
  let mockDiagnosticCollection: vscode.DiagnosticCollection;
  let sandbox: sinon.SinonSandbox;

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

    messageHandler = new MessageHandler(mockOutputChannel, mockDiagnosticCollection);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('should handle showConfig message when config file exists', () => {
    const fs = require('fs');
    
    // Mock file system - config exists
    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(true);
    
    // Mock vscode commands
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    
    // Create showConfig message
    const message: ShowConfigMessage = {
      type: 'showConfig',
      payload: {
        shaderPath: '/mock/path/shader.sha.json'
      }
    };
    
    // Handle the message
    messageHandler.handleMessage(message);
    
    // Verify it checked for file existence and opened the config
    sinon.assert.calledOnce(existsSyncStub);
    sinon.assert.calledWith(existsSyncStub, '/mock/path/shader.sha.json');
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(executeCommandStub, 'vscode.open', vscode.Uri.file('/mock/path/shader.sha.json'));
  });

  test('should handle showConfig message when config file does not exist', () => {
    const fs = require('fs');
    
    // Mock file system - config does not exist
    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(false);
    
    // Mock vscode commands
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    
    // Create showConfig message
    const message: ShowConfigMessage = {
      type: 'showConfig',
      payload: {
        shaderPath: '/mock/path/shader.sha.json'
      }
    };
    
    // Handle the message
    messageHandler.handleMessage(message);
    
    // Verify it checked for file existence and requested config generation
    sinon.assert.calledOnce(existsSyncStub);
    sinon.assert.calledWith(existsSyncStub, '/mock/path/shader.sha.json');
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(executeCommandStub, 'shader-studio.generateConfigFromUI', vscode.Uri.file('/mock/path/shader.glsl'));
  });

  test('should handle generateConfig message with shader path', () => {
    // Mock vscode commands
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    
    // Create generateConfig message
    const message: GenerateConfigMessage = {
      type: 'generateConfig',
      payload: {
        shaderPath: '/mock/path/shader.glsl'
      }
    };
    
    // Handle the message
    messageHandler.handleMessage(message);
    
    // Verify it requested config generation with the shader path
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(executeCommandStub, 'shader-studio.generateConfigFromUI', vscode.Uri.file('/mock/path/shader.glsl'));
  });

  test('should handle generateConfig message without shader path', () => {
    // Mock vscode commands
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    
    // Create generateConfig message without path
    const message: GenerateConfigMessage = {
      type: 'generateConfig',
      payload: {}
    };
    
    // Handle the message
    messageHandler.handleMessage(message);
    
    // Verify it requested config generation without URI
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(executeCommandStub, 'shader-studio.generateConfigFromUI');
  });
});
