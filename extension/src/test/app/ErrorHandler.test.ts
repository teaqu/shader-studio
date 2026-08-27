import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ErrorMessage, WarningMessage } from '@shader-studio/types';
import { ErrorHandler } from '../../app/ErrorHandler';

function stubDocument(uri: vscode.Uri, lines: string[], languageId = 'slang'): vscode.TextDocument {
  return {
    languageId,
    fileName: uri.fsPath,
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({
      text: lines[line],
      range: new vscode.Range(line, 0, line, lines[line].length),
    }),
  } as any;
}

suite('ErrorHandler Test Suite', () => {
  let mockOutputChannel: vscode.LogOutputChannel;
  let mockDiagnosticCollection: vscode.DiagnosticCollection;
  let errorHandler: ErrorHandler;
  let textDocumentChangeListener: ((event: vscode.TextDocumentChangeEvent) => void) | undefined;
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();

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
      trace: (message: string) => { },
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
    sandbox.restore();
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

  test('places Slang compiler diagnostics on their reported source line', () => {
    let diagnostics: readonly vscode.Diagnostic[] | undefined;
    mockDiagnosticCollection.set = ((_uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      diagnostics = values;
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.handleError({
      type: 'error',
      payload: [[
        "Image: error[E20002]: syntax error",
        "  --> /image.slang:14:49",
        "   |",
        "14 | float gridY = step(0.92, frac(uv.y * 10.0));>",
        "   |                                             ^ syntax error.",
      ].join("\n")],
    });

    assert.strictEqual(diagnostics?.length, 1);
    assert.strictEqual(diagnostics?.[0].range.start.line, 13);
  });

  test('underlines a Slang diagnostic from its reported column instead of the whole line', () => {
    const shaderUri = vscode.Uri.file('/test/image.slang');
    const sourceLine = 'float gridY = step(0.92, frac(uv.y * 10.0));';
    const lines = Array.from({ length: 20 }, (_, index) => (index === 13 ? sourceLine : ''));
    sandbox.stub(vscode.workspace, 'textDocuments').value([stubDocument(shaderUri, lines)]);

    let diagnostics: readonly vscode.Diagnostic[] | undefined;
    mockDiagnosticCollection.set = ((_uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      diagnostics = values;
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.handleError({
      type: 'error',
      payload: [[
        'Image: error[E30015]: undefined identifier \'step\'',
        `  --> ${shaderUri.fsPath}:14:15`,
        '   |',
        `14 | ${sourceLine}`,
        '   |               ^ undefined identifier',
      ].join('\n')],
    });

    const range = diagnostics?.[0].range;
    assert.strictEqual(range?.start.line, 13);
    assert.strictEqual(range?.start.character, 14, 'Should start at the reported column');
    assert.strictEqual(range?.end.line, 13);
    assert.strictEqual(range?.end.character, sourceLine.length);
  });

  test('clamps a Slang column past the end of the line to the last character', () => {
    const shaderUri = vscode.Uri.file('/test/image.slang');
    const sourceLine = 'float gridY = 1.0;';
    const lines = Array.from({ length: 20 }, (_, index) => (index === 13 ? sourceLine : ''));
    sandbox.stub(vscode.workspace, 'textDocuments').value([stubDocument(shaderUri, lines)]);

    let diagnostics: readonly vscode.Diagnostic[] | undefined;
    mockDiagnosticCollection.set = ((_uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      diagnostics = values;
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.handleError({
      type: 'error',
      payload: [[
        'Image: error[E20002]: syntax error',
        `  --> ${shaderUri.fsPath}:14:200`,
        '   |',
        `14 | ${sourceLine}`,
      ].join('\n')],
    });

    const range = diagnostics?.[0].range;
    assert.strictEqual(range?.start.character, sourceLine.length - 1);
    assert.strictEqual(range?.end.character, sourceLine.length);
  });

  test('starts at the reported column even when the Slang source is not open', () => {
    sandbox.stub(vscode.workspace, 'textDocuments').value([]);

    let diagnostics: readonly vscode.Diagnostic[] | undefined;
    mockDiagnosticCollection.set = ((_uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      diagnostics = values;
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.handleError({
      type: 'error',
      payload: [[
        'Image: error[E20002]: syntax error',
        '  --> /image.slang:14:49',
        '   |',
        '14 | float gridY = step(0.92, frac(uv.y * 10.0));>',
        '   |                                             ^ syntax error.',
      ].join('\n')],
    });

    const range = diagnostics?.[0].range;
    assert.strictEqual(range?.start.line, 13);
    assert.strictEqual(range?.start.character, 48);
    assert.strictEqual(range?.end.character, 49);
  });

  test('emits one diagnostic per Slang error block in a single payload string', () => {
    const shaderUri = vscode.Uri.file('/test/image.slang');
    const firstLine = 'float gridY = stepp(0.92, uv.y);';
    const secondLine = '    return;';
    const lines = Array.from({ length: 25 }, (_, index) => {
      if (index === 13) {
        return firstLine;
      }
      return index === 19 ? secondLine : '';
    });
    sandbox.stub(vscode.workspace, 'textDocuments').value([stubDocument(shaderUri, lines)]);

    let diagnostics: readonly vscode.Diagnostic[] | undefined;
    mockDiagnosticCollection.set = ((_uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      diagnostics = values;
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.handleError({
      type: 'error',
      payload: [[
        "Image: error[E30015]: undefined identifier 'stepp'",
        `  --> ${shaderUri.fsPath}:14:15`,
        '   |',
        `14 | ${firstLine}`,
        '   |               ^ undefined identifier',
        'error[E20002]: syntax error',
        `  --> ${shaderUri.fsPath}:20:5`,
        '   |',
        `20 | ${secondLine}`,
        '   |     ^ syntax error',
      ].join('\n')],
    });

    assert.strictEqual(diagnostics?.length, 2, 'Each Slang error block should get its own diagnostic');

    assert.strictEqual(diagnostics?.[0].range.start.line, 13);
    assert.strictEqual(diagnostics?.[0].range.start.character, 14);
    assert.strictEqual(diagnostics?.[0].range.end.character, firstLine.length);
    assert.ok(diagnostics?.[0].message.includes('E30015'));
    assert.ok(!diagnostics?.[0].message.includes('E20002'), 'Blocks should not leak into each other');

    assert.strictEqual(diagnostics?.[1].range.start.line, 19);
    assert.strictEqual(diagnostics?.[1].range.start.character, 4);
    assert.strictEqual(diagnostics?.[1].range.end.character, secondLine.length);
    assert.ok(diagnostics?.[1].message.includes('E20002'));
    assert.ok(!diagnostics?.[1].message.includes('E30015'), 'Blocks should not leak into each other');
  });

  test('routes each Slang error block to the file it names', () => {
    const imageUri = vscode.Uri.file('/test/image.slang');
    const commonUri = vscode.Uri.file('/test/common.slang');
    const imageLine = 'float gridY = stepp(0.92, uv.y);';
    const commonLine = 'float helper() { return; }';
    sandbox.stub(vscode.workspace, 'textDocuments').value([
      stubDocument(imageUri, Array.from({ length: 20 }, (_, i) => (i === 13 ? imageLine : ''))),
      stubDocument(commonUri, Array.from({ length: 20 }, (_, i) => (i === 4 ? commonLine : ''))),
    ]);

    const setCalls: { uri: vscode.Uri; diagnostics: readonly vscode.Diagnostic[] | undefined }[] = [];
    mockDiagnosticCollection.set = ((uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      setCalls.push({ uri, diagnostics: values });
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.handleError({
      type: 'error',
      payload: [[
        "Image: error[E30015]: undefined identifier 'stepp'",
        `  --> ${imageUri.fsPath}:14:15`,
        '   |',
        `14 | ${imageLine}`,
        'error[E20002]: syntax error',
        `  --> ${commonUri.fsPath}:5:18`,
        '  |',
        `5 | ${commonLine}`,
      ].join('\n')],
    });

    assert.strictEqual(setCalls.length, 2, 'Blocks in different files need separate diagnostic sets');

    const imageCall = setCalls.find((call) => call.uri.fsPath === imageUri.fsPath);
    assert.strictEqual(imageCall?.diagnostics?.length, 1);
    assert.strictEqual(imageCall?.diagnostics?.[0].range.start.line, 13);
    assert.strictEqual(imageCall?.diagnostics?.[0].range.start.character, 14);

    const commonCall = setCalls.find((call) => call.uri.fsPath === commonUri.fsPath);
    assert.strictEqual(commonCall?.diagnostics?.length, 1);
    assert.strictEqual(commonCall?.diagnostics?.[0].range.start.line, 4);
    assert.strictEqual(commonCall?.diagnostics?.[0].range.start.character, 17);
    assert.ok(commonCall?.diagnostics?.[0].message.includes('E20002'));
  });

  test('keeps a located Slang block precise while a block without a location falls back', () => {
    const shaderUri = vscode.Uri.file('/test/image.slang');
    const sourceLine = 'float gridY = stepp(0.92, uv.y);';
    const lines = Array.from({ length: 20 }, (_, index) => (index === 13 ? sourceLine : ''));
    sandbox.stub(vscode.workspace, 'textDocuments').value([stubDocument(shaderUri, lines)]);

    let diagnostics: readonly vscode.Diagnostic[] | undefined;
    mockDiagnosticCollection.set = ((_uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      diagnostics = values;
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.setShaderConfig({ config: { passes: {} }, shaderPath: shaderUri.fsPath });
    errorHandler.handleError({
      type: 'error',
      payload: [[
        "Image: error[E30015]: undefined identifier 'stepp'",
        `  --> ${shaderUri.fsPath}:14:15`,
        '   |',
        `14 | ${sourceLine}`,
        'error[E99999]: entry point not found',
      ].join('\n')],
    });

    assert.strictEqual(diagnostics?.length, 2, 'A block without a location must still be reported');
    assert.strictEqual(diagnostics?.[0].range.start.line, 13);
    assert.strictEqual(diagnostics?.[0].range.start.character, 14);
    assert.strictEqual(diagnostics?.[1].range.start.line, 0, 'Unlocated blocks fall back to line 1');
    assert.ok(diagnostics?.[1].message.includes('E99999'));
  });

  test('keeps GLSL compiler diagnostics spanning the whole reported line', () => {
    const shaderUri = vscode.Uri.file('/test/shader.glsl');
    const sourceLine = '  vec3 col = undefinedFn(uv);';
    const lines = Array.from({ length: 20 }, (_, index) => (index === 13 ? sourceLine : ''));
    sandbox.stub(vscode.workspace, 'textDocuments').value([stubDocument(shaderUri, lines, 'glsl')]);

    let diagnostics: readonly vscode.Diagnostic[] | undefined;
    mockDiagnosticCollection.set = ((_uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      diagnostics = values;
    }) as typeof mockDiagnosticCollection.set;

    errorHandler.setShaderConfig({ config: { passes: {} }, shaderPath: shaderUri.fsPath });
    errorHandler.handleError({
      type: 'error',
      payload: ["Image: ERROR: 0:14: 'undefinedFn' : no matching overloaded function found"],
    });

    const range = diagnostics?.[0].range;
    assert.strictEqual(range?.start.line, 13);
    assert.strictEqual(range?.start.character, 0, 'glslang reports no column, so keep the full line');
    assert.strictEqual(range?.end.character, sourceLine.length);
  });

  test('places a compute Slang diagnostic on its source file instead of the locked fragment editor', () => {
    const fragmentUri = vscode.Uri.file('/test/image.slang');
    const computeUri = vscode.Uri.file('/test/passes/life-step.slang');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: {
        document: {
          languageId: 'slang',
          fileName: fragmentUri.fsPath,
          lineCount: 12,
          uri: fragmentUri,
          lineAt: (lineNumber: number) => ({ range: new vscode.Range(lineNumber, 0, lineNumber, 0) }),
        },
      },
      writable: true,
    });

    let diagnosticUri: vscode.Uri | undefined;
    let diagnostics: readonly vscode.Diagnostic[] | undefined;
    mockDiagnosticCollection.set = ((uri: vscode.Uri, values?: readonly vscode.Diagnostic[]) => {
      diagnosticUri = uri;
      diagnostics = values;
    }) as typeof mockDiagnosticCollection.set;
    errorHandler.setShaderConfig({
      config: { passes: { ComputeLife: { type: 'compute', path: 'passes/life-step.slang' } } },
      shaderPath: fragmentUri.fsPath,
      bufferPathMap: { ComputeLife: computeUri.fsPath },
    });

    errorHandler.handleError({
      type: 'error',
      payload: [[
        'ComputeLife: error[E30015]: undefined identifier',
        ' --> /computelife.slang:3:5',
        '  |',
        '3 | writeOutput(cell, color);',
        '  | ^ undefined identifier',
      ].join('\n')],
    });

    assert.strictEqual(diagnosticUri?.fsPath, computeUri.fsPath);
    assert.strictEqual(diagnostics?.[0].range.start.line, 2);
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

  test('should target the last changed Slang document when focus is elsewhere', () => {
    const shaderUri = vscode.Uri.file('/test/overlay-shader.slang');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: { document: { languageId: 'plaintext', uri: vscode.Uri.file('/test/readme.txt') } },
      writable: true,
    });
    let diagnosticUri: vscode.Uri | undefined;
    mockDiagnosticCollection.set = ((uriOrEntries: vscode.Uri | readonly [vscode.Uri, readonly vscode.Diagnostic[] | undefined][]) => {
      diagnosticUri = uriOrEntries instanceof vscode.Uri ? uriOrEntries : uriOrEntries[0]?.[0];
    }) as typeof mockDiagnosticCollection.set;

    textDocumentChangeListener?.({
      document: { languageId: 'slang', fileName: shaderUri.fsPath, uri: shaderUri },
    } as vscode.TextDocumentChangeEvent);
    errorHandler.handlePersistentError({ type: 'error', payload: ['Slang compilation failed'] });

    assert.strictEqual(diagnosticUri?.fsPath, shaderUri.fsPath);
  });
});
