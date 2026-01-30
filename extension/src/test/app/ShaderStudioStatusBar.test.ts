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
        sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined as any);
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

    test('updateServerStatus should update text and tooltip for stopped and running states', () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        // Stopped state (default)
        statusBar.updateServerStatus(false);
        assert.strictEqual(mockStatusBarItem.text, 'SHA');
        assert.strictEqual(mockStatusBarItem.tooltip, 'Shader Studio - Click for options');

        // Running state with port
        statusBar.updateServerStatus(true, 1234);
        assert.strictEqual(mockStatusBarItem.text, '$(circle-filled) SHA');
        assert.ok(mockStatusBarItem.tooltip.includes('Server Running'));
        assert.ok(mockStatusBarItem.tooltip.includes('1234'));
    });

    test('showShaderStudioMenu should execute start command when selected (not running)', async () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        const choice = { label: '$(play-circle) Start Web Server', description: 'Start the Shader Studio web server', action: 'start-server' } as any;
        (vscode.window.showQuickPick as sinon.SinonStub).resolves(choice);

        await statusBar.showShaderStudioMenu();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('shader-studio.startWebServer'));
    });

    test('showShaderStudioMenu should execute open in browser when running', async () => {
        statusBar = new ShaderStudioStatusBar(mockContext);
        statusBar.updateServerStatus(true, 3000);

        const choice = { label: '$(globe) Open in Browser', description: 'Open Shader Studio in external browser', action: 'open-browser' } as any;
        (vscode.window.showQuickPick as sinon.SinonStub).resolves(choice);

        await statusBar.showShaderStudioMenu();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('shader-studio.openInBrowser'));
    });

    
    test('showShaderStudioMenu should execute stop command when running', async () => {
        statusBar = new ShaderStudioStatusBar(mockContext);
        statusBar.updateServerStatus(true, 3000);

        const choice = { label: '$(stop-circle) Stop Web Server', description: 'Stop the Shader Studio web server', action: 'stop-server' } as any;
        (vscode.window.showQuickPick as sinon.SinonStub).resolves(choice);

        await statusBar.showShaderStudioMenu();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('shader-studio.stopWebServer'));
    });

    test('showShaderStudioMenu should execute copy-url when running', async () => {
        statusBar = new ShaderStudioStatusBar(mockContext);
        statusBar.updateServerStatus(true, 3000);

        const choice = { label: '$(copy) Copy URL', description: 'Copy server URL to clipboard', action: 'copy-url' } as any;
        (vscode.window.showQuickPick as sinon.SinonStub).resolves(choice);

        await statusBar.showShaderStudioMenu();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('shader-studio.copyServerUrl'));
    });

    test('showShaderStudioMenu should execute show-panel', async () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        const choice = { label: '$(window) Show Panel', description: 'Show the Shader Studio panel', action: 'show-panel' } as any;
        (vscode.window.showQuickPick as sinon.SinonStub).resolves(choice);

        await statusBar.showShaderStudioMenu();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('shader-studio.view'));
    });

    test('showShaderStudioMenu should execute new-shader', async () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        const choice = { label: '$(new-file) New Shader', description: 'Create a new shadertoy.glsl file', action: 'new-shader' } as any;
        (vscode.window.showQuickPick as sinon.SinonStub).resolves(choice);

        await statusBar.showShaderStudioMenu();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('shader-studio.newShader'));
    });

    test('showShaderStudioMenu should execute open-settings', async () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        const choice = { label: '$(gear) Settings', description: 'Open Shader Studio settings', action: 'open-settings' } as any;
        (vscode.window.showQuickPick as sinon.SinonStub).resolves(choice);

        await statusBar.showShaderStudioMenu();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('shader-studio.openSettings'));
    });

    test('dispose should call dispose on status bar item', () => {
        statusBar = new ShaderStudioStatusBar(mockContext);

        statusBar.dispose();

        assert.ok(mockStatusBarItem.dispose.calledOnce);
    });
});
