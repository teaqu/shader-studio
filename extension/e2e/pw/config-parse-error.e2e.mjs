import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'validation.slang');
const configPath = join(workspacePath, 'validation.sha.json');

test.use({ vscodeKey: 'config-parse-error' });

/**
 * A config that fails to parse leaves the shader compiling with no inputs,
 * which renders as a black frame the viewer used to explain nothing about.
 * Only the real host shows this: it needs the extension's config watcher, an
 * unsaved editor buffer as the source of truth, and a genuine recompile.
 */
test.describe('a shader config that cannot be parsed', () => {
  /** The pause button carries the viewer's error state. */
  const statusClass = (frame) => frame.evaluate(
    () => document.querySelector('button[aria-label="Toggle pause"]')?.className ?? '',
  );

  const editConfig = async (vscode, edit) => vscode.evaluateInHost(async (vscode, targetPath, mode) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Two, preserveFocus: false, preview: false,
    });
    await editor.edit((builder) => {
      if (mode === 'break') {
        builder.insert(new vscode.Position(0, 0), '{');
      } else {
        builder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)));
      }
    });
  }, configPath, edit);

  test('reports the parse failure and clears it once the config parses again', async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    const frame = await vscode.shaderFrame();
    await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect.poll(() => statusClass(frame), {
      message: 'shader never compiled cleanly', timeout: 90_000,
    }).toContain('toolbar-icon-button');
    await expect.poll(() => statusClass(frame), { timeout: 30_000 }).not.toContain('error');

    // The extension reads the open buffer, so an unsaved edit is enough and the
    // fixture on disk stays untouched.
    await editConfig(vscode, 'break');

    await expect.poll(() => statusClass(frame), {
      message: 'the broken config was never reported', timeout: 60_000,
    }).toContain('error');
    await expect.poll(
      () => frame.evaluate(() => document.querySelector('.error-tooltip')?.textContent ?? ''),
      { message: 'the reported error never named the config', timeout: 30_000 },
    ).toContain('Failed to parse config');

    await editConfig(vscode, 'restore');

    await expect.poll(() => statusClass(frame), {
      message: 'the config error outlived the broken config', timeout: 60_000,
    }).not.toContain('error');
  });
});
