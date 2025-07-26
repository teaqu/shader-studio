import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { GlslFileTracker } from '../../app/GlslFileTracker';

suite('GlslFileTracker Test Suite', () => {
    let tracker: GlslFileTracker;
    let sandbox: sinon.SinonSandbox;
    let mockContext: sinon.SinonStubbedInstance<vscode.ExtensionContext>;
    let mockGlobalState: sinon.SinonStubbedInstance<vscode.Memento>;
    let windowStub: sinon.SinonStub;
    let visibleEditorsStub: sinon.SinonStub;

    function createMockEditor(filePath: string, languageId: string): vscode.TextEditor {
        const mockUri = {
            fsPath: filePath,
            scheme: 'file',
            authority: '',
            path: filePath,
            query: '',
            fragment: '',
            with: sandbox.stub(),
            toJSON: sandbox.stub(),
            toString: sandbox.stub()
        } as any;

        const mockDocument = {
            uri: mockUri,
            fileName: filePath,
            languageId: languageId,
            version: 1,
            isDirty: false,
            isClosed: false,
            save: sandbox.stub(),
            eol: vscode.EndOfLine.LF,
            lineCount: 10,
            getText: sandbox.stub(),
            getWordRangeAtPosition: sandbox.stub(),
            lineAt: sandbox.stub(),
            offsetAt: sandbox.stub(),
            positionAt: sandbox.stub(),
            validateRange: sandbox.stub(),
            validatePosition: sandbox.stub()
        } as any;

        return {
            document: mockDocument,
            selection: new vscode.Selection(0, 0, 0, 0),
            selections: [new vscode.Selection(0, 0, 0, 0)],
            visibleRanges: [],
            options: {},
            viewColumn: vscode.ViewColumn.One,
            edit: sandbox.stub(),
            insertSnippet: sandbox.stub(),
            setDecorations: sandbox.stub(),
            revealRange: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub()
        } as any;
    }

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock GlobalState
        mockGlobalState = {
            get: sandbox.stub(),
            update: sandbox.stub(),
            keys: sandbox.stub().returns([])
        } as any;

        // Mock ExtensionContext
        mockContext = {
            globalState: mockGlobalState,
            workspaceState: sandbox.stub() as any,
            subscriptions: [],
            extensionPath: '/test/extension',
            storageUri: undefined,
            globalStorageUri: undefined,
            logUri: undefined,
            extensionUri: vscode.Uri.file('/test/extension'),
            environmentVariableCollection: sandbox.stub() as any,
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: sandbox.stub(),
            storagePath: '/test/storage',
            globalStoragePath: '/test/globalstorage',
            logPath: '/test/logs',
            secrets: sandbox.stub() as any,
            extension: sandbox.stub() as any
        } as any;

        // Stub vscode.window methods
        windowStub = sandbox.stub(vscode.window, 'activeTextEditor');
        visibleEditorsStub = sandbox.stub(vscode.window, 'visibleTextEditors');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Constructor', () => {
        test('should initialize with no last viewed file when none stored', () => {
            mockGlobalState.get.withArgs('lastViewedGlslFile').returns(undefined);

            tracker = new GlslFileTracker(mockContext);

            assert.strictEqual(tracker.getLastViewedGlslFile(), null);
            assert.ok(mockGlobalState.get.calledWith('lastViewedGlslFile'));
        });

        test('should restore last viewed file from global state', () => {
            const storedPath = '/test/previous-shader.glsl';
            mockGlobalState.get.withArgs('lastViewedGlslFile').returns(storedPath);

            tracker = new GlslFileTracker(mockContext);

            assert.strictEqual(tracker.getLastViewedGlslFile(), storedPath);
        });
    });

    suite('isGlslEditor', () => {
        setup(() => {
            mockGlobalState.get.withArgs('lastViewedGlslFile').returns(null);
            tracker = new GlslFileTracker(mockContext);
        });

        test('should return true for GLSL language ID', () => {
            const glslEditor = createMockEditor('/test/shader.frag', 'glsl');

            const result = tracker.isGlslEditor(glslEditor);

            assert.strictEqual(result, true);
        });

        test('should return true for .glsl file extension', () => {
            const glslEditor = createMockEditor('/test/shader.glsl', 'plaintext');

            const result = tracker.isGlslEditor(glslEditor);

            assert.strictEqual(result, true);
        });

        test('should return false for non-GLSL files', () => {
            const tsEditor = createMockEditor('/test/script.ts', 'typescript');

            const result = tracker.isGlslEditor(tsEditor);

            assert.strictEqual(result, false);
        });
    });

    suite('setLastViewedGlslFile', () => {
        setup(() => {
            mockGlobalState.get.withArgs('lastViewedGlslFile').returns(null);
            tracker = new GlslFileTracker(mockContext);
        });

        test('should update last viewed file and persist to global state', () => {
            const filePath = '/test/new-shader.glsl';

            tracker.setLastViewedGlslFile(filePath);

            assert.strictEqual(tracker.getLastViewedGlslFile(), filePath);
            assert.ok(mockGlobalState.update.calledWith('lastViewedGlslFile', filePath));
        });
    });

    suite('getActiveOrLastViewedGLSLEditor', () => {
        setup(() => {
            mockGlobalState.get.withArgs('lastViewedGlslFile').returns(null);
            tracker = new GlslFileTracker(mockContext);
        });

        test('should return active GLSL editor when available', () => {
            const glslEditor = createMockEditor('/test/shader.glsl', 'glsl');
            windowStub.get(() => glslEditor);

            const result = tracker.getActiveOrLastViewedGLSLEditor();

            assert.strictEqual(result, glslEditor);
            // Should also update the last viewed file
            assert.ok(mockGlobalState.update.calledWith('lastViewedGlslFile', '/test/shader.glsl'));
        });

        test('should return null when active editor is not GLSL', () => {
            const tsEditor = createMockEditor('/test/script.ts', 'typescript');
            windowStub.get(() => tsEditor);
            visibleEditorsStub.get(() => []);

            const result = tracker.getActiveOrLastViewedGLSLEditor();

            assert.strictEqual(result, null);
        });

        test('should return null when no active editor', () => {
            windowStub.get(() => undefined);
            visibleEditorsStub.get(() => []);

            const result = tracker.getActiveOrLastViewedGLSLEditor();

            assert.strictEqual(result, null);
        });

        test('should find last viewed file in visible editors when no active GLSL editor', () => {
            // Setup: No active editor
            windowStub.get(() => undefined);
            
            // Setup: Last viewed file exists
            const lastViewedPath = '/test/shader.glsl';
            tracker.setLastViewedGlslFile(lastViewedPath);
            
            // Create a mock visible editor that matches the last viewed file
            const mockVisibleEditor = createMockEditor(lastViewedPath, 'glsl');
            visibleEditorsStub.get(() => [mockVisibleEditor]);

            const result = tracker.getActiveOrLastViewedGLSLEditor();

            assert.strictEqual(result, mockVisibleEditor);
        });

        test('should return null when last viewed file is not in visible editors', () => {
            // Setup: No active editor
            windowStub.get(() => undefined);
            
            // Setup: Last viewed file exists but not in visible editors
            tracker.setLastViewedGlslFile('/test/not-visible.glsl');
            
            // Setup: Different visible editor
            const mockVisibleEditor = createMockEditor('/test/different.glsl', 'glsl');
            visibleEditorsStub.get(() => [mockVisibleEditor]);

            const result = tracker.getActiveOrLastViewedGLSLEditor();

            assert.strictEqual(result, null);
        });

        test('should prioritize active editor over last viewed file', () => {
            // Setup: Active GLSL editor
            const activeEditor = createMockEditor('/test/current.glsl', 'glsl');
            windowStub.get(() => activeEditor);
            
            // Setup: Different last viewed file in visible editors
            tracker.setLastViewedGlslFile('/test/previous.glsl');
            const mockVisibleEditor = createMockEditor('/test/previous.glsl', 'glsl');
            visibleEditorsStub.get(() => [mockVisibleEditor]);

            const result = tracker.getActiveOrLastViewedGLSLEditor();

            // Should return active editor, not the visible editor from last viewed
            assert.strictEqual(result, activeEditor);
        });
    });

    suite('Integration scenarios', () => {
        setup(() => {
            mockGlobalState.get.withArgs('lastViewedGlslFile').returns(null);
            tracker = new GlslFileTracker(mockContext);
        });

        test('should handle workflow: view GLSL file, switch to non-GLSL, then back to panel', () => {
            // Step 1: User views a GLSL file
            const glslEditor = createMockEditor('/test/shader.glsl', 'glsl');
            windowStub.get(() => glslEditor);
            
            let result = tracker.getActiveOrLastViewedGLSLEditor();
            assert.strictEqual(result, glslEditor);
            assert.strictEqual(tracker.getLastViewedGlslFile(), '/test/shader.glsl');

            // Step 2: User switches to TypeScript file
            const tsEditor = createMockEditor('/test/script.ts', 'typescript');
            windowStub.get(() => tsEditor);

            // Step 3: User opens shader panel - should find the GLSL file in visible editors
            visibleEditorsStub.get(() => [tsEditor, glslEditor]);

            result = tracker.getActiveOrLastViewedGLSLEditor();
            assert.strictEqual(result, glslEditor);
        });

        test('should persist across extension reloads', () => {
            // Simulate first extension load
            const filePath = '/test/persistent-shader.glsl';
            tracker.setLastViewedGlslFile(filePath);

            // Simulate extension reload with new tracker instance
            mockGlobalState.get.withArgs('lastViewedGlslFile').returns(filePath);
            const newTracker = new GlslFileTracker(mockContext);

            assert.strictEqual(newTracker.getLastViewedGlslFile(), filePath);
        });
    });
});
