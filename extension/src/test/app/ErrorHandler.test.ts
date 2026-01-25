import * as assert from 'assert';
import * as vscode from 'vscode';
import { ErrorMessage, WarningMessage } from '@shader-studio/types';
import { ErrorHandler } from '../../app/ErrorHandler';

suite('ErrorHandler Test Suite', () => {
    let mockOutputChannel: vscode.LogOutputChannel;
    let mockDiagnosticCollection: vscode.DiagnosticCollection;
    let errorHandler: ErrorHandler;

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
        mockOutputChannel.error = () => { errorCallCount++; };

        // Call the same error twice
        errorHandler.handleError(message);
        errorHandler.handleError(message);

        // Should only call error once (second one debounced)
        assert.equal(errorCallCount, 1, 'Second identical error should be debounced');
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
        mockOutputChannel.error = () => { errorCallCount++; };

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
        
        mockOutputChannel.warn = () => { warnCalled = true; };
        mockOutputChannel.error = () => { errorCalled = true; };

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
        
        mockOutputChannel.warn = () => { warnCalled = true; };
        mockOutputChannel.error = () => { errorCalled = true; };

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
        mockOutputChannel.error = () => { errorCallCount++; };

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
        mockOutputChannel.warn = () => { warnCalled = true; };

        errorHandler.handlePersistentError(warningMessage);
        
        assert.ok(warnCalled, 'WarningMessage should call outputChannel.warn');
    });

    test('should clear specific persistent errors', () => {
        const message1: ErrorMessage = {
            type: 'error',
            payload: ['Texture file not found: /path/to/file1.jpg']
        };

        const message2: ErrorMessage = {
            type: 'error',
            payload: ['Texture file not found: /path/to/file2.jpg']
        };

        let errorCallCount = 0;
        mockOutputChannel.error = () => { errorCallCount++; };

        // Add both persistent errors
        errorHandler.handlePersistentError(message1);
        errorHandler.handlePersistentError(message2);
        assert.equal(errorCallCount, 2, 'Both errors should be logged initially');
        
        // Clear specific error by normalized name
        errorHandler.clearPersistentError('FILE_NOT_FOUND:/path/to/file1.jpg');
        
        // First error should work again (cleared from debounce), second should still be debounced
        errorHandler.handlePersistentError(message1);
        assert.equal(errorCallCount, 3, 'Cleared error should be logged again');
        
        errorHandler.handlePersistentError(message2);
        assert.equal(errorCallCount, 3, 'Non-cleared error should still be debounced');
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
        mockDiagnosticCollection.set = () => { diagnosticSet = true; };
        mockOutputChannel.error = () => { errorCalled = true; };

        errorHandler.handleError(generalErrorMessage);

        assert.ok(diagnosticSet, 'Should create diagnostic for general error');
        assert.ok(errorCalled, 'Should log error to output channel');
    });
});
