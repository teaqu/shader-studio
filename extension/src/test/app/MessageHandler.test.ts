import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { MessageHandler } from '../../app/transport/MessageHandler';
import { ErrorHandler } from '../../app/ErrorHandler';
import { ShowConfigMessage, GenerateConfigMessage, ShaderSourceMessage, LogMessage, ErrorMessage, WarningMessage } from '@shader-studio/types';

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

    const errorHandler = new ErrorHandler(mockOutputChannel, mockDiagnosticCollection);
    messageHandler = new MessageHandler(mockOutputChannel, errorHandler);
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

  test('should clear errors when shader compilation succeeds', () => {
    // Set up current shader config
    const shaderSourceEvent: ShaderSourceMessage = {
      type: 'shaderSource',
      code: 'test code',
      config: { passes: { BufferA: { path: './buffer.glsl' } } },
      path: '/test/shader.glsl',
      buffers: {}
    };
    messageHandler.handleMessage(shaderSourceEvent);

    // Send shader compilation success message
    const successEvent: LogMessage = {
      type: 'log',
      payload: ['Shader compiled and linked']
    };
    messageHandler.handleMessage(successEvent);

    // Verify ALL errors were cleared
    sinon.assert.calledOnce(mockDiagnosticCollection.clear as any);
  });

  test('should clear errors when buffer update succeeds', () => {
    // Set up current shader config
    const shaderSourceEvent: ShaderSourceMessage = {
      type: 'shaderSource',
      code: 'test code',
      config: { passes: { BufferA: { path: './buffer.glsl' } } },
      path: '/test/shader.glsl',
      buffers: {}
    };
    messageHandler.handleMessage(shaderSourceEvent);

    const bufferSuccessEvent: LogMessage = {
      type: 'log',
      payload: ['Buffer \'BufferA\' updated and pipeline recompiled']
    };
    messageHandler.handleMessage(bufferSuccessEvent);

    // Verify errors were cleared
    sinon.assert.calledOnce(mockDiagnosticCollection.clear as any);
  });

  test('should show non-line-number errors at line 1', () => {
    // Mock active editor and document
    const mockDocument = {
      uri: vscode.Uri.file('/test/shader.glsl'),
      lineCount: 10,
      lineAt: sandbox.stub().returns({
        range: new vscode.Range(0, 0, 0, 0)
      })
    } as any;

    const mockEditor = {
      document: mockDocument
    } as any;

    const activeTextEditorStub = sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

    // Test video loading error
    const videoErrorEvent: ErrorMessage = {
      type: 'error',
      payload: ['Shader compilation error: Error: Failed to load video texture from video.webm: Failed to load video from URL: video.webm - Unknown error']
    };

    messageHandler.handleMessage(videoErrorEvent);

    // Verify error was logged
    sinon.assert.calledWith(mockOutputChannel.error as any, 'Shader compilation error: Error: Failed to load video texture from video.webm: Failed to load video from URL: video.webm - Unknown error');

    // Verify diagnostic was set at line 1 (first line of document)
    sinon.assert.calledOnce(mockDiagnosticCollection.set as any);
    const setCall = (mockDiagnosticCollection.set as any).getCall(0);
    assert.strictEqual(setCall.args[0], mockDocument.uri);
    assert.strictEqual(setCall.args[1][0].message, 'Shader compilation error: Error: Failed to load video texture from video.webm: Failed to load video from URL: video.webm - Unknown error');
    assert.strictEqual(setCall.args[1][0].severity, vscode.DiagnosticSeverity.Error);
    assert.deepStrictEqual(setCall.args[1][0].range, new vscode.Range(0, 0, 0, 0));
  });

  test('should show various non-line-number errors at line 1', () => {
    // Mock active editor and document
    const mockDocument = {
      uri: vscode.Uri.file('/test/shader.glsl'),
      lineCount: 5,
      lineAt: sandbox.stub().returns({
        range: new vscode.Range(0, 0, 0, 0)
      })
    } as any;

    const mockEditor = {
      document: mockDocument
    } as any;

    const activeTextEditorStub = sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

    // Test different types of non-line-number errors
    const testCases = [
      'Failed to load texture: file not found',
      'Configuration error: invalid input type',
      'Resource loading failed: network error',
      'Shader validation error: unsupported operation'
    ];

    testCases.forEach((errorMessage, index) => {
      // Reset stubs for each test case
      (mockDiagnosticCollection.set as any).resetHistory();

      const errorEvent: ErrorMessage = {
        type: 'error',
        payload: [errorMessage]
      };

      messageHandler.handleMessage(errorEvent);

      // Verify diagnostic was set for each error type
      sinon.assert.calledOnce(mockDiagnosticCollection.set as any);
      const setCall = (mockDiagnosticCollection.set as any).getCall(0);
      assert.strictEqual(setCall.args[1][0].message, errorMessage);
      assert.strictEqual(setCall.args[1][0].severity, vscode.DiagnosticSeverity.Error);
    });
  });

  test('should handle warning messages and show as persistent warning', () => {
    // Mock active editor and document with GLSL language
    const mockDocument = {
      uri: vscode.Uri.file('/test/shader.glsl'),
      lineCount: 10,
      languageId: 'glsl',
      lineAt: sandbox.stub().returns({
        range: new vscode.Range(0, 0, 0, 0)
      })
    } as any;

    const mockEditor = {
      document: mockDocument
    } as any;

    sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

    const warningMessage: WarningMessage = {
      type: 'warning',
      payload: ['Video is not loading: video.webm. If using in a VS Code panel, try opening Shader Studio in its own window or browser.']
    };

    messageHandler.handleMessage(warningMessage);

    // Verify warning was logged
    sinon.assert.calledWith(mockOutputChannel.warn as any, sinon.match.string);

    // Verify diagnostic was set with warning severity
    sinon.assert.calledOnce(mockDiagnosticCollection.set as any);
    const setCall = (mockDiagnosticCollection.set as any).getCall(0);
    assert.strictEqual(setCall.args[1][0].severity, vscode.DiagnosticSeverity.Warning);
  });

  test('should handle video loading warning message', () => {
    // Mock active editor and document with GLSL language
    const mockDocument = {
      uri: vscode.Uri.file('/test/shader.glsl'),
      lineCount: 10,
      languageId: 'glsl',
      lineAt: sandbox.stub().returns({
        range: new vscode.Range(0, 0, 0, 0)
      })
    } as any;

    const mockEditor = {
      document: mockDocument
    } as any;

    sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

    // Test the exact warning message format from ResourceManager
    const warningMessage: WarningMessage = {
      type: 'warning',
      payload: ['Video is not loading: /path/to/video.mp4. If using in a VS Code panel, try opening Shader Studio in its own window or browser. You could also try converting the video to MP4 (H.264) or WebM format.']
    };

    messageHandler.handleMessage(warningMessage);

    // Verify warning was logged to output channel
    sinon.assert.calledOnce(mockOutputChannel.warn as any);

    // Verify diagnostic was set
    sinon.assert.calledOnce(mockDiagnosticCollection.set as any);
    const setCall = (mockDiagnosticCollection.set as any).getCall(0);
    assert.ok(setCall.args[1][0].message.includes('Video is not loading'));
    assert.strictEqual(setCall.args[1][0].severity, vscode.DiagnosticSeverity.Warning);
  });
});
