import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { WebviewTransport } from '../../../app/transport/WebviewTransport';

suite('WebviewTransport Test Suite', () => {
    let transport: WebviewTransport;
    let sandbox: sinon.SinonSandbox;
    let mockPanel: sinon.SinonStubbedInstance<vscode.WebviewPanel>;
    let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockWebview = {
            html: '',
            onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() }),
            postMessage: sandbox.stub(),
            asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
            options: {},
            cspSource: '',
        } as any;

        mockPanel = {
            webview: mockWebview,
            onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() }),
            dispose: sandbox.stub(),
            reveal: sandbox.stub(),
            title: 'Test Panel',
            viewType: 'test',
            viewColumn: vscode.ViewColumn.One,
            active: true,
            visible: true,
            iconPath: undefined,
        } as any;
    });

    teardown(() => {
        if (transport) {
            transport.close();
        }
        sandbox.restore();
    });

    test('hasActiveClients returns false when no panels added', () => {
        transport = new WebviewTransport();
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('hasActiveClients returns true when panel is added', () => {
        transport = new WebviewTransport();
        transport.addPanel(mockPanel as any);
        assert.strictEqual(transport.hasActiveClients(), true);
    });

    test('hasActiveClients returns false after panel is removed', () => {
        transport = new WebviewTransport();
        transport.addPanel(mockPanel as any);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        transport.removePanel(mockPanel as any);
        
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('hasActiveClients returns true with multiple panels', () => {
        transport = new WebviewTransport();
        
        const mockPanel2 = { ...mockPanel } as any;
        mockPanel2.webview = { ...mockWebview } as any;
        mockPanel2.onDidDispose = sandbox.stub().returns({ dispose: sandbox.stub() });
        
        transport.addPanel(mockPanel as any);
        transport.addPanel(mockPanel2);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        assert.strictEqual(transport.panelCount, 2);
        
        transport.removePanel(mockPanel as any);
        assert.strictEqual(transport.hasActiveClients(), true);
        assert.strictEqual(transport.panelCount, 1);
        
        transport.removePanel(mockPanel2);
        assert.strictEqual(transport.hasActiveClients(), false);
        assert.strictEqual(transport.panelCount, 0);
    });

    test('addPanel method adds panel and updates counts', () => {
        transport = new WebviewTransport();
        transport.addPanel(mockPanel as any);
        assert.strictEqual(transport.hasActiveClients(), true);
        assert.strictEqual(transport.panelCount, 1);
    });

    test('panelCount matches actual number of panels', () => {
        transport = new WebviewTransport();
        
        assert.strictEqual(transport.panelCount, 0);
        
        transport.addPanel(mockPanel as any);
        assert.strictEqual(transport.panelCount, 1);
        
        const mockPanel2 = { ...mockPanel } as any;
        mockPanel2.webview = { ...mockWebview } as any;
        mockPanel2.onDidDispose = sandbox.stub().returns({ dispose: sandbox.stub() });
        
        transport.addPanel(mockPanel2);
        assert.strictEqual(transport.panelCount, 2);
        
        transport.removePanel(mockPanel as any);
        assert.strictEqual(transport.panelCount, 1);
    });

    test('send method handles no panels gracefully', () => {
        transport = new WebviewTransport();
        
        assert.strictEqual(transport.hasActiveClients(), false);
        
        // Should not throw when sending to no panels
        assert.doesNotThrow(() => {
            transport.send({ type: 'test', data: 'hello' });
        });
    });

    test('send method posts message to all panels', () => {
        transport = new WebviewTransport();
        
        const mockPanel2 = { ...mockPanel } as any;
        mockPanel2.webview = { ...mockWebview } as any;
        mockPanel2.onDidDispose = sandbox.stub().returns({ dispose: sandbox.stub() });
        
        transport.addPanel(mockPanel as any);
        transport.addPanel(mockPanel2);
        
        const message = { type: 'test', data: 'hello' };
        transport.send(message);
        
        sinon.assert.calledWith(mockWebview.postMessage, message);
        sinon.assert.calledWith(mockPanel2.webview.postMessage, message);
    });

    test('close method disposes all panels', () => {
        transport = new WebviewTransport();
        
        const mockPanel2 = { ...mockPanel } as any;
        mockPanel2.webview = { ...mockWebview } as any;
        mockPanel2.onDidDispose = sandbox.stub().returns({ dispose: sandbox.stub() });
        mockPanel2.dispose = sandbox.stub();
        
        transport.addPanel(mockPanel as any);
        transport.addPanel(mockPanel2);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        transport.close();
        
        sinon.assert.called(mockPanel.dispose);
        sinon.assert.called(mockPanel2.dispose);
        assert.strictEqual(transport.hasActiveClients(), false);
        assert.strictEqual(transport.panelCount, 0);
    });

    test('onDidDispose callback removes panel from collection', () => {
        transport = new WebviewTransport();
        transport.addPanel(mockPanel as any);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        // Get the dispose callback that was registered
        const onDidDisposeCall = mockPanel.onDidDispose.getCall(0);
        const disposeCallback = onDidDisposeCall.args[0];
        
        // Simulate panel disposal
        disposeCallback();
        
        assert.strictEqual(transport.hasActiveClients(), false);
        assert.strictEqual(transport.panelCount, 0);
    });

    test('convertUriForClient uses first available panel', () => {
        transport = new WebviewTransport();
        
        // Should return original path when no panels
        const filePath = '/test/path/file.txt';
        assert.strictEqual(transport.convertUriForClient(filePath), filePath);
        
        transport.addPanel(mockPanel as any);
        
        // Should use webview.asWebviewUri when panel available
        const expectedUri = vscode.Uri.file('/mock/uri');
        mockWebview.asWebviewUri.returns(expectedUri);
        
        const result = transport.convertUriForClient(filePath);
        assert.strictEqual(result, expectedUri.toString());
        sinon.assert.calledWith(mockWebview.asWebviewUri, vscode.Uri.file(filePath));
    });
});
