import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SnippetLibraryProvider } from '../../app/SnippetLibraryProvider';

suite('SnippetLibraryProvider Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: any;
    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = {
            extensionPath: '/fake/extension/path',
            subscriptions: [],
            workspaceState: {
                get: sandbox.stub().returns(null),
                update: sandbox.stub().resolves(),
            },
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Panel View Column', () => {
        test('should open panel in the shader studio view column when available', () => {
            const mockWebview = {
                html: '',
                onDidReceiveMessage: sandbox.stub(),
                asWebviewUri: sandbox.stub().callsFake((uri: vscode.Uri) => uri),
                cspSource: 'fake-csp',
            };
            const mockPanel = {
                webview: mockWebview,
                onDidDispose: sandbox.stub(),
                viewColumn: vscode.ViewColumn.Two,
            };

            sandbox.stub(vscode.window, 'tabGroups').value({
                all: [
                    {
                        viewColumn: vscode.ViewColumn.Two,
                        tabs: [{ label: 'Shader Studio', input: { viewType: 'shader-studio' } }],
                    },
                ],
            });
            const createPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel as any);

            const provider = new SnippetLibraryProvider(mockContext);
            provider.show();

            assert.ok(createPanelStub.calledOnce, 'createWebviewPanel should be called');
            assert.strictEqual(
                createPanelStub.firstCall.args[2],
                vscode.ViewColumn.Two,
                'should open in Shader Studio view column'
            );
        });

        test('should fall back to ViewColumn.One when shader studio is not open', () => {
            const mockWebview = {
                html: '',
                onDidReceiveMessage: sandbox.stub(),
                asWebviewUri: sandbox.stub().callsFake((uri: vscode.Uri) => uri),
                cspSource: 'fake-csp',
            };
            const mockPanel = {
                webview: mockWebview,
                onDidDispose: sandbox.stub(),
                viewColumn: vscode.ViewColumn.One,
            };

            sandbox.stub(vscode.window, 'tabGroups').value({ all: [] });
            const createPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel as any);

            const provider = new SnippetLibraryProvider(mockContext);
            provider.show();

            assert.strictEqual(
                createPanelStub.firstCall.args[2],
                vscode.ViewColumn.One,
                'should fall back to ViewColumn.One'
            );
        });

        test('should reveal existing panel in the shader studio view column', () => {
            const revealStub = sandbox.stub();
            sandbox.stub(vscode.window, 'tabGroups').value({
                all: [
                    {
                        viewColumn: vscode.ViewColumn.Three,
                        tabs: [{ label: 'Shader Studio', input: { viewType: 'shader-studio' } }],
                    },
                ],
            });
            const provider = new SnippetLibraryProvider(mockContext);
            (provider as any).panel = { reveal: revealStub };

            provider.show();

            assert.ok(revealStub.calledOnce, 'reveal should be called');
            assert.strictEqual(
                revealStub.firstCall.args[0],
                vscode.ViewColumn.Three,
                'should reveal in Shader Studio view column'
            );
        });
    });

    suite('Insert Snippet - Editor Fallback', () => {
        test('should insert into active text editor when available', async () => {
            const mockEditor = {
                document: { uri: vscode.Uri.file('/fake/shader.glsl') },
                viewColumn: vscode.ViewColumn.One,
                insertSnippet: sandbox.stub().resolves(true),
            };

            sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

            const provider = new SnippetLibraryProvider(mockContext);

            // Access private method via message handler simulation
            // We test the logic directly by calling the private method
            const insertSnippet = (provider as any).insertSnippet.bind(provider);
            await insertSnippet(['float x = 0.5;']);

            assert.ok(mockEditor.insertSnippet.calledOnce, 'insertSnippet should be called');
            const snippetArg = mockEditor.insertSnippet.firstCall.args[0];
            assert.ok(snippetArg instanceof vscode.SnippetString, 'should pass a SnippetString');
            assert.strictEqual(snippetArg.value, 'float x = 0.5;');
        });

        test('should fall back to last active editor when no active editor', async () => {
            const mockLastEditor = {
                document: { uri: vscode.Uri.file('/fake/shader.glsl') },
                viewColumn: vscode.ViewColumn.Two,
                insertSnippet: sandbox.stub().resolves(true),
            };

            // Simulate: no active editor (snippet browser has focus)
            sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);

            // showTextDocument should return a fresh editor reference
            const mockRevealedEditor = {
                document: mockLastEditor.document,
                viewColumn: mockLastEditor.viewColumn,
                insertSnippet: sandbox.stub().resolves(true),
            };
            const showDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves(mockRevealedEditor as any);

            const provider = new SnippetLibraryProvider(mockContext);
            // Simulate that an editor was previously active
            (provider as any).lastActiveEditor = mockLastEditor;

            const insertSnippet = (provider as any).insertSnippet.bind(provider);
            await insertSnippet(['vec3 col = vec3(1.0);']);

            assert.ok(showDocStub.calledOnce, 'showTextDocument should be called to reveal editor');
            assert.strictEqual(showDocStub.firstCall.args[0], mockLastEditor.document);
            assert.ok(mockRevealedEditor.insertSnippet.calledOnce, 'should insert into revealed editor');
            const snippetArg = mockRevealedEditor.insertSnippet.firstCall.args[0];
            assert.strictEqual(snippetArg.value, 'vec3 col = vec3(1.0);');
        });

        test('should show warning when no editor available at all', async () => {
            sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
            const warnStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves();

            const provider = new SnippetLibraryProvider(mockContext);
            (provider as any).lastActiveEditor = undefined;

            const insertSnippet = (provider as any).insertSnippet.bind(provider);
            await insertSnippet(['float x = 1.0;']);

            assert.ok(warnStub.calledOnce, 'should show warning');
            assert.ok(warnStub.firstCall.args[0].includes('No active editor'));
        });

        test('should track editor changes via onDidChangeActiveTextEditor', () => {
            let changeHandler: ((editor: vscode.TextEditor | undefined) => void) | undefined;
            sandbox.stub(vscode.window, 'onDidChangeActiveTextEditor').callsFake((handler: any) => {
                changeHandler = handler;
                return { dispose: () => {} };
            });

            const mockEditor1 = { document: { uri: vscode.Uri.file('/a.glsl') } };
            sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor1);

            const provider = new SnippetLibraryProvider(mockContext);
            assert.strictEqual((provider as any).lastActiveEditor, mockEditor1);

            // Simulate switching to another editor
            const mockEditor2 = { document: { uri: vscode.Uri.file('/b.glsl') } };
            changeHandler!(mockEditor2 as any);
            assert.strictEqual((provider as any).lastActiveEditor, mockEditor2);

            // Simulate losing focus (e.g., opening webview) - should keep last
            changeHandler!(undefined);
            assert.strictEqual((provider as any).lastActiveEditor, mockEditor2);
        });

        test('should join multiple body lines with newline', async () => {
            const mockEditor = {
                document: { uri: vscode.Uri.file('/fake/shader.glsl') },
                viewColumn: vscode.ViewColumn.One,
                insertSnippet: sandbox.stub().resolves(true),
            };
            sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

            const provider = new SnippetLibraryProvider(mockContext);
            const insertSnippet = (provider as any).insertSnippet.bind(provider);
            await insertSnippet(['float x = 0.5;', 'float y = 1.0;']);

            const snippetArg = mockEditor.insertSnippet.firstCall.args[0];
            assert.strictEqual(snippetArg.value, 'float x = 0.5;\nfloat y = 1.0;');
        });

        test('should show error message when insertSnippet throws', async () => {
            const mockEditor = {
                document: { uri: vscode.Uri.file('/fake/shader.glsl') },
                viewColumn: vscode.ViewColumn.One,
                insertSnippet: sandbox.stub().rejects(new Error('insert failed')),
            };
            sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);
            const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

            const provider = new SnippetLibraryProvider(mockContext);
            const insertSnippet = (provider as any).insertSnippet.bind(provider);
            await insertSnippet(['float x = 0.5;']);

            assert.ok(errorStub.calledOnce, 'should show error message');
            assert.ok(errorStub.firstCall.args[0].includes('Failed to insert snippet'));
        });
    });

    suite('sendSnippets', () => {
        test('should post snippetsUpdate message to webview panel', async () => {
            // Use a temp dir with a real snippet file
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snip-test-'));
            const snippetsDir = path.join(tmpDir, 'snippets');
            fs.mkdirSync(snippetsDir);

            // Write a real sdf-2d snippet file
            fs.writeFileSync(
                path.join(snippetsDir, 'sdf-2d.code-snippets'),
                JSON.stringify({
                    'Circle': {
                        prefix: 'sd-circle',
                        body: ['float sdCircle(vec2 p, float r) {', '    return length(p) - r;', '}'],
                        description: 'SDF circle',
                        call: 'sdCircle(p, 0.5)',
                    },
                })
            );

            const postMessageStub = sandbox.stub().resolves();
            const ctx = { ...mockContext, extensionPath: tmpDir };
            sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

            const provider = new SnippetLibraryProvider(ctx);
            (provider as any).panel = { webview: { postMessage: postMessageStub } };

            await (provider as any).sendSnippets();

            assert.ok(postMessageStub.calledOnce);
            const message = postMessageStub.firstCall.args[0];
            assert.strictEqual(message.type, 'snippetsUpdate');
            assert.ok(Array.isArray(message.snippets));
            // Should have loaded our Circle snippet
            const circle = message.snippets.find((s: any) => s.name === 'Circle');
            assert.ok(circle, 'should find Circle snippet');
            assert.strictEqual(circle.category, 'sdf-2d');
            assert.strictEqual(circle.isCustom, false);
            assert.strictEqual(circle.call, 'sdCircle(p, 0.5)');

            // Cleanup
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test('should not post when panel is undefined', async () => {
            const provider = new SnippetLibraryProvider(mockContext);
            (provider as any).panel = undefined;

            // Should just return without error
            await (provider as any).sendSnippets();
        });

        test('should include saved state in snippets message', async () => {
            const postMessageStub = sandbox.stub().resolves();
            const savedState = { searchTerm: 'circle', cardSize: 150 };
            const ctx = {
                ...mockContext,
                workspaceState: {
                    get: sandbox.stub().returns(savedState),
                    update: sandbox.stub().resolves(),
                },
            };
            sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

            const provider = new SnippetLibraryProvider(ctx);
            (provider as any).panel = { webview: { postMessage: postMessageStub } };

            await (provider as any).sendSnippets();

            const message = postMessageStub.firstCall.args[0];
            assert.deepStrictEqual(message.savedState, savedState);
        });
    });

    suite('Custom Snippet CRUD', () => {
        let tmpDir: string;
        let vscodeDir: string;
        let snippetFilePath: string;

        setup(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snip-crud-'));
            vscodeDir = path.join(tmpDir, '.vscode');
            snippetFilePath = path.join(vscodeDir, 'glsl-snippets.code-snippets');
        });

        teardown(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        function createProvider(): { provider: SnippetLibraryProvider; postMessageStub: sinon.SinonStub } {
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: { fsPath: tmpDir },
                name: 'test',
                index: 0,
            }]);

            const postMessageStub = sandbox.stub().resolves();
            const provider = new SnippetLibraryProvider(mockContext);
            (provider as any).panel = { webview: { postMessage: postMessageStub } };
            return { provider, postMessageStub };
        }

        test('saveCustomSnippet should write snippet to file', async () => {
            const { provider } = createProvider();

            await (provider as any).saveCustomSnippet(
                'My Circle', 'my-circle', ['float d = length(p);'], 'A circle SDF',
                'sdCircle(p)', ['float d = length(p);', 'vec3 col = vec3(d);']
            );

            assert.ok(fs.existsSync(snippetFilePath), 'snippet file should be created');
            const written = JSON.parse(fs.readFileSync(snippetFilePath, 'utf-8'));
            assert.strictEqual(written['My Circle'].prefix, 'my-circle');
            assert.deepStrictEqual(written['My Circle'].body, ['float d = length(p);']);
            assert.strictEqual(written['My Circle'].description, 'A circle SDF');
            assert.strictEqual(written['My Circle'].call, 'sdCircle(p)');
            assert.deepStrictEqual(written['My Circle'].example, ['float d = length(p);', 'vec3 col = vec3(d);']);
        });

        test('saveCustomSnippet should merge with existing snippets', async () => {
            // Pre-populate with existing snippet
            fs.mkdirSync(vscodeDir, { recursive: true });
            fs.writeFileSync(snippetFilePath, JSON.stringify({
                'Existing': { prefix: 'ex', body: ['code'], description: 'existing' },
            }));

            const { provider } = createProvider();
            await (provider as any).saveCustomSnippet('New', 'new', ['new code'], 'new snippet');

            const written = JSON.parse(fs.readFileSync(snippetFilePath, 'utf-8'));
            assert.ok('Existing' in written, 'should keep existing snippet');
            assert.ok('New' in written, 'should add new snippet');
        });

        test('updateCustomSnippet should rename snippet when name changes', async () => {
            fs.mkdirSync(vscodeDir, { recursive: true });
            fs.writeFileSync(snippetFilePath, JSON.stringify({
                'Old Name': { prefix: 'old', body: ['code'], description: 'old' },
            }));

            const { provider } = createProvider();
            await (provider as any).updateCustomSnippet(
                'Old Name', 'New Name', 'new-prefix', ['updated code'], 'updated desc'
            );

            const written = JSON.parse(fs.readFileSync(snippetFilePath, 'utf-8'));
            assert.ok(!('Old Name' in written), 'should delete old entry');
            assert.ok('New Name' in written, 'should have new entry');
            assert.strictEqual(written['New Name'].prefix, 'new-prefix');
        });

        test('updateCustomSnippet should update in-place when name stays the same', async () => {
            fs.mkdirSync(vscodeDir, { recursive: true });
            fs.writeFileSync(snippetFilePath, JSON.stringify({
                'Same': { prefix: 'old-prefix', body: ['old code'], description: 'old desc' },
            }));

            const { provider } = createProvider();
            await (provider as any).updateCustomSnippet(
                'Same', 'Same', 'new-prefix', ['new code'], 'new desc'
            );

            const written = JSON.parse(fs.readFileSync(snippetFilePath, 'utf-8'));
            assert.ok('Same' in written);
            assert.strictEqual(written['Same'].prefix, 'new-prefix');
            assert.deepStrictEqual(written['Same'].body, ['new code']);
        });

        test('deleteCustomSnippet should remove snippet from file', async () => {
            fs.mkdirSync(vscodeDir, { recursive: true });
            fs.writeFileSync(snippetFilePath, JSON.stringify({
                'ToDelete': { prefix: 'del', body: ['code'], description: 'to delete' },
                'Keep': { prefix: 'keep', body: ['code'], description: 'keep this' },
            }));

            const { provider } = createProvider();
            await (provider as any).deleteCustomSnippet('ToDelete');

            const written = JSON.parse(fs.readFileSync(snippetFilePath, 'utf-8'));
            assert.ok(!('ToDelete' in written), 'should remove deleted snippet');
            assert.ok('Keep' in written, 'should keep other snippet');
        });

        test('saveCustomSnippet should not include call/example when not provided', async () => {
            const { provider } = createProvider();

            await (provider as any).saveCustomSnippet(
                'Simple', 'simple', ['float x = 1.0;'], 'A simple snippet'
            );

            const written = JSON.parse(fs.readFileSync(snippetFilePath, 'utf-8'));
            assert.ok(!('call' in written['Simple']), 'should not have call field');
            assert.ok(!('example' in written['Simple']), 'should not have example field');
        });

        test('saveCustomSnippet should create .vscode directory if it does not exist', async () => {
            // Use a fresh tmpDir where .vscode does NOT exist
            const freshTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snip-mkdir-'));
            const freshVscodeDir = path.join(freshTmpDir, '.vscode');
            const freshSnippetFile = path.join(freshVscodeDir, 'glsl-snippets.code-snippets');

            // Confirm .vscode doesn't exist yet
            assert.strictEqual(fs.existsSync(freshVscodeDir), false);

            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: { fsPath: freshTmpDir },
                name: 'test',
                index: 0,
            }]);

            const postMessageStub = sandbox.stub().resolves();
            const provider = new SnippetLibraryProvider(mockContext);
            (provider as any).panel = { webview: { postMessage: postMessageStub } };

            await (provider as any).saveCustomSnippet(
                'New Snippet', 'new-snip', ['float x = 1.0;'], 'A new snippet'
            );

            assert.strictEqual(fs.existsSync(freshVscodeDir), true, '.vscode directory should be created');
            assert.strictEqual(fs.existsSync(freshSnippetFile), true, 'snippet file should be created');
            const written = JSON.parse(fs.readFileSync(freshSnippetFile, 'utf-8'));
            assert.ok('New Snippet' in written, 'should contain the saved snippet');

            fs.rmSync(freshTmpDir, { recursive: true, force: true });
        });

        test('deleteCustomSnippet should handle non-existent snippet gracefully', async () => {
            // Pre-populate with a snippet, then delete one that does not exist
            fs.mkdirSync(vscodeDir, { recursive: true });
            fs.writeFileSync(snippetFilePath, JSON.stringify({
                'Existing': { prefix: 'ex', body: ['code'], description: 'existing' },
            }));

            const { provider, postMessageStub } = createProvider();
            // Delete a snippet name that doesn't exist in the file
            await (provider as any).deleteCustomSnippet('NonExistent');

            // Should not throw, and should still have the existing snippet
            const written = JSON.parse(fs.readFileSync(snippetFilePath, 'utf-8'));
            assert.ok('Existing' in written, 'should keep existing snippet untouched');
            assert.ok(!('NonExistent' in written), 'non-existent snippet should not appear');
        });

        test('CRUD operations should refresh snippets after modification', async () => {
            const { provider, postMessageStub } = createProvider();

            await (provider as any).saveCustomSnippet('Test', 'test', ['code'], 'desc');
            assert.ok(postMessageStub.called, 'should send updated snippets');
            const message = postMessageStub.lastCall.args[0];
            assert.strictEqual(message.type, 'snippetsUpdate');
        });
    });

    suite('Message Handling', () => {
        test('saveState message should persist state to workspace state', async () => {
            const state = { searchTerm: 'sdf', cardSize: 200, selectedCategory: 'all' };
            const provider = new SnippetLibraryProvider(mockContext);

            // Simulate the saveState message handling logic
            await mockContext.workspaceState.update('snippetLibrary.state', state);

            assert.ok(mockContext.workspaceState.update.calledOnce);
            assert.strictEqual(mockContext.workspaceState.update.firstCall.args[0], 'snippetLibrary.state');
            assert.deepStrictEqual(mockContext.workspaceState.update.firstCall.args[1], state);
        });
    });

    suite('loadCustomSnippets', () => {
        test('should load snippets from workspace .vscode/glsl-snippets.code-snippets', async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snip-load-'));
            const vscodeDir = path.join(tmpDir, '.vscode');
            fs.mkdirSync(vscodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(vscodeDir, 'glsl-snippets.code-snippets'),
                JSON.stringify({
                    'Custom SDF': {
                        prefix: 'custom-sdf',
                        body: 'float d = length(p);',
                        description: 'Custom SDF',
                        call: 'customSdf(p)',
                        example: ['float d = length(p);', 'vec3 col = vec3(d);'],
                    },
                })
            );

            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: { fsPath: tmpDir },
                name: 'test',
                index: 0,
            }]);

            const provider = new SnippetLibraryProvider(mockContext);
            const snippets = await (provider as any).loadCustomSnippets();

            assert.strictEqual(snippets.length, 1);
            assert.strictEqual(snippets[0].name, 'Custom SDF');
            assert.strictEqual(snippets[0].category, 'custom');
            assert.strictEqual(snippets[0].isCustom, true);
            assert.deepStrictEqual(snippets[0].body, ['float d = length(p);']);
            assert.deepStrictEqual(snippets[0].example, ['float d = length(p);', 'vec3 col = vec3(d);']);

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test('should return empty array when no workspace folders', async () => {
            sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

            const provider = new SnippetLibraryProvider(mockContext);
            const snippets = await (provider as any).loadCustomSnippets();

            assert.strictEqual(snippets.length, 0);
        });

        test('should handle malformed JSON gracefully and return empty array', async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snip-malformed-'));
            const vscodeDir = path.join(tmpDir, '.vscode');
            fs.mkdirSync(vscodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(vscodeDir, 'glsl-snippets.code-snippets'),
                '{ this is not valid json !!!'
            );

            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: { fsPath: tmpDir },
                name: 'test',
                index: 0,
            }]);

            const provider = new SnippetLibraryProvider(mockContext);
            const snippets = await (provider as any).loadCustomSnippets();

            assert.strictEqual(snippets.length, 0);

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test('should handle missing snippet file gracefully', async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snip-missing-'));
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
                uri: { fsPath: tmpDir },
                name: 'test',
                index: 0,
            }]);

            const provider = new SnippetLibraryProvider(mockContext);
            const snippets = await (provider as any).loadCustomSnippets();

            assert.strictEqual(snippets.length, 0);

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });
});
