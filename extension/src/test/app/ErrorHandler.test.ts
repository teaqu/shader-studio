import * as assert from 'assert';
import * as vscode from 'vscode';
import { ErrorMessage, WarningMessage } from '@shader-studio/types';
import { ErrorHandler } from '../../app/ErrorHandler';

suite('ErrorHandler Test Suite', () => {
  let mockOutputChannel: vscode.LogOutputChannel;
  let mockDiagnosticCollection: vscode.DiagnosticCollection;
  let errorHandler: ErrorHandler;
  let textDocumentChangeListener: ((event: vscode.TextDocumentChangeEvent) => void) | undefined;

  const compileScope = (rootUri: string, generationId: number, ownerId = 'panel:a') => ({
    rootUris: [rootUri],
    generationId,
    ownerId,
  });

  const compileError = (rootUri: string, generationId: number, diagnosticUri: string, ownerId = 'panel:a'): ErrorMessage => ({
    type: 'error',
    payload: ['formatted legacy compiler error'],
    compileScope: compileScope(rootUri, generationId, ownerId),
    diagnostics: [{
      severity: 'error',
      message: `compiler error in ${diagnosticUri}`,
      source: 'slang-compile',
      uri: diagnosticUri,
      range: {
        start: { line: 2, character: 3 },
        end: { line: 2, character: 3 },
      },
    }],
  });

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
    const diagnosticsByUri = new Map<string, readonly vscode.Diagnostic[]>();
    mockDiagnosticCollection = {
      name: 'Test Diagnostics',
      set: ((uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]) => {
        diagnosticsByUri.set(uri.toString(), diagnostics);
      }) as typeof mockDiagnosticCollection.set,
      clear: () => {
        diagnosticsByUri.clear();
      },
      delete: (uri: vscode.Uri) => {
        diagnosticsByUri.delete(uri.toString());
      },
      has: () => false,
      get: (uri: vscode.Uri) => diagnosticsByUri.get(uri.toString()),
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

  test('maps structured compiler diagnostics to the dependency URI', () => {
    const dependencyUri = 'file:///project/lib/palette.slang';
    errorHandler.handleError(compileError('file:///project/image.slang', 1, dependencyUri));

    const diagnostics = mockDiagnosticCollection.get(vscode.Uri.parse(dependencyUri));
    assert.strictEqual(diagnostics?.length, 1);
    assert.strictEqual(diagnostics?.[0].message, `compiler error in ${dependencyUri}`);
    assert.strictEqual(diagnostics?.[0].range.start.line, 2);
  });

  test('recompiling one root does not clear another root dependency error', () => {
    const aRoot = 'file:///project/a.slang';
    const bRoot = 'file:///project/b.slang';
    const aDependency = 'file:///project/lib/a.slang';
    const bDependency = 'file:///project/lib/b.slang';
    errorHandler.handleError(compileError(aRoot, 1, aDependency));
    errorHandler.handleError(compileError(bRoot, 1, bDependency));

    errorHandler.handleCompileSuccess(compileScope(aRoot, 2));

    assert.deepStrictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(aDependency)), []);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(bDependency))?.length, 1);
  });

  test('keeps same-root diagnostics isolated by owner', () => {
    const root = 'file:///project/image.slang';
    const firstDependency = 'file:///project/lib/first.slang';
    const secondDependency = 'file:///project/lib/second.slang';
    errorHandler.handleError(compileError(root, 1, firstDependency, 'panel:first'));
    errorHandler.handleError(compileError(root, 1, secondDependency, 'panel:second'));

    errorHandler.handleCompileSuccess(compileScope(root, 2, 'panel:first'));

    assert.deepStrictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(firstDependency)), []);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(secondDependency))?.length, 1);
  });

  test('clears one released owner diagnostics and watermarks without disturbing another owner', () => {
    const root = 'file:///project/image.slang';
    const releasedDependency = 'file:///project/lib/released.slang';
    const retainedDependency = 'file:///project/lib/retained.slang';
    const replacementDependency = 'file:///project/lib/replacement.slang';
    errorHandler.handleError(compileError(root, 4, releasedDependency, 'panel:released'));
    errorHandler.handleError(compileError(root, 4, retainedDependency, 'panel:retained'));

    errorHandler.clearCompileOwner('panel:released');
    errorHandler.handleError(compileError(root, 1, replacementDependency, 'panel:released'));

    assert.deepStrictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(releasedDependency)), []);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(retainedDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(replacementDependency))?.length, 1);
  });

  test('rejects a stale generation without replacing the current diagnostics', () => {
    const root = 'file:///project/image.slang';
    const newerDependency = 'file:///project/lib/newer.slang';
    const staleDependency = 'file:///project/lib/stale.slang';
    errorHandler.handleError(compileError(root, 2, newerDependency));
    errorHandler.handleError(compileError(root, 1, staleDependency));

    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(newerDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(staleDependency)), undefined);
  });

  test('falls back for an ambiguous multi-root error without replacing either root scope', () => {
    const aRoot = 'file:///project/a.slang';
    const bRoot = 'file:///project/b.slang';
    const aDependency = 'file:///project/lib/a.slang';
    const bDependency = 'file:///project/lib/b.slang';
    const ambiguousDependency = 'file:///project/lib/ambiguous.slang';
    errorHandler.handleError(compileError(aRoot, 2, aDependency));
    errorHandler.handleError(compileError(bRoot, 2, bDependency));

    errorHandler.handleError({
      ...compileError(aRoot, 3, ambiguousDependency),
      payload: ['formatted ambiguous compiler error'],
      compileScope: { rootUris: [aRoot, bRoot], ownerId: 'panel:a', generationId: 3 },
    });

    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(aDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(bDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(ambiguousDependency)), undefined);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.file('/test/shader.glsl'))?.[0].message, 'formatted ambiguous compiler error');
  });

  test('falls back for an ambiguous multi-root success without partially clearing scoped roots', () => {
    const aRoot = 'file:///project/a.slang';
    const bRoot = 'file:///project/b.slang';
    const aDependency = 'file:///project/lib/a.slang';
    const bDependency = 'file:///project/lib/b.slang';
    errorHandler.handleError(compileError(aRoot, 2, aDependency));
    errorHandler.handleError(compileError(bRoot, 2, bDependency));

    errorHandler.handleCompileSuccess({
      rootUris: [aRoot, bRoot],
      ownerId: 'panel:a',
      generationId: 3,
    });

    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(aDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(bDependency))?.length, 1);
    errorHandler.handleError(compileError(aRoot, 1, 'file:///project/lib/stale.slang'));
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(aDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse('file:///project/lib/stale.slang')), undefined);
  });

  test('keeps persistent diagnostics when a scoped compile succeeds', () => {
    const root = 'file:///project/image.slang';
    const dependency = 'file:///project/lib/palette.slang';
    errorHandler.handlePersistentError({ type: 'warning', payload: ['persistent resource warning'] });
    errorHandler.handleError(compileError(root, 1, dependency));

    errorHandler.handleCompileSuccess(compileScope(root, 2));

    assert.deepStrictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(dependency)), []);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.file('/test/shader.glsl'))?.length, 1);
  });

  test('provider pre-send persistent clearing preserves scoped diagnostics and generation watermarks', () => {
    const root = 'file:///project/image.slang';
    const dependency = 'file:///project/lib/palette.slang';
    const staleDependency = 'file:///project/lib/stale.slang';
    errorHandler.handleError(compileError(root, 2, dependency));

    errorHandler.clearPersistentErrors();
    errorHandler.handleError(compileError(root, 1, staleDependency));

    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(dependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(staleDependency)), undefined);
  });

  test('an unrelated GLSL edit preserves all scoped diagnostics and generation watermarks', () => {
    const aRoot = 'file:///project/a.slang';
    const bRoot = 'file:///project/b.slang';
    const aDependency = 'file:///project/lib/a.slang';
    const bDependency = 'file:///project/lib/b.slang';
    errorHandler.handleError(compileError(aRoot, 2, aDependency));
    errorHandler.handleError(compileError(bRoot, 2, bDependency));

    textDocumentChangeListener?.({
      document: {
        languageId: 'glsl',
        fileName: '/unrelated/other.glsl',
        uri: vscode.Uri.file('/unrelated/other.glsl'),
      },
    } as vscode.TextDocumentChangeEvent);
    errorHandler.handleError(compileError(aRoot, 1, 'file:///project/lib/stale.slang'));

    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(aDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(bDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse('file:///project/lib/stale.slang')), undefined);
  });

  test('a global GLSL success clears legacy errors but republishes every scoped Slang diagnostic', () => {
    const aDependency = 'file:///project/lib/a.slang';
    const bDependency = 'file:///project/lib/b.slang';
    errorHandler.handleError(compileError('file:///project/a.slang', 1, aDependency));
    errorHandler.handleError(compileError('file:///project/b.slang', 1, bDependency));
    errorHandler.handleError({ type: 'error', payload: ['legacy GLSL error'] });

    errorHandler.clearErrors();

    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(aDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(bDependency))?.length, 1);
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.file('/test/shader.glsl')), undefined);
  });

  test('falls back to the legacy payload when a structured compile scope is malformed', () => {
    errorHandler.handleError({
      type: 'error',
      payload: ['legacy fallback error'],
      compileScope: { rootUris: [], generationId: 1 },
      diagnostics: [{
        severity: 'error',
        message: 'must not use malformed structured diagnostic',
        source: 'slang-compile',
        uri: 'file:///project/lib/palette.slang',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      }],
    });

    const diagnostics = mockDiagnosticCollection.get(vscode.Uri.file('/test/shader.glsl'));
    assert.strictEqual(diagnostics?.[0].message, 'legacy fallback error');
    assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse('file:///project/lib/palette.slang')), undefined);
  });

  for (const { name, mutate } of [
    {
      name: 'URI',
      mutate: (diagnostic: Record<string, unknown>) => {
        diagnostic.uri = 'not-a-uri';
      },
    },
    {
      name: 'range',
      mutate: (diagnostic: Record<string, unknown>) => {
        diagnostic.range = { start: { line: Number.NaN, character: 0 }, end: { line: 0, character: 0 } };
      },
    },
    {
      name: 'severity',
      mutate: (diagnostic: Record<string, unknown>) => {
        diagnostic.severity = 'fatal';
      },
    },
    {
      name: 'message',
      mutate: (diagnostic: Record<string, unknown>) => {
        diagnostic.message = 42;
      },
    },
    {
      name: 'source',
      mutate: (diagnostic: Record<string, unknown>) => {
        diagnostic.source = 'language-service';
      },
    },
  ]) {
    test(`falls back for a malformed structured diagnostic ${name} without replacing prior scoped errors`, () => {
      const root = 'file:///project/image.slang';
      const previousDependency = 'file:///project/lib/previous.slang';
      const malformed = structuredClone(compileError(root, 2, 'file:///project/lib/malformed.slang')) as unknown as {
        diagnostics: Record<string, unknown>[];
      };
      mutate(malformed.diagnostics[0]);
      errorHandler.handleError(compileError(root, 1, previousDependency));

      errorHandler.handleError({
        ...(malformed as unknown as ErrorMessage),
        payload: [`legacy ${name} fallback`],
        compileScope: compileScope(root, 2),
      });

      assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.parse(previousDependency))?.length, 1);
      assert.strictEqual(mockDiagnosticCollection.get(vscode.Uri.file('/test/shader.glsl'))?.[0].message, `legacy ${name} fallback`);
    });
  }
});
