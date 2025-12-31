import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ShaderCreator } from '../../app/ShaderCreator';

suite('ShaderCreator Test Suite', () => {
    let testDir: string;
    let mockLogger: any;
    let shaderCreator: ShaderCreator;
    let sandbox: sinon.SinonSandbox;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        testDir = path.join(os.tmpdir(), `shader-creator-test-${Date.now()}`);
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    });

    setup(() => {
        sandbox = sinon.createSandbox();

        mockLogger = {
            info: sandbox.spy(),
            error: sandbox.spy(),
            debug: sandbox.spy(),
            warn: sandbox.spy(),
        };

        shaderCreator = new ShaderCreator(mockLogger);
    });

    teardown(() => {
        sandbox.restore();
    });

    suiteTeardown(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            const files = fs.readdirSync(testDir);
            for (const file of files) {
                try { fs.unlinkSync(path.join(testDir, file)); } catch { }
            }
            try { fs.rmdirSync(testDir); } catch { }
        }

        // Restore workspaceFolders
        try {
            sandbox.stub(vscode.workspace, 'workspaceFolders').value(originalWorkspaceFolders);
        } catch { }
    });

    test('should be instantiable with Logger', () => {
        assert.strictEqual(shaderCreator instanceof ShaderCreator, true);
    });

    test('should create a shader file when workspace is present', async () => {
        const testUri = vscode.Uri.file(testDir);
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: testUri,
            name: 'test-workspace',
            index: 0,
        } as any;

        // Make the workspace point to our temp directory
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

        // Stub VS Code document open/show to succeed
        const fakeDocument = {} as vscode.TextDocument;
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves(fakeDocument);
        sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
        const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

        await shaderCreator.create();

        // Expect a file named shadertoy.glsl or shadertoyN.glsl to exist
        const files = fs.readdirSync(testDir).filter(f => f.endsWith('.glsl'));
        assert.ok(files.length >= 1, 'Expected at least one .glsl file to be created');

        // Verify logger was called
        assert.ok((mockLogger.info as sinon.SinonSpy).calledOnce);

        // Verify user was informed
        assert.ok(infoStub.calledOnce);
    });

    test('should increment filename when file exists', async () => {
        // Create an initial file to force the counter
        const first = path.join(testDir, 'shadertoy.glsl');
        fs.writeFileSync(first, 'existing');

        const testUri = vscode.Uri.file(testDir);
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: testUri,
            name: 'test-workspace',
            index: 0,
        } as any;

        sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
        sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
        sandbox.stub(vscode.window, 'showInformationMessage');

        await shaderCreator.create();

        // Expect shadertoy1.glsl to exist
        const second = path.join(testDir, 'shadertoy1.glsl');
        assert.strictEqual(fs.existsSync(second), true);

        // Clean up created file
        try { fs.unlinkSync(second); } catch { }
        try { fs.unlinkSync(first); } catch { }
    });
});
