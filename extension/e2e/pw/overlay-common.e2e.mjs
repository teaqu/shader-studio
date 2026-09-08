import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { openEditorOverlay } from './editor-overlay.mjs';

const shaderPath = join(workspacePath, 'overlay-common.glsl');

test.use({ vscodeKey: 'overlay-common' });

/**
 * The Monaco overlay edits one pass at a time. Its language service therefore
 * has to be told which file is the shader's common pass: without it the pass is
 * analysed alone, and every macro and helper the common file defines lights up
 * as an undefined identifier in the editor the app itself provides.
 */
test.describe('GLSL common symbols in the Monaco overlay', () => {
  let frame;
  const app = () => frame;

  const refreshFrame = async (vscode) => { frame = await vscode.shaderFrame(); return frame; };

  test.beforeAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        'languageServers.glsl.enabled', true, vscode.ConfigurationTarget.Global,
      );
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    await openEditorOverlay(vscode);
    await refreshFrame(vscode);
    await expect.poll(
      () => app().locator('.editor-overlay .monaco-editor').count(),
      { message: 'Monaco overlay never rendered', timeout: 30_000 },
    ).toBeGreaterThan(0);
  });

  test.afterAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        'languageServers.glsl.enabled', undefined, vscode.ConfigurationTarget.Global,
      );
    }).catch(() => { /* the host may already be going away */ });
  });

  test('reports no undefined identifier for a macro and a helper the common file owns', async () => {
    // The language service has had every chance to publish markers by the time
    // the poll times out; a squiggle here is the regression.
    await expect.poll(
      async () => app().locator('.editor-overlay .squiggly-error, .editor-overlay .squiggly-warning').count(),
      { message: 'the overlay kept a diagnostic on a pass that only uses common symbols', timeout: 30_000 },
    ).toBe(0);
  });

  test('hovers a common macro with its definition', async () => {
    const span = app().locator('.editor-overlay .view-line span span').filter({ hasText: 'TAU' }).first();
    await span.waitFor({ state: 'visible', timeout: 30_000 });
    const position = await span.evaluate((element, needle) => {
      const node = Array.from(element.childNodes).find(
        (candidate) => candidate.nodeType === Node.TEXT_NODE && candidate.textContent?.includes(needle),
      );
      const index = node ? (node.textContent ?? '').indexOf(needle) : -1;
      if (index < 0) return null;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const token = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { x: token.left - box.left + token.width / 2, y: token.top - box.top + token.height / 2 };
    }, 'TAU');
    expect(position, 'TAU was not found in the overlay').not.toBeNull();

    await span.hover({ position, timeout: 30_000 });
    const hover = app().locator('.editor-overlay .monaco-hover-content').first();
    await expect.poll(async () => (await hover.count()) ? hover.innerText() : '', {
      message: 'the overlay hover never described the common macro',
      timeout: 30_000,
    }).toMatch(/#define TAU/);
  });
});
