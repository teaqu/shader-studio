import { expect } from './fixtures.mjs';
import { PNG } from 'pngjs';

export async function replaceSource(vscode, source) {
  const previousClipboard = await vscode.evaluateInHost(vscode => vscode.env.clipboard.readText());
  try {
    await vscode.evaluateInHost((vscode, text) => vscode.env.clipboard.writeText(text), source);
    await vscode.window.locator('.monaco-editor .view-lines').filter({ visible: true }).first().click();
    await vscode.window.keyboard.press('ControlOrMeta+A');
    await vscode.window.keyboard.press('ControlOrMeta+V');
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.window.activeTextEditor?.document.getText())).toBe(source);
  } finally {
    await vscode.evaluateInHost((vscode, text) => vscode.env.clipboard.writeText(text), previousClipboard);
  }
}

export async function expectCanvasPixels(frame, rgb) {
  const canvas = frame.locator('.canvas-container canvas').first();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => {
    // Read the rendered canvas in its own colour space. macOS screenshots
    // transform sRGB green to display-profile [80,251,55] on this display.
    const url = await canvas.evaluate(element => element.toDataURL());
    const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [...data.subarray(offset, offset + 3)];
  }).toEqual(rgb);
}

export async function setPreviewLocked(vscode, frame, locked) {
  const toolbarButton = frame.locator('button.collapse-lock');
  if (await toolbarButton.evaluate(element => element.classList.contains('active')) === locked) return;
  await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('notifications.clearAll'));
  if (await toolbarButton.isVisible()) {
    await toolbarButton.click();
  } else {
    await frame.getByLabel('Open options menu', { exact: true }).click();
    await frame.locator('.options-menu-item[aria-label="Toggle lock"]').click();
  }
}
