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
    let mockGlslFileTracker: any;
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

        mockGlslFileTracker = {
            getLastViewedGlslFile: sandbox.stub().returns(null),
        };

        shaderCreator = new ShaderCreator(mockLogger, mockGlslFileTracker);
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

    test('should be instantiable with Logger and GlslFileTracker', () => {
        assert.strictEqual(shaderCreator instanceof ShaderCreator, true);
    });

    test('should create a shader file when user picks a location', async () => {
        const filePath = path.join(testDir, 'myshader.glsl');
        const fileUri = vscode.Uri.file(filePath);

        sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
        sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
        const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

        await shaderCreator.create();

        assert.strictEqual(fs.existsSync(filePath), true);
        assert.ok((mockLogger.info as sinon.SinonSpy).calledOnce);
        assert.ok(infoStub.calledOnce);

        // Clean up
        try { fs.unlinkSync(filePath); } catch { }
    });

    test('should do nothing when user cancels the save dialog', async () => {
        sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

        await shaderCreator.create();

        assert.ok((mockLogger.info as sinon.SinonSpy).notCalled);
    });

    test('should default to last viewed file directory', async () => {
        const lastViewedDir = path.join(testDir, 'shaders');
        if (!fs.existsSync(lastViewedDir)) {
            fs.mkdirSync(lastViewedDir, { recursive: true });
        }
        mockGlslFileTracker.getLastViewedGlslFile.returns(
            path.join(lastViewedDir, 'existing.glsl')
        );

        const showSaveDialogStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

        await shaderCreator.create();

        const callArgs = showSaveDialogStub.firstCall.args[0]!;
        const defaultUri = callArgs.defaultUri!;
        assert.strictEqual(path.dirname(defaultUri.fsPath), lastViewedDir);

        // Clean up
        try { fs.rmdirSync(lastViewedDir); } catch { }
    });

    test('should fall back to workspace root when no last viewed file', async () => {
        const testUri = vscode.Uri.file(testDir);
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: testUri,
            name: 'test-workspace',
            index: 0,
        } as any;

        sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
        mockGlslFileTracker.getLastViewedGlslFile.returns(null);

        const showSaveDialogStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

        await shaderCreator.create();

        const callArgs = showSaveDialogStub.firstCall.args[0]!;
        const defaultUri = callArgs.defaultUri!;
        assert.strictEqual(path.dirname(defaultUri.fsPath), testDir);
    });

    test('should pass GLSL filter and title to save dialog', async () => {
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file(testDir), name: 'test', index: 0,
        }]);
        const showSaveDialogStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

        await shaderCreator.create();

        const callArgs = showSaveDialogStub.firstCall.args[0]!;
        assert.deepStrictEqual(callArgs.filters, { 'GLSL Shader': ['glsl'] });
        assert.strictEqual(callArgs.title, 'New Shader');
    });

    test('should use shadertoy.glsl as default filename', async () => {
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file(testDir), name: 'test', index: 0,
        }]);
        const showSaveDialogStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

        await shaderCreator.create();

        const callArgs = showSaveDialogStub.firstCall.args[0]!;
        assert.strictEqual(path.basename(callArgs.defaultUri!.fsPath), 'shadertoy.glsl');
    });

    test('should open the file in editor after creation', async () => {
        const filePath = path.join(testDir, 'open-test.glsl');
        const fileUri = vscode.Uri.file(filePath);

        sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
        const openDocStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
        const showDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
        sandbox.stub(vscode.window, 'showInformationMessage');

        await shaderCreator.create();

        assert.ok(openDocStub.calledOnce);
        assert.strictEqual((openDocStub.firstCall.args[0] as vscode.Uri).fsPath, fileUri.fsPath);
        assert.ok(showDocStub.calledOnce);
        assert.deepStrictEqual(showDocStub.firstCall.args[1], { preview: false });

        // Clean up
        try { fs.unlinkSync(filePath); } catch { }
    });

    test('should write shader template content to the file', async () => {
        const filePath = path.join(testDir, 'template-test.glsl');
        const fileUri = vscode.Uri.file(filePath);

        sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
        sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
        sandbox.stub(vscode.window, 'showInformationMessage');

        await shaderCreator.create();

        const content = fs.readFileSync(filePath, 'utf-8');
        assert.ok(content.includes('void mainImage'));
        assert.ok(content.includes('fragColor'));

        // Clean up
        try { fs.unlinkSync(filePath); } catch { }
    });

    suite('createFromTemplate', () => {
        test('should write code to a unique file and open it', async () => {
            const testUri = vscode.Uri.file(testDir);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: testUri, name: 'test', index: 0,
            }]);
            sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
            sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
            sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.window, 'showInformationMessage');

            const code = 'void mainImage(out vec4 f, in vec2 fc) { f = vec4(1.0); }';
            await shaderCreator.createFromTemplate(code);

            const expectedPath = path.join(testDir, 'shadertoy.glsl');
            assert.strictEqual(fs.existsSync(expectedPath), true);
            const content = fs.readFileSync(expectedPath, 'utf-8');
            assert.strictEqual(content, code);

            // Clean up
            try { fs.unlinkSync(expectedPath); } catch { }
        });

        test('should generate unique filename when file already exists', async () => {
            const testUri = vscode.Uri.file(testDir);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: testUri, name: 'test', index: 0,
            }]);
            sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
            sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
            sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.window, 'showInformationMessage');

            // Create existing file
            const existingPath = path.join(testDir, 'shadertoy.glsl');
            fs.writeFileSync(existingPath, 'existing');

            const code = 'void mainImage(out vec4 f, in vec2 fc) { f = vec4(0.0); }';
            await shaderCreator.createFromTemplate(code);

            const expectedPath = path.join(testDir, 'shadertoy1.glsl');
            assert.strictEqual(fs.existsSync(expectedPath), true);
            const content = fs.readFileSync(expectedPath, 'utf-8');
            assert.strictEqual(content, code);

            // Clean up
            try { fs.unlinkSync(existingPath); } catch { }
            try { fs.unlinkSync(expectedPath); } catch { }
        });

        test('should launch shader viewer after creating file', async () => {
            const testUri = vscode.Uri.file(testDir);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: testUri, name: 'test', index: 0,
            }]);
            sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
            sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
            const execStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.window, 'showInformationMessage');

            await shaderCreator.createFromTemplate('code');

            assert.ok(execStub.calledWith('shader-studio.view'));

            // Clean up
            const filePath = path.join(testDir, 'shadertoy.glsl');
            try { fs.unlinkSync(filePath); } catch { }
        });

        test('should show error when no workspace folder is open', async () => {
            sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
            const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

            await shaderCreator.createFromTemplate('code');

            assert.ok(errorStub.calledOnce);
            assert.ok(errorStub.firstCall.args[0].includes('No workspace folder'));
        });

        test('should handle errors gracefully', async () => {
            const testUri = vscode.Uri.file(testDir);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: testUri, name: 'test', index: 0,
            }]);
            sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('test error'));
            const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

            await shaderCreator.createFromTemplate('code');

            assert.ok(errorStub.calledOnce);
            assert.ok(mockLogger.error.calledOnce);

            // Clean up
            const filePath = path.join(testDir, 'shadertoy.glsl');
            try { fs.unlinkSync(filePath); } catch { }
        });

        test('should use shadertoy.glsl when no file exists', async () => {
            const testUri = vscode.Uri.file(testDir);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: testUri, name: 'test', index: 0,
            }]);
            sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
            sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
            sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.window, 'showInformationMessage');

            const code = 'void mainImage(out vec4 f, in vec2 fc) { f = vec4(1.0); }';
            await shaderCreator.createFromTemplate(code);

            const expectedPath = path.join(testDir, 'shadertoy.glsl');
            assert.strictEqual(fs.existsSync(expectedPath), true);

            // Clean up
            try { fs.unlinkSync(expectedPath); } catch { }
        });

        test('should use shadertoy1.glsl when shadertoy.glsl exists', async () => {
            const testUri = vscode.Uri.file(testDir);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: testUri, name: 'test', index: 0,
            }]);
            sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
            sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
            sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.window, 'showInformationMessage');

            // Create existing file
            const existingPath = path.join(testDir, 'shadertoy.glsl');
            fs.writeFileSync(existingPath, 'existing');

            await shaderCreator.createFromTemplate('code');

            const expectedPath = path.join(testDir, 'shadertoy1.glsl');
            assert.strictEqual(fs.existsSync(expectedPath), true);

            // Clean up
            try { fs.unlinkSync(existingPath); } catch { }
            try { fs.unlinkSync(expectedPath); } catch { }
        });

        test('should use shadertoy2.glsl when both shadertoy.glsl and shadertoy1.glsl exist', async () => {
            const testUri = vscode.Uri.file(testDir);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: testUri, name: 'test', index: 0,
            }]);
            sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
            sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
            sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.window, 'showInformationMessage');

            // Create existing files
            const existing0 = path.join(testDir, 'shadertoy.glsl');
            const existing1 = path.join(testDir, 'shadertoy1.glsl');
            fs.writeFileSync(existing0, 'existing0');
            fs.writeFileSync(existing1, 'existing1');

            await shaderCreator.createFromTemplate('code');

            const expectedPath = path.join(testDir, 'shadertoy2.glsl');
            assert.strictEqual(fs.existsSync(expectedPath), true);

            // Clean up
            try { fs.unlinkSync(existing0); } catch { }
            try { fs.unlinkSync(existing1); } catch { }
            try { fs.unlinkSync(expectedPath); } catch { }
        });

        test('should skip to shadertoy3.glsl when 0, 1, 2 all exist', async () => {
            const testUri = vscode.Uri.file(testDir);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: testUri, name: 'test', index: 0,
            }]);
            sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
            sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
            sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.window, 'showInformationMessage');

            // Create existing files for shadertoy.glsl, shadertoy1.glsl, shadertoy2.glsl
            const existing0 = path.join(testDir, 'shadertoy.glsl');
            const existing1 = path.join(testDir, 'shadertoy1.glsl');
            const existing2 = path.join(testDir, 'shadertoy2.glsl');
            fs.writeFileSync(existing0, 'existing0');
            fs.writeFileSync(existing1, 'existing1');
            fs.writeFileSync(existing2, 'existing2');

            await shaderCreator.createFromTemplate('code');

            const expectedPath = path.join(testDir, 'shadertoy3.glsl');
            assert.strictEqual(fs.existsSync(expectedPath), true);

            // Clean up
            try { fs.unlinkSync(existing0); } catch { }
            try { fs.unlinkSync(existing1); } catch { }
            try { fs.unlinkSync(existing2); } catch { }
            try { fs.unlinkSync(expectedPath); } catch { }
        });
    });
});
