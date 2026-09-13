import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const commonPath = join(workspacePath, 'empty-common', 'common.glsl');
const imagePath = join(workspacePath, 'empty-common', 'image.glsl');
test.use({ vscodeKey: 'empty-common' });

test('clears the GLSL syntax error when the user empties a Common file', async ({ vscode }) => {
  await vscode.evaluateInHost(async (api, image, common) => {
    await api.extensions.getExtension('teaqu.shader-studio')?.activate();
    await api.window.showTextDocument(await api.workspace.openTextDocument(image));
    await api.window.showTextDocument(await api.workspace.openTextDocument(common), { preview: false });
  }, imagePath, commonPath);

  const diagnostics = () => vscode.evaluateInHost(async (api, target) =>
    api.languages.getDiagnostics(api.Uri.file(target))
      .filter(item => item.source === 'shader-studio-glsl-ls')
      .map(item => item.message), commonPath);
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  try {
    // First prove the live server is diagnosing this document. Then remove
    // the invalid source through the editor, as the user does to empty Common.
    await vscode.window.keyboard.press(`${modifier}+a`);
    await vscode.window.keyboard.type('float broken = ;');
    await expect.poll(diagnostics).not.toEqual([]);
    await vscode.window.keyboard.press(`${modifier}+a`);
    await vscode.window.keyboard.press('Backspace');
    await expect.poll(diagnostics, { message: 'an empty Common file must not retain a GLSL syntax diagnostic' }).toEqual([]);

    await vscode.evaluateInHost(async (api) => {
      await api.commands.executeCommand('workbench.actions.view.problems');
    });
    await expect(vscode.window.getByText('No problems have been detected in the workspace.')).toBeVisible();
  } finally {
    await vscode.evaluateInHost(async (api, target) => {
      await api.window.showTextDocument(await api.workspace.openTextDocument(target));
      await api.commands.executeCommand('workbench.action.files.revert');
    }, commonPath);
  }
});
