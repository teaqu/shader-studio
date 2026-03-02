import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ShaderStudioStatusBar } from '../../app/ShaderStudioStatusBar';

suite('ShaderStudioStatusBar Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: any;
    let mockStatusBarItem: any;
    let statusBar: ShaderStudioStatusBar;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = {
            subscriptions: []
        } as any;

        mockStatusBarItem = {
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            text: '',
            tooltip: '',
            command: ''
        };

        sandbox.stub(vscode.window, 'createStatusBarItem').returns(mockStatusBarItem as any);
        sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('constructor should create and show status bar item and register in context', () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        assert.ok((vscode.window.createStatusBarItem as sinon.SinonStub).calledOnce);
        assert.ok(mockStatusBarItem.show.calledOnce);
        assert.strictEqual(mockContext.subscriptions.indexOf(mockStatusBarItem) >= 0, true);
    });

    test('updateServerStatus should always show SHA text regardless of server state', () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        // Stopped state (default)
        statusBar.updateServerStatus(false);
        assert.strictEqual(mockStatusBarItem.text, 'SHA');
        assert.strictEqual(mockStatusBarItem.tooltip, 'Shader Studio - Click to open panel');

        // Running state — still shows plain SHA (status moved to panel menu)
        statusBar.updateServerStatus(true, 1234);
        assert.strictEqual(mockStatusBarItem.text, 'SHA');
        assert.strictEqual(mockStatusBarItem.tooltip, 'Shader Studio - Click to open panel');
    });

    test('showShaderStudioMenu should directly execute shader-studio.view command', async () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        await statusBar.showShaderStudioMenu();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledOnce);
        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('shader-studio.view'));
    });

    test('dispose should call dispose on status bar item', () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        statusBar.dispose();

        assert.ok(mockStatusBarItem.dispose.calledOnce);
    });
});
