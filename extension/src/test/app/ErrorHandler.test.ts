import * as assert from 'assert';
import * as vscode from 'vscode';
import { ErrorMessage, WarningMessage } from '@shader-studio/types';
import { ErrorHandler } from '../../app/ErrorHandler';

suite('ErrorHandler Test Suite', () => {
  let mockOutputChannel: vscode.LogOutputChannel;
  let mockDiagnosticCollection: vscode.DiagnosticCollection;
  let errorHandler: ErrorHandler;
  let textDocumentChangeListener: ((event: vscode.TextDocumentChangeEvent) => void) | undefined;

  setup(() => {
    // Mock output channel
    mockOutputChannel = {
      name: 'Test ErrorHandler',
      append: () => { },
      appendLine: () => { },
      replace: () => { },
      clear: () => { },
      show: () => { },
      hide: () => { },
      dispose: () => { },
      logLevel: vscode.LogLevel.Debug,
      onDidChangeLogLevel: new vscode.EventEmitter<vscode.LogLevel>().event,
      error: (message: string) => { },
      warn: (message: string) => { },
      info: (message: string) => { },
      debug: (message: string) => { },
    } as any;

    // Mock diagnostic collection
    mockDiagnosticCollection = {
      name: 'Test Diagnostics',
      set: () => { },
      clear: () => { },
      delete: () => { },
      has: () => false,
      get: () => [],
      forEach: () => { },
      dispose: () => { },
    } as any;

    // Mock active editor
    const mockEditor = {
      document: {
        languageId: 'glsl',
        lineCount: 10,
        uri: vscode.Uri.file('/test/shader.glsl'),
        lineAt: (lineNumber: number) => ({
          range: new vscode.Range(lineNumber, 0, lineNumber, 0)
        })
      }
    } as any;

    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: mockEditor,
      writable: true
    });

    textDocumentChangeListener = undefined;
    const onDidChangeTextDocumentStub = ((listener: (event: vscode.TextDocumentChangeEvent) => void) => {
      textDocumentChangeListener = listener;
      return { dispose: () => { } };
    }) as typeof vscode.workspace.onDidChangeTextDocument;
    Object.defineProperty(vscode.workspace, 'onDidChangeTextDocument', {
      value: onDidChangeTextDocumentStub,
      configurable: true,
      writable: true,
    });

    errorHandler = new ErrorHandler(mockOutputChannel, mockDiagnosticCollection);
  });

  teardown(() => {
    errorHandler.dispose();
  });

  // Keep only meaningful behavioral tests
  test('should debounce identical errors', () => {
    const message: ErrorMessage = {
      type: 'error',
      payload: ['Duplicate error message']
    };

    let errorCallCount = 0;
    mockOutputChannel.error = () => {
      errorCallCount++; 
    };

    // Call the same error twice
    errorHandler.handleError(message);
    errorHandler.handleError(message);

    // Should only call error once (second one debounced)
    assert.equal(errorCallCount, 1, 'Second identical error should be debounced');
  });

  test('should allow identical errors again after clearPersistentErrors resets a fresh compile', () => {
    const message: ErrorMessage = {
      type: 'error',
      payload: ['Duplicate error message']
    };

    let errorCallCount = 0;
    mockOutputChannel.error = () => {
      errorCallCount++;
    };

    errorHandler.handleError(message);
    errorHandler.clearPersistentErrors();
    errorHandler.handleError(message);

    assert.equal(errorCallCount, 2, 'Fresh compile clears should not suppress the next identical error');
  });

  test('should normalize file path errors for debouncing', () => {
    const message1: ErrorMessage = {
      type: 'error',
      payload: ['Texture file not found: /path/to/file.jpg']
    };

    const message2: ErrorMessage = {
      type: 'error',
      payload: ['Image not found for Image.inputs.iChannel0: /path/to/file.jpg']
    };

    let errorCallCount = 0;
    mockOutputChannel.error = () => {
      errorCallCount++; 
    };

    // Call both errors (same file, different formats)
    errorHandler.handleError(message1);
    errorHandler.handleError(message2);

    // Should only call error once (second one debounced due to normalization)
    // This proves that different error message formats about the same file
    // get normalized to the same key and debounced
    assert.equal(errorCallCount, 1, 'Different error formats with same file path should be debounced');
  });

  test('should handle warning messages with correct severity', () => {
    const warningMessage: WarningMessage = {
      type: 'warning',
      payload: ['Test warning message']
    };

    let warnCalled = false;
    let errorCalled = false;
        
    mockOutputChannel.warn = () => {
      warnCalled = true; 
    };
    mockOutputChannel.error = () => {
      errorCalled = true; 
    };

    // Should not throw and should use warn channel
    assert.doesNotThrow(() => {
      errorHandler.handlePersistentError(warningMessage);
    });

    assert.ok(warnCalled, 'Warning should call outputChannel.warn');
    assert.ok(!errorCalled, 'Warning should not call outputChannel.error');
  });

  test('should handle error messages with correct severity', () => {
    const errorMessage: ErrorMessage = {
      type: 'error',
      payload: ['Test error message']
    };

    let warnCalled = false;
    let errorCalled = false;
        
    mockOutputChannel.warn = () => {
      warnCalled = true; 
    };
    mockOutputChannel.error = () => {
      errorCalled = true; 
    };

    // Should not throw and should use error channel
    assert.doesNotThrow(() => {
      errorHandler.handlePersistentError(errorMessage);
    });

    assert.ok(errorCalled, 'Error should call outputChannel.error');
    assert.ok(!warnCalled, 'Error should not call outputChannel.warn');
  });

  test('clearErrors should not clear persistent errors', () => {
    const persistentMessage: ErrorMessage = {
      type: 'error',
      payload: ['Texture file not found: /path/to/persistent.jpg']
    };

    const regularMessage: ErrorMessage = {
      type: 'error',
      payload: ['Regular error message']
    };

    let errorCallCount = 0;
    mockOutputChannel.error = () => {
      errorCallCount++; 
    };

    // Add persistent error first
    errorHandler.handlePersistentError(persistentMessage);
    assert.equal(errorCallCount, 1, 'First persistent error should be logged');
        
    // Add regular error
    errorHandler.handleError(regularMessage);
    assert.equal(errorCallCount, 2, 'Regular error should be logged');
        
    // Clear errors - should only clear regular errors, not persistent
    errorHandler.clearErrors();
        
    // Wait for debounce to expire then try persistent error again
    // It should still be debounced because persistent errors weren't cleared
    errorHandler.handlePersistentError(persistentMessage);
    assert.equal(errorCallCount, 2, 'Persistent error should still be debounced after clearErrors');
  });

  test('should handle WarningMessage type in handlePersistentError', () => {
    const warningMessage: WarningMessage = {
      type: 'warning',
      payload: ['Warning message']
    };

    let warnCalled = false;
    mockOutputChannel.warn = () => {
      warnCalled = true; 
    };

    errorHandler.handlePersistentError(warningMessage);
        
    assert.ok(warnCalled, 'WarningMessage should call outputChannel.warn');
  });

  test('should set and use shader config', () => {
    const config = {
      config: { passes: {} },
      shaderPath: '/path/to/shader.glsl'
    };

    // Set config and verify no errors
    errorHandler.setShaderConfig(config);
        
    // Set null config and verify no errors
    errorHandler.setShaderConfig(null);
        
    // No assertion needed - just verifying no exceptions
  });

  test('should handle non-line errors at default position', () => {
    const generalErrorMessage: ErrorMessage = {
      type: 'error',
      payload: ['General shader compilation failed']
    };

    let diagnosticSet = false;
    let errorCalled = false;
    mockDiagnosticCollection.set = () => {
      diagnosticSet = true; 
    };
    mockOutputChannel.error = () => {
      errorCalled = true; 
    };

    errorHandler.handleError(generalErrorMessage);

    assert.ok(diagnosticSet, 'Should create diagnostic for general error');
    assert.ok(errorCalled, 'Should log error to output channel');
  });

  test('should target the configured shader when no GLSL editor is focused', () => {
    const shaderUri = vscode.Uri.file('/test/config-shader.glsl');
    const otherEditor = {
      document: {
        languageId: 'plaintext',
        lineCount: 5,
        uri: vscode.Uri.file('/test/readme.txt'),
        lineAt: (lineNumber: number) => ({
          range: new vscode.Range(lineNumber, 0, lineNumber, 0)
        })
      }
    } as any;

    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: otherEditor,
      writable: true
    });

    let diagnosticUri: vscode.Uri | undefined;
    mockDiagnosticCollection.set = ((uriOrEntries: vscode.Uri | readonly [vscode.Uri, readonly vscode.Diagnostic[] | undefined][], _diagnostics?: readonly vscode.Diagnostic[] | undefined) => {
      if (uriOrEntries instanceof vscode.Uri) {
        diagnosticUri = uriOrEntries;
        return;
      }
      diagnosticUri = uriOrEntries[0]?.[0];
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.setShaderConfig({
      config: { passes: {} },
      shaderPath: shaderUri.fsPath,
    });

    errorHandler.handlePersistentError({
      type: 'error',
      payload: ['Texture file not found: /path/to/missing.jpg']
    });

    assert.ok(diagnosticUri, 'Should set a diagnostic URI');
    assert.strictEqual(diagnosticUri?.fsPath, shaderUri.fsPath);
  });

  test('should target the last changed GLSL document when focus is elsewhere', () => {
    const shaderUri = vscode.Uri.file('/test/overlay-shader.glsl');
    const otherEditor = {
      document: {
        languageId: 'plaintext',
        lineCount: 5,
        uri: vscode.Uri.file('/test/readme.txt'),
        lineAt: (lineNumber: number) => ({
          range: new vscode.Range(lineNumber, 0, lineNumber, 0)
        })
      }
    } as any;

    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: otherEditor,
      writable: true
    });

    let diagnosticUri: vscode.Uri | undefined;
    mockDiagnosticCollection.set = ((uriOrEntries: vscode.Uri | readonly [vscode.Uri, readonly vscode.Diagnostic[] | undefined][], _diagnostics?: readonly vscode.Diagnostic[] | undefined) => {
      if (uriOrEntries instanceof vscode.Uri) {
        diagnosticUri = uriOrEntries;
        return;
      }
      diagnosticUri = uriOrEntries[0]?.[0];
    }) as typeof mockDiagnosticCollection.set;

    textDocumentChangeListener?.({
      document: {
        languageId: 'glsl',
        fileName: shaderUri.fsPath,
        uri: shaderUri,
      },
    } as vscode.TextDocumentChangeEvent);

    errorHandler.handlePersistentError({
      type: 'error',
      payload: ['General shader compilation failed']
    });

    assert.ok(diagnosticUri, 'Should set a diagnostic URI');
    assert.strictEqual(diagnosticUri?.fsPath, shaderUri.fsPath);
  });
});
