import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { WorkspaceFileScanner } from '../../app/WorkspaceFileScanner';

suite('WorkspaceFileScanner Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockWebview = {
            html: '',
            onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() }),
            postMessage: sandbox.stub(),
            asWebviewUri: sandbox.stub().callsFake((uri: vscode.Uri) => {
                return vscode.Uri.parse(`vscode-webview://mock/${path.basename(uri.fsPath)}`);
            }),
            options: {},
            cspSource: '',
        } as any;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('returns empty array when no workspace folders', async () => {
        sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

        const result = await WorkspaceFileScanner.scanFiles(
            ['png', 'jpg'],
            '/some/shader.glsl',
            mockWebview,
        );

        assert.deepStrictEqual(result, []);
    });

    test('returns empty array when workspace folders is empty', async () => {
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([]);

        const result = await WorkspaceFileScanner.scanFiles(
            ['png', 'jpg'],
            '/some/shader.glsl',
            mockWebview,
        );

        assert.deepStrictEqual(result, []);
    });

    test('finds files matching given extensions across workspace folders', async () => {
        const workspaceRoot = path.join(path.sep, 'workspace');
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspaceRoot), name: 'workspace', index: 0 },
        ]);

        const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles').resolves([
            vscode.Uri.file(path.join(workspaceRoot, 'textures', 'noise.png')),
            vscode.Uri.file(path.join(workspaceRoot, 'images', 'photo.jpg')),
        ]);

        const result = await WorkspaceFileScanner.scanFiles(
            ['png', 'jpg'],
            path.join(workspaceRoot, 'shaders', 'main.glsl'),
            mockWebview,
        );

        assert.strictEqual(result.length, 2);
        // Verify findFiles was called with correct glob pattern
        const pattern = findFilesStub.firstCall.args[0] as vscode.RelativePattern;
        assert.ok(pattern.pattern.includes('png'));
        assert.ok(pattern.pattern.includes('jpg'));
    });

    test('excludes node_modules', async () => {
        const workspaceRoot = path.join(path.sep, 'workspace');
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspaceRoot), name: 'workspace', index: 0 },
        ]);

        const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles').resolves([]);

        await WorkspaceFileScanner.scanFiles(
            ['png'],
            path.join(workspaceRoot, 'main.glsl'),
            mockWebview,
        );

        // Verify the exclude pattern contains node_modules
        const excludePattern = findFilesStub.firstCall.args[1];
        assert.strictEqual(excludePattern, '**/node_modules/**');
    });

    test('sorts same-directory files first, then alphabetical', async () => {
        const workspaceRoot = path.join(path.sep, 'workspace');
        const shaderDir = path.join(workspaceRoot, 'shaders');
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspaceRoot), name: 'workspace', index: 0 },
        ]);

        sandbox.stub(vscode.workspace, 'findFiles').resolves([
            vscode.Uri.file(path.join(workspaceRoot, 'textures', 'beta.png')),
            vscode.Uri.file(path.join(shaderDir, 'alpha.png')),
            vscode.Uri.file(path.join(workspaceRoot, 'textures', 'alpha.png')),
            vscode.Uri.file(path.join(shaderDir, 'zeta.png')),
        ]);

        const result = await WorkspaceFileScanner.scanFiles(
            ['png'],
            path.join(shaderDir, 'main.glsl'),
            mockWebview,
        );

        assert.strictEqual(result.length, 4);
        // Same-directory files first (alphabetical)
        assert.strictEqual(result[0].name, 'alpha.png');
        assert.ok(result[0].isSameDirectory);
        assert.strictEqual(result[1].name, 'zeta.png');
        assert.ok(result[1].isSameDirectory);
        // Then other files (alphabetical)
        assert.strictEqual(result[2].name, 'alpha.png');
        assert.ok(!result[2].isSameDirectory);
        assert.strictEqual(result[3].name, 'beta.png');
        assert.ok(!result[3].isSameDirectory);
    });

    test('converts paths to webview URIs via ConfigPathConverter', async () => {
        const workspaceRoot = path.join(path.sep, 'workspace');
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspaceRoot), name: 'workspace', index: 0 },
        ]);

        sandbox.stub(vscode.workspace, 'findFiles').resolves([
            vscode.Uri.file(path.join(workspaceRoot, 'textures', 'noise.png')),
        ]);

        const result = await WorkspaceFileScanner.scanFiles(
            ['png'],
            path.join(workspaceRoot, 'shaders', 'main.glsl'),
            mockWebview,
        );

        assert.strictEqual(result.length, 1);
        // thumbnailUri should be a webview URI string (from asWebviewUri)
        assert.ok(result[0].thumbnailUri.includes('noise.png'));
    });

    test('builds correct workspacePath with @/ prefix', async () => {
        const workspaceRoot = path.join(path.sep, 'workspace');
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspaceRoot), name: 'workspace', index: 0 },
        ]);

        sandbox.stub(vscode.workspace, 'findFiles').resolves([
            vscode.Uri.file(path.join(workspaceRoot, 'textures', 'noise.png')),
        ]);

        const result = await WorkspaceFileScanner.scanFiles(
            ['png'],
            path.join(workspaceRoot, 'shaders', 'main.glsl'),
            mockWebview,
        );

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].workspacePath, '@/textures/noise.png');
    });

    test('handles multiple workspace folders', async () => {
        const workspace1 = path.join(path.sep, 'workspace1');
        const workspace2 = path.join(path.sep, 'workspace2');
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspace1), name: 'workspace1', index: 0 },
            { uri: vscode.Uri.file(workspace2), name: 'workspace2', index: 1 },
        ]);

        const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles');
        findFilesStub.onFirstCall().resolves([
            vscode.Uri.file(path.join(workspace1, 'tex', 'a.png')),
        ]);
        findFilesStub.onSecondCall().resolves([
            vscode.Uri.file(path.join(workspace2, 'img', 'b.png')),
        ]);

        const result = await WorkspaceFileScanner.scanFiles(
            ['png'],
            path.join(workspace1, 'main.glsl'),
            mockWebview,
        );

        assert.strictEqual(findFilesStub.callCount, 2);
        assert.strictEqual(result.length, 2);
    });
});
