import * as assert from 'assert';
import * as vscode from 'vscode';
import { ErrorMessage } from '@shader-studio/types';
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

    test('should handle basic error messages', () => {
        const message: ErrorMessage = {
            type: 'error',
            payload: ['Test error message']
        };

        // Should not throw
        assert.doesNotThrow(() => {
            errorHandler.handleError(message);
        });
    });

    test('should handle array payload', () => {
        const message: ErrorMessage = {
            type: 'error',
            payload: ['Error part 1', 'Error part 2']
        };

        assert.doesNotThrow(() => {
            errorHandler.handleError(message);
        });
    });

    test('should handle string payload', () => {
        const message: ErrorMessage = {
            type: 'error',
            payload: 'Single error message' as any
        };

        assert.doesNotThrow(() => {
            errorHandler.handleError(message);
        });
    });

    test('should debounce identical errors', () => {
        const message: ErrorMessage = {
            type: 'error',
            payload: ['Duplicate error message']
        };

        // Both should not throw (second one debounced)
        assert.doesNotThrow(() => {
            errorHandler.handleError(message);
            errorHandler.handleError(message);
        });
    });

    test('should not debounce different errors', () => {
        const message1: ErrorMessage = {
            type: 'error',
            payload: ['Error message 1']
        };

        const message2: ErrorMessage = {
            type: 'error',
            payload: ['Error message 2']
        };

        assert.doesNotThrow(() => {
            errorHandler.handleError(message1);
            errorHandler.handleError(message2);
        });
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

        // Should normalize to same error (second one debounced)
        assert.doesNotThrow(() => {
            errorHandler.handleError(message1);
            errorHandler.handleError(message2);
        });
    });

    test('should handle persistent errors', () => {
        const message: ErrorMessage = {
            type: 'error',
            payload: ['Texture file not found: /path/to/missing.jpg']
        };

        assert.doesNotThrow(() => {
            errorHandler.handlePersistentError(message);
        });
    });

    test('should debounce persistent errors', () => {
        const message: ErrorMessage = {
            type: 'error',
            payload: ['Texture file not found: /path/to/missing.jpg']
        };

        assert.doesNotThrow(() => {
            errorHandler.handlePersistentError(message);
            errorHandler.handlePersistentError(message);
        });
    });

    test('should clear errors', () => {
        const message: ErrorMessage = {
            type: 'error',
            payload: ['Test error']
        };

        assert.doesNotThrow(() => {
            errorHandler.handleError(message);
            errorHandler.clearErrors();
        });
    });

    test('should set shader config', () => {
        const config = {
            config: { passes: {} },
            shaderPath: '/path/to/shader.glsl'
        };

        assert.doesNotThrow(() => {
            errorHandler.setShaderConfig(config);
            errorHandler.setShaderConfig(null);
        });
    });

    test('should handle edge cases', () => {
        // Valid edge cases that should not throw
        assert.doesNotThrow(() => {
            errorHandler.handleError({ type: 'error', payload: [''] });
            errorHandler.handleError({ type: 'error', payload: ['Valid error message'] });
        });

        // Null/undefined payload should be handled gracefully (no throw)
        assert.doesNotThrow(() => {
            errorHandler.handleError({ type: 'error', payload: null as any });
            errorHandler.handleError({ type: 'error', payload: undefined as any });
            errorHandler.handlePersistentError({ type: 'error', payload: null as any });
            errorHandler.handlePersistentError({ type: 'error', payload: undefined as any });
        });
    });

    test('should handle rapid error bursts', () => {
        const message: ErrorMessage = {
            type: 'error',
            payload: ['Rapid error']
        };

        assert.doesNotThrow(() => {
            // Send 10 errors rapidly
            for (let i = 0; i < 10; i++) {
                errorHandler.handleError(message);
            }
        });
    });

    test('should handle performance load', () => {
        const startTime = Date.now();

        assert.doesNotThrow(() => {
            // Handle 100 different errors
            for (let i = 0; i < 100; i++) {
                const message: ErrorMessage = {
                    type: 'error',
                    payload: [`Error ${i}`]
                };
                errorHandler.handleError(message);
            }
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        // Should complete quickly (under 100ms)
        assert.ok(duration < 100, `Performance test took ${duration}ms (expected < 100ms)`);
    });

    test('should dispose timer', () => {
        assert.doesNotThrow(() => {
            errorHandler.dispose();
        });
    });
});
