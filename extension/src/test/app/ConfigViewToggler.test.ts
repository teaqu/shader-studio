import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConfigViewToggler } from '../../app/ConfigViewToggler';
import { Constants } from '../../app/Constants';
import { Logger } from '../../app/services/Logger';

suite('ConfigViewToggler Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let toggler: ConfigViewToggler;
    let mockLogger: any;

    setup(() => {
        sandbox = sinon.createSandbox();

        const mockOutputChannel = {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            dispose: sandbox.stub(),
        } as any;
        Logger.initialize(mockOutputChannel);

        mockLogger = {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
        };

        toggler = new ConfigViewToggler(mockLogger);
    });

    teardown(() => {
        sandbox.restore();
        (Logger as any).instance = undefined;
    });

    test('returns early with warning when no config file active', async () => {
        // No active text editor
        sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
        // No active tab / tab is not a custom editor
        sandbox.stub(vscode.window, 'tabGroups').value({
            activeTabGroup: { activeTab: undefined },
            all: [],
        });

        await toggler.toggle();

        sinon.assert.calledOnce(mockLogger.warn);
        assert.ok(mockLogger.warn.firstCall.args[0].includes('No shader config file found'));
    });

    test('switches from custom editor to text editor', async () => {
        const docUri = vscode.Uri.file('/test/shader.sha.json');

        // Simulate a custom editor tab being active
        const customTab = {
            input: new vscode.TabInputCustom(docUri, Constants.CONFIG_EDITOR_VIEW_TYPE),
        };
        sandbox.stub(vscode.window, 'tabGroups').value({
            activeTabGroup: { activeTab: customTab },
            all: [{ tabs: [customTab], viewColumn: vscode.ViewColumn.One }],
        });
        sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);

        const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves(undefined as any);

        await toggler.toggle();

        // Should open text editor since no existing text tab found
        sinon.assert.calledOnce(showTextDocStub);
        assert.strictEqual(showTextDocStub.firstCall.args[0].toString(), docUri.toString());
        assert.strictEqual(showTextDocStub.firstCall.args[1]?.viewColumn, vscode.ViewColumn.Beside);
    });

    test('switches from text editor to custom editor', async () => {
        const docUri = vscode.Uri.file('/test/shader.sha.json');

        // Simulate text editor being active with a .sha.json file
        const mockEditor = {
            document: {
                fileName: '/test/shader.sha.json',
                uri: docUri,
            },
        };
        sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);
        sandbox.stub(vscode.window, 'tabGroups').value({
            activeTabGroup: {
                activeTab: {
                    input: new vscode.TabInputText(docUri),
                },
            },
            all: [],
        });

        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

        await toggler.toggle();

        // Should open custom editor via vscode.openWith
        sinon.assert.calledOnce(executeCommandStub);
        assert.strictEqual(executeCommandStub.firstCall.args[0], 'vscode.openWith');
        assert.strictEqual(executeCommandStub.firstCall.args[1].toString(), docUri.toString());
        assert.strictEqual(executeCommandStub.firstCall.args[2], Constants.CONFIG_EDITOR_VIEW_TYPE);
        assert.strictEqual(executeCommandStub.firstCall.args[3], vscode.ViewColumn.Beside);
    });

    test('reuses existing text editor tab if found', async () => {
        const docUri = vscode.Uri.file('/test/shader.sha.json');

        // Custom editor is active
        const customTab = {
            input: new vscode.TabInputCustom(docUri, Constants.CONFIG_EDITOR_VIEW_TYPE),
        };
        // An existing text tab for the same file
        const textTab = {
            input: new vscode.TabInputText(docUri),
        };
        sandbox.stub(vscode.window, 'tabGroups').value({
            activeTabGroup: { activeTab: customTab },
            all: [
                { tabs: [customTab, textTab], viewColumn: vscode.ViewColumn.Two },
            ],
        });
        sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);

        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
        const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves(undefined as any);

        await toggler.toggle();

        // Should show text document in the same column as the existing tab
        sinon.assert.calledOnce(showTextDocStub);
        assert.strictEqual(showTextDocStub.firstCall.args[1]?.viewColumn, vscode.ViewColumn.Two);
    });

    test('reuses existing custom editor tab if found', async () => {
        const docUri = vscode.Uri.file('/test/shader.sha.json');

        // Text editor is active
        const mockEditor = {
            document: {
                fileName: '/test/shader.sha.json',
                uri: docUri,
            },
        };
        const textTab = {
            input: new vscode.TabInputText(docUri),
        };
        // An existing custom editor tab for the same file
        const customTab = {
            input: new vscode.TabInputCustom(docUri, Constants.CONFIG_EDITOR_VIEW_TYPE),
        };
        sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);
        sandbox.stub(vscode.window, 'tabGroups').value({
            activeTabGroup: { activeTab: textTab },
            all: [
                { tabs: [textTab, customTab], viewColumn: vscode.ViewColumn.Three },
            ],
        });

        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

        await toggler.toggle();

        // Should open custom editor in the column where the existing tab is
        sinon.assert.calledOnce(executeCommandStub);
        assert.strictEqual(executeCommandStub.firstCall.args[0], 'vscode.openWith');
        assert.strictEqual(executeCommandStub.firstCall.args[3], vscode.ViewColumn.Three);
    });

    test('opens in Beside column when no existing tab found', async () => {
        const docUri = vscode.Uri.file('/test/shader.sha.json');

        // Custom editor is active, no text tab exists
        const customTab = {
            input: new vscode.TabInputCustom(docUri, Constants.CONFIG_EDITOR_VIEW_TYPE),
        };
        sandbox.stub(vscode.window, 'tabGroups').value({
            activeTabGroup: { activeTab: customTab },
            all: [
                { tabs: [customTab], viewColumn: vscode.ViewColumn.One },
            ],
        });
        sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);

        const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves(undefined as any);

        await toggler.toggle();

        sinon.assert.calledOnce(showTextDocStub);
        assert.strictEqual(showTextDocStub.firstCall.args[1]?.viewColumn, vscode.ViewColumn.Beside);
    });

    test('handles toggle error gracefully', async () => {
        const docUri = vscode.Uri.file('/test/shader.sha.json');

        // Simulate text editor active
        const mockEditor = {
            document: {
                fileName: '/test/shader.sha.json',
                uri: docUri,
            },
        };
        sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);
        sandbox.stub(vscode.window, 'tabGroups').value({
            activeTabGroup: {
                activeTab: { input: new vscode.TabInputText(docUri) },
            },
            all: [],
        });

        // Make the command throw
        sandbox.stub(vscode.commands, 'executeCommand').rejects(new Error('Command failed'));
        const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as any);

        await toggler.toggle();

        sinon.assert.calledOnce(mockLogger.error);
        sinon.assert.calledOnce(showErrorStub);
        assert.ok(showErrorStub.firstCall.args[0].includes('Failed to toggle view'));
    });
});
