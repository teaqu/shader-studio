/** Opens the overlay for an already-created shader webview. */
export async function openEditorOverlay(vscode) {
  const frame = await vscode.shaderFrame();
  // The canvas mounts before shaderSource arrives. Until these controls are
  // enabled, the app intentionally ignores the extension's overlay command.
  await frame.locator('button[aria-label="Reset shader"]:enabled').waitFor({ state: 'visible' });
  // A restored overlay can exist before Monaco finishes mounting. Checking
  // Monaco here would toggle that open overlay closed during initialization.
  if (!await frame.locator('.editor-overlay').count()) {
    await vscode.evaluateInHost(async (api) => {
      await api.commands.executeCommand('shader-studio.toggleEditorOverlay');
    });
  }
  await frame.locator('.editor-overlay .monaco-editor').waitFor({ state: 'visible' });
  return frame;
}
