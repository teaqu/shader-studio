import { expect } from './fixtures.mjs';
import { PNG } from 'pngjs';

export async function replaceSource(vscode, source) {
  await vscode.window.locator('.monaco-editor .view-lines').filter({ visible: true }).first().click();
  await vscode.window.keyboard.press('ControlOrMeta+A');
  // Exercise Monaco's paste handler without sharing the OS clipboard between
  // concurrent VS Code windows (including their clipboard-restoration steps).
  await vscode.window.evaluate(text => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, source);
  await expect.poll(() => vscode.evaluateInHost(vscode => vscode.window.activeTextEditor?.document.getText())).toBe(source);
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
  const changed = await toolbarButton.evaluate(element => element.classList.contains('active')) !== locked;
  if (changed) {
    if (await toolbarButton.isVisible()) {
      await toolbarButton.click();
    } else {
      await frame.getByLabel('Open options menu', { exact: true }).click();
      await frame.locator('.options-menu-item[aria-label="Toggle lock"]').click();
    }
    // VS Code notices focus inside a webview by polling every 250ms and reports
    // it asynchronously. If the next action moves to an editor before that report
    // lands, the late report makes the preview group active while the editor
    // keeps the caret, and Ctrl+S then saves the preview instead of the file.
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.window.tabGroups.activeTabGroup.activeTab?.label))
      .toBe('Shader Studio');
  }
  await expect(toolbarButton).toHaveClass(locked ? /active/ : /^(?!.*active)/);
}


// Reverting/closing editors changes the preview width. Cleanup uses the public
// command so a toolbar button moving into the options menu cannot stall teardown.
export async function unlockPreviewForCleanup(vscode, frame) {
  const isLocked = () => frame.evaluate(() => document.querySelector('button.collapse-lock')?.classList.contains('active') ?? false);
  if (await isLocked()) {
    await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('shader-studio.toggleLock'));
  }
  await expect.poll(isLocked).toBe(false);
}

export async function revertFixtureEditors(vscode, directory) {
  await vscode.evaluateInHost(async (vscode, directory) => {
    // The webview may own focus. Revert each dirty fixture's text editor
    // explicitly before deleting it, so the next test cannot open a save prompt.
    for (const document of vscode.workspace.textDocuments) {
      if (!document.isDirty || !document.uri.fsPath.startsWith(directory + '/')) {
        continue;
      }
      await vscode.window.showTextDocument(document, { preserveFocus: false, preview: false });
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  }, directory);
}

export async function setParameterExpression(frame, name, value) {
  const editor = frame.getByLabel(`Expression for ${name}`, { exact: true });
  await expect(editor).toBeVisible();
  // CodeJar commits on keyup. Keep the editing gesture in this renderer so a
  // different VS Code window starting up cannot take focus between keystrokes.
  await editor.evaluate((element, value) => {
    element.focus();
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
    element.blur();
  }, value);
  await expect(editor).toHaveText(value);
}
