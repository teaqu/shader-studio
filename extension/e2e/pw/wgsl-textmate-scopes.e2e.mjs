import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const scopeFixturePath = join(workspacePath, 'wgsl-authoring', 'tm-scopes.wgsl');

test.use({ vscodeKey: 'wgsl-textmate-scopes' });

async function inspectScopes(vscode, needle, offset = 1) {
  await vscode.evaluateInHost(async (vscode, path, target, targetOffset) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false,
    });
    const start = document.getText().indexOf(target);
    if (start < 0) {
      throw new Error(`Missing scope target ${target}`);
    }
    const position = document.positionAt(start + targetOffset);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
    await vscode.commands.executeCommand('editor.action.inspectTMScopes');
  }, scopeFixturePath, needle, offset);
}

async function expectInspectorScope(vscode, needle, scope, offset) {
  await inspectScopes(vscode, needle, offset);
  // VS Code exposes this widget as a native accessible table instead of a
  // stable CSS component class. Its TextMate row is the user-visible result.
  await expect(vscode.window.getByRole('cell', { name: new RegExp(scope) })).toBeVisible();
  await vscode.window.keyboard.press('Escape');
}

test.describe('WGSL TextMate scopes in VS Code', () => {
  test('scopes generic bitcast calls and xyzw swizzles in the native inspector', async ({ vscode }) => {
    await expectInspectorScope(vscode, 'bitcast', 'support.function.common.wgsl', 2);
    await expectInspectorScope(vscode, '.xyzw', 'variable.other.property.wgsl', 2);
  });
});
