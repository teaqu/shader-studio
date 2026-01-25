import * as assert from 'assert';
import * as vscode from 'vscode';
import { Logger } from '../../app/services/Logger';

suite('Logger Test Suite', () => {
    let mockOutputChannel: vscode.LogOutputChannel;
    let loggedMessages: { level: string; message: string }[];

    setup(() => {
        loggedMessages = [];

        mockOutputChannel = {
            name: 'Test Logger',
            append: () => { },
            appendLine: () => { },
            replace: () => { },
            clear: () => { },
            show: () => { },
            hide: () => { },
            dispose: () => { },
            logLevel: vscode.LogLevel.Debug,
            onDidChangeLogLevel: new vscode.EventEmitter<vscode.LogLevel>().event,

            // Mock the logging methods to track calls
            trace: (message: string) => {
                loggedMessages.push({ level: 'trace', message });
            },
            debug: (message: string) => {
                loggedMessages.push({ level: 'debug', message });
            },
            info: (message: string) => {
                loggedMessages.push({ level: 'info', message });
            },
            warn: (message: string) => {
                loggedMessages.push({ level: 'warn', message });
            },
            error: (message: string) => {
                loggedMessages.push({ level: 'error', message });
            },
        } as any;

        // Initialize logger with mock
        Logger.initialize(mockOutputChannel);
    });

    teardown(() => {
        // Clean up logger instance
        const logger = Logger.getInstance();
        logger.dispose();
    });

    test('should initialize logger correctly', () => {
        const logger = Logger.getInstance();
        assert.ok(logger instanceof Logger);
    });

    test('should throw error if not initialized', () => {
        // Reset the instance to test uninitialized state
        const originalInstance = (Logger as any).instance;
        (Logger as any).instance = null;
        
        try {
            assert.throws(() => {
                Logger.getInstance();
            }, /Logger not initialized/);
        } finally {
            // Restore the instance for cleanup
            (Logger as any).instance = originalInstance;
        }
    });

    test('should log info messages without debouncing', () => {
        const logger = Logger.getInstance();
        
        logger.info('Info message 1');
        logger.info('Info message 2');
        logger.info('Info message 1'); // Same message again
        
        assert.strictEqual(loggedMessages.length, 3);
        assert.strictEqual(loggedMessages[0].level, 'info');
        assert.strictEqual(loggedMessages[0].message, 'Info message 1');
        assert.strictEqual(loggedMessages[1].level, 'info');
        assert.strictEqual(loggedMessages[1].message, 'Info message 2');
        assert.strictEqual(loggedMessages[2].level, 'info');
        assert.strictEqual(loggedMessages[2].message, 'Info message 1');
    });

    test('should log debug messages without debouncing', () => {
        const logger = Logger.getInstance();
        
        logger.debug('Debug message 1');
        logger.debug('Debug message 2');
        logger.debug('Debug message 1'); // Same message again
        
        assert.strictEqual(loggedMessages.length, 3);
        assert.strictEqual(loggedMessages[0].level, 'debug');
        assert.strictEqual(loggedMessages[0].message, 'Debug message 1');
        assert.strictEqual(loggedMessages[1].level, 'debug');
        assert.strictEqual(loggedMessages[1].message, 'Debug message 2');
        assert.strictEqual(loggedMessages[2].level, 'debug');
        assert.strictEqual(loggedMessages[2].message, 'Debug message 1');
    });

    test('should debounce warning messages', () => {
        const logger = Logger.getInstance();
        
        logger.warn('Warning message');
        logger.warn('Warning message'); // Should be debounced
        logger.warn('Different warning'); // Should not be debounced
        
        assert.strictEqual(loggedMessages.length, 2);
        assert.strictEqual(loggedMessages[0].level, 'warn');
        assert.strictEqual(loggedMessages[0].message, 'Warning message');
        assert.strictEqual(loggedMessages[1].level, 'warn');
        assert.strictEqual(loggedMessages[1].message, 'Different warning');
    });

    test('should debounce error messages', () => {
        const logger = Logger.getInstance();
        
        logger.error('Error message');
        logger.error('Error message'); // Should be debounced
        logger.error('Different error'); // Should not be debounced
        
        assert.strictEqual(loggedMessages.length, 2);
        assert.strictEqual(loggedMessages[0].level, 'error');
        assert.strictEqual(loggedMessages[0].message, 'Error message');
        assert.strictEqual(loggedMessages[1].level, 'error');
        assert.strictEqual(loggedMessages[1].message, 'Different error');
    });

    test('should handle Error objects in error method', () => {
        const logger = Logger.getInstance();
        const testError = new Error('Test error message');
        
        logger.error(testError);
        logger.error(testError); // Should be debounced
        
        assert.strictEqual(loggedMessages.length, 1);
        assert.strictEqual(loggedMessages[0].level, 'error');
        assert.strictEqual(loggedMessages[0].message, 'Test error message');
    });

    test('should handle string messages in error method', () => {
        const logger = Logger.getInstance();
        
        logger.error('String error message');
        
        assert.strictEqual(loggedMessages.length, 1);
        assert.strictEqual(loggedMessages[0].level, 'error');
        assert.strictEqual(loggedMessages[0].message, 'String error message');
    });

    test('should handle empty and null messages gracefully', () => {
        const logger = Logger.getInstance();
        
        assert.doesNotThrow(() => {
            logger.info('');
            logger.debug('');
            logger.warn('');
            logger.error('');
        });
        
        // Empty string in warn and error are debounced (same message '')
        // So we get: info, debug, warn = 3 total (error is debounced)
        assert.strictEqual(loggedMessages.length, 3);
        assert.strictEqual(loggedMessages[0].level, 'info');
        assert.strictEqual(loggedMessages[1].level, 'debug');
        assert.strictEqual(loggedMessages[2].level, 'warn');
    });

    test('should handle rapid warning bursts', () => {
        const logger = Logger.getInstance();
        
        // Send 10 identical warnings rapidly
        for (let i = 0; i < 10; i++) {
            logger.warn('Rapid warning');
        }
        
        // Should only log once due to debouncing
        assert.strictEqual(loggedMessages.length, 1);
        assert.strictEqual(loggedMessages[0].message, 'Rapid warning');
    });

    test('should handle rapid error bursts', () => {
        const logger = Logger.getInstance();
        
        // Send 10 identical errors rapidly
        for (let i = 0; i < 10; i++) {
            logger.error('Rapid error');
        }
        
        // Should only log once due to debouncing
        assert.strictEqual(loggedMessages.length, 1);
        assert.strictEqual(loggedMessages[0].message, 'Rapid error');
    });

    test('should handle mixed message types correctly', () => {
        const logger = Logger.getInstance();
        
        logger.info('Info message');
        logger.warn('Warning message');
        logger.debug('Debug message');
        logger.error('Error message');
        
        // Same messages but different levels - info/debug don't debounce, warn/error do
        logger.info('Info message');     // Should log (no debounce)
        logger.warn('Warning message');  // Should be debounced
        logger.debug('Debug message');   // Should log (no debounce)
        logger.error('Error message');   // Should be debounced
        
        // Total: 6 messages (2 debounced)
        assert.strictEqual(loggedMessages.length, 6);
        assert.strictEqual(loggedMessages.filter(m => m.level === 'info').length, 2);
        assert.strictEqual(loggedMessages.filter(m => m.level === 'warn').length, 1);
        assert.strictEqual(loggedMessages.filter(m => m.level === 'debug').length, 2);
        assert.strictEqual(loggedMessages.filter(m => m.level === 'error').length, 1);
    });

    test('should handle performance load efficiently', () => {
        const logger = Logger.getInstance();
        const startTime = Date.now();
        
        // Log 1000 different messages
        for (let i = 0; i < 1000; i++) {
            logger.info(`Info message ${i}`);
        }
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // Should complete quickly (under 100ms)
        assert.ok(duration < 100, `Performance test took ${duration}ms (expected < 100ms)`);
        assert.strictEqual(loggedMessages.length, 1000);
    });

    test('should handle performance load with debouncing efficiently', () => {
        const logger = Logger.getInstance();
        const startTime = Date.now();
        
        // Log 1000 identical warning messages (should be debounced)
        for (let i = 0; i < 1000; i++) {
            logger.warn('Repeated warning message');
        }
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // Should complete quickly (under 50ms due to debouncing)
        assert.ok(duration < 50, `Debounced performance test took ${duration}ms (expected < 50ms)`);
        assert.strictEqual(loggedMessages.length, 1);
    });

    test('should dispose correctly', () => {
        const logger = Logger.getInstance();
        
        assert.doesNotThrow(() => {
            logger.dispose();
        });
    });

    test('should handle concurrent logging safely', () => {
        const logger = Logger.getInstance();
        
        // Simulate concurrent logging
        const promises = [];
        for (let i = 0; i < 100; i++) {
            promises.push(Promise.resolve().then(() => {
                logger.warn(`Concurrent warning ${i}`);
            }));
        }
        
        return Promise.all(promises).then(() => {
            // All 100 different messages should be logged
            assert.strictEqual(loggedMessages.length, 100);
        });
    });

    test('should handle edge cases gracefully', () => {
        const logger = Logger.getInstance();
        
        assert.doesNotThrow(() => {
            // Test various edge cases
            logger.info('');
            logger.info(' ');
            logger.info('Message with special chars: !@#$%^&*()');
            logger.info('Message with new lines\nLine 2\nLine 3');
            logger.info('Message with unicode: 🚀 🎯 ✨');
            
            logger.warn('');
            logger.warn(' ');
            logger.warn('Warning with special chars: !@#$%^&*()');
            
            logger.error('');
            logger.error(' ');
            logger.error('Error with special chars: !@#$%^&*()');
            
            // Error object edge cases
            logger.error(new Error(''));
            logger.error(new Error(' '));
            logger.error(new Error('Error with unicode: 🚀 🎯 ✨'));
        });
        
        // All should be logged (no debouncing for different messages)
        assert.ok(loggedMessages.length > 0);
    });

    test('should handle Error object with undefined message', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        // Create an error without a message
        const error = new Error();
        logger.error(error);

        assert.strictEqual(loggedMessages.length, 1, 'Should log one message');
        assert.strictEqual(loggedMessages[0].level, 'error', 'Should log at error level');
        assert.strictEqual(loggedMessages[0].message, '', 'Should log empty string for undefined message');
    });

    test('should dispose output channel', () => {
        let disposeCalled = false;

        // Override the dispose method to track if it's called
        mockOutputChannel.dispose = () => {
            disposeCalled = true;
        };

        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        logger.dispose();

        assert.strictEqual(disposeCalled, true, 'Should call dispose on output channel');
    });

    test('should log multiple messages in sequence', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        logger.info('First message');
        logger.warn('Second message');
        logger.error('Third message');

        assert.strictEqual(loggedMessages.length, 3, 'Should log three messages');
        assert.strictEqual(loggedMessages[0].message, 'First message');
        assert.strictEqual(loggedMessages[1].message, 'Second message');
        assert.strictEqual(loggedMessages[2].message, 'Third message');
    });

    test('should maintain state between method calls', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        logger.info('Test message 1');

        const sameLogger = Logger.getInstance();
        sameLogger.info('Test message 2');

        assert.strictEqual(loggedMessages.length, 2, 'Should log both messages');
        assert.strictEqual(logger, sameLogger, 'Should be the same instance');
    });
});
