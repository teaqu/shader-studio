import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { Messenger } from '../../../app/transport/Messenger';
import { MessageTransport } from '../../../app/transport/MessageTransport';
import { ErrorHandler } from '../../../app/ErrorHandler';

suite('Messenger Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let messenger: Messenger;
    let mockOutputChannel: any;
    let mockErrorHandler: sinon.SinonStubbedInstance<ErrorHandler>;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockOutputChannel = {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            dispose: sandbox.stub(),
        };

        mockErrorHandler = {
            handleError: sandbox.stub(),
            handlePersistentError: sandbox.stub(),
            clearErrors: sandbox.stub(),
            clearPersistentError: sandbox.stub(),
            setShaderConfig: sandbox.stub(),
            dispose: sandbox.stub(),
        } as any;

        // Stub the ErrorHandler constructor behavior by providing it directly
        messenger = new Messenger(mockOutputChannel, mockErrorHandler as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createMockTransport(): MessageTransport & { send: sinon.SinonStub; close: sinon.SinonStub; onMessage: sinon.SinonStub; hasActiveClients: sinon.SinonStub } {
        return {
            send: sandbox.stub(),
            close: sandbox.stub(),
            onMessage: sandbox.stub(),
            hasActiveClients: sandbox.stub().returns(false),
        };
    }

    test('send broadcasts to all transports', () => {
        const transport1 = createMockTransport();
        const transport2 = createMockTransport();
        messenger.addTransport(transport1);
        messenger.addTransport(transport2);

        const message = { type: 'test', payload: 'hello' };
        messenger.send(message);

        sinon.assert.calledOnce(transport1.send);
        sinon.assert.calledWith(transport1.send, message);
        sinon.assert.calledOnce(transport2.send);
        sinon.assert.calledWith(transport2.send, message);
    });

    test('send continues sending to other transports if one throws', () => {
        const transport1 = createMockTransport();
        const transport2 = createMockTransport();
        transport1.send.throws(new Error('Transport 1 failed'));
        messenger.addTransport(transport1);
        messenger.addTransport(transport2);

        const message = { type: 'test', payload: 'hello' };
        messenger.send(message);

        sinon.assert.calledOnce(transport1.send);
        sinon.assert.calledOnce(transport2.send);
        sinon.assert.calledWith(transport2.send, message);
    });

    test('addTransport registers transport and wires up message handler', () => {
        const transport = createMockTransport();
        messenger.addTransport(transport);

        sinon.assert.calledOnce(transport.onMessage);
        assert.strictEqual(typeof transport.onMessage.firstCall.args[0], 'function');
    });

    test('removeTransport removes transport from list', () => {
        const transport = createMockTransport();
        messenger.addTransport(transport);
        messenger.removeTransport(transport);

        const message = { type: 'test' };
        messenger.send(message);

        sinon.assert.notCalled(transport.send);
    });

    test('hasActiveClients returns true when any transport has clients', () => {
        const transport1 = createMockTransport();
        const transport2 = createMockTransport();
        transport1.hasActiveClients.returns(false);
        transport2.hasActiveClients.returns(true);
        messenger.addTransport(transport1);
        messenger.addTransport(transport2);

        assert.strictEqual(messenger.hasActiveClients(), true);
    });

    test('hasActiveClients returns false when no transports have clients', () => {
        const transport = createMockTransport();
        transport.hasActiveClients.returns(false);
        messenger.addTransport(transport);

        assert.strictEqual(messenger.hasActiveClients(), false);
    });

    test('hasActiveClients returns false when no transports registered', () => {
        assert.strictEqual(messenger.hasActiveClients(), false);
    });

    test('close closes all transports', () => {
        const transport1 = createMockTransport();
        const transport2 = createMockTransport();
        messenger.addTransport(transport1);
        messenger.addTransport(transport2);

        messenger.close();

        sinon.assert.calledOnce(transport1.close);
        sinon.assert.calledOnce(transport2.close);
    });

    test('getWebview returns webview from WebviewTransport', () => {
        const mockWebview = { html: '' };
        const transport = createMockTransport();
        (transport as any).getWebview = sandbox.stub().returns(mockWebview);
        messenger.addTransport(transport);

        const result = messenger.getWebview();
        assert.strictEqual(result, mockWebview);
    });

    test('getWebview returns null when no webview transport', () => {
        const transport = createMockTransport();
        messenger.addTransport(transport);

        const result = messenger.getWebview();
        assert.strictEqual(result, null);
    });

    test('getWebview returns null when webview transport has no webview', () => {
        const transport = createMockTransport();
        (transport as any).getWebview = sandbox.stub().returns(null);
        messenger.addTransport(transport);

        const result = messenger.getWebview();
        assert.strictEqual(result, null);
    });
});
