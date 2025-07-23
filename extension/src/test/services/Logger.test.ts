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
            }
        };
    });

    teardown(() => {
        (Logger as any).instance = undefined;
    });

    test('should initialize logger with output channel', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        assert.ok(logger, 'Logger instance should be created');
    });

    test('should throw error when getting instance before initialization', () => {
        assert.throws(
            () => Logger.getInstance(),
            /Logger not initialized. Call Logger.initialize\(\) first./,
            'Should throw error when not initialized'
        );
    });

    test('should return same instance after initialization (singleton)', () => {
        Logger.initialize(mockOutputChannel);
        const logger1 = Logger.getInstance();
        const logger2 = Logger.getInstance();

        assert.strictEqual(logger1, logger2, 'Should return the same instance');
    });

    test('should log info message', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        logger.info('Test info message');

        assert.strictEqual(loggedMessages.length, 1, 'Should log one message');
        assert.strictEqual(loggedMessages[0].level, 'info', 'Should log at info level');
        assert.strictEqual(loggedMessages[0].message, 'Test info message', 'Should log correct message');
    });

    test('should log debug message', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        logger.debug('Test debug message');

        assert.strictEqual(loggedMessages.length, 1, 'Should log one message');
        assert.strictEqual(loggedMessages[0].level, 'debug', 'Should log at debug level');
        assert.strictEqual(loggedMessages[0].message, 'Test debug message', 'Should log correct message');
    });

    test('should log warn message', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        logger.warn('Test warning message');

        assert.strictEqual(loggedMessages.length, 1, 'Should log one message');
        assert.strictEqual(loggedMessages[0].level, 'warn', 'Should log at warn level');
        assert.strictEqual(loggedMessages[0].message, 'Test warning message', 'Should log correct message');
    });

    test('should log error message as string', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        logger.error('Test error message');

        assert.strictEqual(loggedMessages.length, 1, 'Should log one message');
        assert.strictEqual(loggedMessages[0].level, 'error', 'Should log at error level');
        assert.strictEqual(loggedMessages[0].message, 'Test error message', 'Should log correct message');
    });

    test('should log error message from Error object', () => {
        Logger.initialize(mockOutputChannel);
        const logger = Logger.getInstance();

        const error = new Error('Test error object');
        logger.error(error);

        assert.strictEqual(loggedMessages.length, 1, 'Should log one message');
        assert.strictEqual(loggedMessages[0].level, 'error', 'Should log at error level');
        assert.strictEqual(loggedMessages[0].message, 'Test error object', 'Should log error message');
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
