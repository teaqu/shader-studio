import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const fixturePath = join(workspacePath, 'conditional-macros');
const configPath = join(fixturePath, 'conditional-macros.sha.json');
const shaderPath = join(fixturePath, 'image.glsl');

test.use({ vscodeKey: 'conditional-macros' });

test.describe('GLSL conditional macros', () => {
  test('shows active common macros but excludes inactive, undefined, and commented definitions', async ({ vscode }) => {
    const providerLabels = await vscode.evaluateInHost(async (vscode, config, shader) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
      await vscode.workspace.getConfiguration('shader-studio').update(
        'languageServers.glsl.enabled', true, vscode.ConfigurationTarget.Global,
      );
      const configDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(config));
      await vscode.window.showTextDocument(configDocument, { preview: false });
      const shaderDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(shader));
      await vscode.window.showTextDocument(shaderDocument, { preview: false });
      const completions = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        shaderDocument.uri,
        shaderDocument.positionAt(shaderDocument.getText().length),
        undefined,
        1_000,
      );
      return (completions?.items ?? []).map((item) => (
        typeof item.label === 'string' ? item.label : item.label.label
      ));
    }, configPath, shaderPath);

    await vscode.evaluateInHost(async (vscode) => {
      const editor = vscode.window.activeTextEditor;
      const line = 1;
      const end = new vscode.Position(line, editor.document.lineAt(line).text.length);
      editor.selection = new vscode.Selection(end, end);
      await vscode.window.showTextDocument(editor.document, { preview: false });
    });

    await vscode.window.keyboard.press('Enter');
    await vscode.window.keyboard.type('u', { delay: 120 });
    const widget = vscode.window.locator('.suggest-widget');
    await expect(widget).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      async () => widget.locator('.monaco-list-row').count(),
      { message: 'the editor suggest widget never listed conditional macro completions', timeout: 30_000 },
    ).toBeGreaterThan(0);
    const labels = (await widget.locator('.monaco-list-row .label-name').allInnerTexts())
      .map((label) => label.trim());
    await vscode.window.keyboard.press('Escape');
    await vscode.window.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');

    expect(labels).toContain('uActiveMacro');
    expect(providerLabels).toContain('uActiveMacro');
    expect(labels).not.toContain('uInactiveMacro');
    expect(labels).not.toContain('uUndefinedMacro');
    expect(labels).not.toContain('uCommentMacro');
    expect(providerLabels).not.toContain('uInactiveMacro');
    expect(providerLabels).not.toContain('uUndefinedMacro');
    expect(providerLabels).not.toContain('uCommentMacro');
  });
});
