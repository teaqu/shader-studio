import { expect, test, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { centrePixel } from './canvas-pixel.mjs';

test.use({ vscodeKey: 'wgsl-script-uniform-debug' });

function variableRow(frame, name) {
  return frame.locator('.var-row').filter({
    has: frame.locator('.var-name', { hasText: new RegExp(`^${name}$`) }),
  });
}

// A script feeds uniforms that a Common helper, a buffer pass and the Image
// pass all read. Debugging Image compiles every pass again and captures through
// its own shader, so both need the script's declarations.
test('debugging a script-driven WGSL chain captures locals and lists no script uniforms @gpu', async ({ vscode }) => {
  const shaderPath = join(workspacePath, 'script-uniform-chain', 'chain.wgsl');
  await vscode.evaluateInHost(async (api, path) => {
    const document = await api.workspace.openTextDocument(api.Uri.file(path));
    const editor = await api.window.showTextDocument(document, {
      viewColumn: api.ViewColumn.One, preserveFocus: false, preview: false,
    });
    const position = new api.Position(7, 4);
    editor.selection = new api.Selection(position, position);
    editor.revealRange(new api.Range(position, position));
    await api.commands.executeCommand('shader-studio.view');
    await api.commands.executeCommand('notifications.clearAll');
  }, shaderPath);
  await vscode.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 800 });
  });
  const frame = await vscode.shaderFrame();
  await expect(frame.locator('.menu-bar')).toBeVisible();
  // Turn debug on straight away, as a user would; the render is checked last.
  const debugButton = frame.getByLabel('Toggle debug mode');
  await expect(debugButton).toBeEnabled();
  if (await debugButton.isVisible()) {
    await debugButton.click();
  } else {
    await frame.getByLabel('Open options menu', { exact: true }).click();
    await frame.locator('.options-menu-item[aria-label="Toggle debug mode"]').click();
  }
  const panel = frame.locator('.debug-panel');
  await expect(panel).toBeVisible();
  if (await panel.locator('.variables-section').count() === 0) {
    await panel.getByLabel('Toggle variable inspector').click();
  }
  await expect(panel.locator('.variables-section')).toBeVisible();
  await expect(panel.locator('.header-info:not(.fn-name):not(.fn-type)')).toContainText('L8');
  for (const name of ['fragCoord', 'uv', 'src', 'col', 'depth']) {
    await expect(variableRow(frame, name)).toBeVisible();
  }
  // Script uniforms are engine inputs shown in the config panel's Script tab.
  for (const name of ['gain', 'tint', 'unused']) {
    await expect(variableRow(frame, name)).toHaveCount(0);
  }
  await expect(variableRow(frame, 'col').locator('.var-value')).toContainText(/0\.375/);
  await expect(frame.getByText(/Debug shader compilation failed/)).toHaveCount(0);
  await expect(panel.getByLabel('Show capture errors')).toHaveCount(0);
  // col = src.rgb * tint * gain at the centre: (0.5, 0.5, 0.5) * (1, 0.5, 0.25) * 0.75.
  await expect.poll(async () => {
    const [red, green, blue] = await centrePixel(frame);
    return red >= 92 && red <= 100 && green >= 44 && green <= 52 && blue >= 20 && blue <= 28;
  }, { message: 'the script-driven WGSL chain never rendered' }).toBe(true);
});
