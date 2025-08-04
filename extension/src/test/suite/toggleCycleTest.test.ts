import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('Toggle Cycle Test Suite', () => {
  let testConfigFile: string;
  let testConfigUri: vscode.Uri;

  suiteSetup(async () => {
    // Create a test .sha.json file in temp directory
    const os = require('os');
    const tempDir = os.tmpdir();
    
    testConfigFile = path.join(tempDir, 'test-cycle.sha.json');
    testConfigUri = vscode.Uri.file(testConfigFile);
    
    const testConfig = {
      version: "1.0",
      passes: {
        Image: {
          inputs: {}
        }
      }
    };
    
    fs.writeFileSync(testConfigFile, JSON.stringify(testConfig, null, 2));
  });

  suiteTeardown(async () => {
    // Clean up test file
    if (fs.existsSync(testConfigFile)) {
      fs.unlinkSync(testConfigFile);
    }
    
    // Close all tabs
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  setup(async () => {
    // Close all tabs before each test
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  test('Full toggle cycle: JSON → Preview → Source → Preview → Source', async function() {
    // Increase timeout for this test
    this.timeout(10000);
    
    // Step 1: Open source editor (text editor)
    const textDocument = await vscode.workspace.openTextDocument(testConfigUri);
    const textEditor = await vscode.window.showTextDocument(textDocument);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    assert.ok(vscode.window.activeTextEditor, 'Should have active text editor');
    assert.strictEqual(vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase(), testConfigFile.toLowerCase(), 'Should be viewing the test config file');
    
    // Step 2: First toggle to preview (JSON → preview)
    await vscode.commands.executeCommand('shader-studio.toggleConfigView');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify we're now in custom editor
    const currentTab1 = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(currentTab1?.input instanceof vscode.TabInputCustom, 'Should be in custom editor after first toggle');
    assert.strictEqual((currentTab1.input as vscode.TabInputCustom).viewType, 'shader-studio.configEditor', 'Should be in config editor');
    
    // Step 3: Toggle back to source (preview → source)
    await vscode.commands.executeCommand('shader-studio.toggleConfigView');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify we're back in text editor
    let activeEditor = vscode.window.activeTextEditor;
    let currentTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    
    assert.ok(activeEditor, 'Should have an active text editor after first return to source');
    assert.strictEqual(activeEditor.document.uri.fsPath.toLowerCase(), testConfigFile.toLowerCase(), 'Should be focused on the source text editor');
    assert.ok(currentTab?.input instanceof vscode.TabInputText, 'Should be in text editor tab');
    
    // Step 4: Second toggle to preview (source → preview again)
    await vscode.commands.executeCommand('shader-studio.toggleConfigView');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify we're in custom editor again
    const currentTab3 = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(currentTab3?.input instanceof vscode.TabInputCustom, 'Should be in custom editor after second toggle to preview');
    assert.strictEqual((currentTab3.input as vscode.TabInputCustom).viewType, 'shader-studio.configEditor', 'Should be in config editor again');
    
    // Step 5: Final toggle back to source (preview → source)
    await vscode.commands.executeCommand('shader-studio.toggleConfigView');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check final state
    activeEditor = vscode.window.activeTextEditor;
    currentTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    
    // The critical assertions that should reveal the bug
    if (!activeEditor) {
      assert.fail('BUG DETECTED: No active text editor after final toggle back to source!');
    }
    
    if (!activeEditor.document.uri.fsPath.toLowerCase().includes(testConfigFile.toLowerCase())) {
      assert.fail(`BUG DETECTED: Active editor is not the test config file! Expected: ${testConfigFile}, Got: ${activeEditor.document.uri.fsPath}`);
    }
    
    if (currentTab?.input instanceof vscode.TabInputCustom) {
      assert.fail('BUG DETECTED: Still in custom editor after final toggle back to source - the toggle cycle is broken!');
    }
  });

  test('Verify toggle commands are properly registered', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('shader-studio.toggleConfigView'), 'toggleConfigView command should be registered');
    assert.ok(commands.includes('shader-studio.toggleConfigViewToSource'), 'toggleConfigViewToSource command should be registered');
  });
});
