import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

/**
 * What the suggest widget actually shows while a variable is being declared.
 * The completion provider is only one of its sources - VS Code adds word-based
 * suggestions from the open document on top - so asking the provider directly
 * cannot answer what the user sees. These tests read the widget's rows.
 */

const shaderPath = join(workspacePath, 'completion-declaration.glsl');

// `void` appears in the text, so word-based suggestions can offer it; `vec3`
// and `float` never do, and reach the widget only through the language server.
const SHADER = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord;
  color = vec4(uv, 0.0, 1.0);
}
`;

test.use({ vscodeKey: 'completion-declaration' });

test.describe('completion while declaring a variable', () => {
  let vscodeFixture;

  test.beforeAll(async ({ vscode }) => {
    vscodeFixture = vscode;
    await vscode.evaluateInHost(async (vscode, path, text) => {
      const uri = vscode.Uri.file(path);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
    }, shaderPath, SHADER);
  });

  test.afterAll(async () => {
    await vscodeFixture?.evaluateInHost(async (vscode, path) => {
      await vscode.workspace.fs.delete(vscode.Uri.file(path)).then(undefined, () => {});
    }, shaderPath);
  });

  /**
   * Type a prefix on a fresh line inside mainImage and read the widget rows.
   * Keys go to whatever the editor focuses - a textarea in older builds, an
   * EditContext div since 1.109 - so they are sent to the focused element
   * rather than to a selector that keeps moving.
   */
  async function suggestionsForPrefix(vscode, prefix) {
    await vscode.evaluateInHost(async (vscode, line) => {
      const editor = vscode.window.activeTextEditor;
      const end = new vscode.Position(line, editor.document.lineAt(line).text.length);
      editor.selection = new vscode.Selection(end, end);
      await vscode.window.showTextDocument(editor.document, { preview: false });
    }, 1);

    await vscode.window.keyboard.press('Enter');
    await vscode.window.keyboard.type(prefix, { delay: 120 });

    const widget = vscode.window.locator('.suggest-widget');
    await expect(widget).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      async () => widget.locator('.monaco-list-row').count(),
      { message: 'the suggest widget never listed a row', timeout: 30_000 },
    ).toBeGreaterThan(0);

    const labels = await widget.locator('.monaco-list-row .label-name').allInnerTexts();
    await vscode.window.keyboard.press('Escape');
    await vscode.evaluateInHost(async (vscode, line) => {
      const editor = vscode.window.activeTextEditor;
      await editor.edit((builder) => builder.delete(new vscode.Range(
        new vscode.Position(line, editor.document.lineAt(line).text.length),
        new vscode.Position(line + 1, editor.document.lineAt(line + 1).text.length),
      )));
    }, 1);
    return labels.map((label) => label.trim());
  }

  test('offers vector types but never void, which declares no variable', async ({ vscode }) => {
    const labels = await suggestionsForPrefix(vscode, 'v');

    expect(labels.some((label) => label === 'vec3'), `widget listed: ${labels.join(', ')}`).toBe(true);
    expect(labels.filter((label) => label === 'void'), `widget listed: ${labels.join(', ')}`).toEqual([]);
  });
});
