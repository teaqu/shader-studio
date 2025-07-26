import * as assert from 'assert';
import * as sinon from 'sinon';
import { WebSocket, WebSocketServer } from 'ws';
import { WebSocketTransport } from '../../../app/transport/WebSocketTransport';

suite('WebSocketTransport Test Suite', () => {
    let transport: WebSocketTransport;
    let sandbox: sinon.SinonSandbox;
    let mockWsServer: sinon.SinonStubbedInstance<WebSocketServer>;
    let mockWsClient: sinon.SinonStubbedInstance<WebSocket>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockWsServer = {
            on: sandbox.stub(),
            close: sandbox.stub(),
            emit: sandbox.stub(),
            addListener: sandbox.stub(),
            removeListener: sandbox.stub(),
            removeAllListeners: sandbox.stub(),
            setMaxListeners: sandbox.stub(),
            getMaxListeners: sandbox.stub(),
            listeners: sandbox.stub(),
            rawListeners: sandbox.stub(),
            listenerCount: sandbox.stub(),
            prependListener: sandbox.stub(),
            prependOnceListener: sandbox.stub(),
            eventNames: sandbox.stub(),
            off: sandbox.stub(),
            once: sandbox.stub(),
        } as any;

        mockWsClient = {
            readyState: WebSocket.OPEN,
            on: sandbox.stub(),
            send: sandbox.stub(),
            close: sandbox.stub(),
            ping: sandbox.stub(),
            terminate: sandbox.stub(),
        } as any;

        sandbox.stub(WebSocketServer.prototype, 'constructor' as any).callsFake(function(this: any) {
            Object.assign(this, mockWsServer);
            return this;
        });
    });

    teardown(() => {
        if (transport) {
            transport.close();
        }
        sandbox.restore();
    });

    test('hasActiveClients returns false when no clients connected', () => {
        transport = new WebSocketTransport(51475);
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('hasActiveClients returns true when clients are connected', () => {
        transport = new WebSocketTransport(51476);
        
        // Simulate client connection by accessing private wsClients
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        wsClients.add(mockWsClient as any);
        
        assert.strictEqual(transport.hasActiveClients(), true);
    });

    test('hasActiveClients returns false after all clients disconnect', () => {
        transport = new WebSocketTransport(51477);
        
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        wsClients.add(mockWsClient as any);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        wsClients.delete(mockWsClient as any);
        
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('hasActiveClients returns true with multiple clients', () => {
        transport = new WebSocketTransport(51478);
        
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        const mockClient2 = { ...mockWsClient } as any;
        
        wsClients.add(mockWsClient as any);
        wsClients.add(mockClient2);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        wsClients.delete(mockWsClient as any);
        assert.strictEqual(transport.hasActiveClients(), true);
        
        wsClients.delete(mockClient2);
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('send method handles no clients gracefully', () => {
        transport = new WebSocketTransport(51479);
        
        assert.strictEqual(transport.hasActiveClients(), false);
        
        // Should not throw when sending to no clients
        assert.doesNotThrow(() => {
            transport.send({ type: 'test', data: 'hello' });
        });
    });

    test('close method clears all clients', () => {
        transport = new WebSocketTransport(51480);
        
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        wsClients.add(mockWsClient as any);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        transport.close();
        
        assert.strictEqual(transport.hasActiveClients(), false);
    });
});
