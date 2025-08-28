import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
const proxyquire = require('proxyquire');

suite('ElectronLauncher Port Configuration', () => {
    let sandbox: sinon.SinonSandbox;
    let electronLauncher: any;
    let mockContext: vscode.ExtensionContext;
    let mockWorkspaceConfig: any;
    let mockTerminal: any;
    let createTerminalStub: sinon.SinonStub;
    let childProcessMock: { exec: sinon.SinonStub; spawn: sinon.SinonStub; };
    let fsMock: any;

    setup(() => {
        sandbox = sinon.createSandbox();

        fsMock = {
            existsSync: sandbox.stub().returns(true),
            promises: {
                access: sandbox.stub().resolves(),
                readdir: sandbox.stub().resolves(['electron-launch.js']),
            }
        };
        childProcessMock = {
            exec: sandbox.stub(),
            spawn: sandbox.stub().returns({ on: sandbox.stub(), unref: sandbox.stub() }),
        };
        // Set default behavior for exec
        childProcessMock.exec.yields(null);

        const { ElectronLauncher } = proxyquire('../../app/ElectronLauncher', {
            'fs': fsMock,
            'child_process': childProcessMock,
        });

        const mockLogger = { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() };
        mockContext = {
            extensionUri: vscode.Uri.file('/mock/extension/path'),
            extensionMode: vscode.ExtensionMode.Development
        } as any;
        mockWorkspaceConfig = { get: sandbox.stub() };
        if (!(vscode.workspace.getConfiguration as any).isSinonProxy) {
            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockWorkspaceConfig);
        } else {
            (vscode.workspace.getConfiguration as sinon.SinonStub).returns(mockWorkspaceConfig);
        }
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: vscode.Uri.file('/mock/workspace') }]);
        mockTerminal = { sendText: sandbox.stub(), show: sandbox.stub(), hide: sandbox.stub(), dispose: sandbox.stub() };
        createTerminalStub = sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal);

        electronLauncher = new ElectronLauncher(mockContext, mockLogger as any);

        sandbox.stub(electronLauncher, 'findElectronApp').resolves({
            electronDir: '/mock/electron/dir',
            launcherScript: '/mock/electron/dir/dist/electron-launch.js'
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should pass configured WebSocket port to npx launch command', async () => {
        const testPort = 12345;
        mockWorkspaceConfig.get.withArgs('webSocketPort').returns(testPort);

        await electronLauncher.launch(true);

        assert.ok(createTerminalStub.calledOnce, 'Should create a terminal');
        const command = mockTerminal.sendText.getCall(0).args[0];
        assert.ok(command.includes(`--wsPort=${testPort}`), `Command should include "--wsPort=${testPort}". Got: ${command}`);
    });

    test('should pass default WebSocket port to npx launch command when not configured', async () => {
        mockWorkspaceConfig.get.withArgs('webSocketPort').returns(undefined);

        await electronLauncher.launch(true);

        assert.ok(createTerminalStub.calledOnce, 'Should create a terminal');
        const command = mockTerminal.sendText.getCall(0).args[0];
        assert.ok(command.includes('--wsPort=51472'), `Command should include the default port "--wsPort=51472". Got: ${command}`);
    });

    test('should pass configured WebSocket port to downloaded Electron launch command', async () => {
        const testPort = 54321;
        mockWorkspaceConfig.get.withArgs('webSocketPort').returns(testPort);

        childProcessMock.exec.reset();
        childProcessMock.exec.yields(new Error('npm not found'));

        sandbox.stub(electronLauncher, 'getOrDownloadElectron').resolves('/fake/path/to/electron');

        await electronLauncher.launch(true);

        assert.ok(createTerminalStub.calledOnce, 'Should create a terminal');
        const command = mockTerminal.sendText.getCall(0).args[0];
        assert.ok(command.includes(`--wsPort=${testPort}`), `Command should include "--wsPort=${testPort}". Got: ${command}`);
    });
});