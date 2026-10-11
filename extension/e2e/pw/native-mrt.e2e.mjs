import { test, expect, workspacePath } from './fixtures.mjs';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectCanvasPixels, revertFixtureEditors } from './editor-actions.mjs';

const corpusRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'tests/fixtures/shader-corpus');
const fixtureDir = join(workspacePath, `native-mrt-${process.pid}`);
test.use({ vscodeKey: 'native-mrt' });

for (const language of ['wgsl', 'slang']) {
  test(`renders and persists selected ${language} MRT attachments in VS Code @gpu`, async ({ vscode }) => {
    mkdirSync(fixtureDir, { recursive: true });
    const shaderPath = join(fixtureDir, `two-outputs.${language}`);
    const configPath = join(fixtureDir, 'two-outputs.sha.json');
    const sourceDir = join(corpusRoot, language, 'native-mrt');
    writeFileSync(shaderPath, readFileSync(join(sourceDir, `two-outputs.${language}`)));
    writeFileSync(configPath, readFileSync(join(sourceDir, 'two-outputs.sha.json')));
    const open = async () => vscode.evaluateInHost(async (vscode, path) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.window.showTextDocument(document, { preview: false });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);
    try {
      await open();
      await expectCanvasPixels(await vscode.shaderFrame(), [64, 191, 0]);
      await vscode.evaluateInHost(async (vscode, path) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
        const config = JSON.parse(document.getText());
        config.passes.Image.inputs.iChannel0.output = 1;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), JSON.stringify(config, null, 2));
        if (!await vscode.workspace.applyEdit(edit)) {
          throw new Error('MRT config edit failed');
        }
        await document.save();
      }, configPath);
      await expectCanvasPixels(await vscode.shaderFrame(), [0, 191, 0]);
      expect(JSON.parse(readFileSync(configPath, 'utf8')).passes.Image.inputs.iChannel0.output).toBe(1);
      const frame = await vscode.shaderFrame();
      await vscode.window.keyboard.press('F1');
      await vscode.window.locator('.quick-input-widget input').fill('>Developer: Reload Window');
      await vscode.window.keyboard.press('Enter');
      await expect.poll(() => frame.isDetached()).toBe(true);
      await open();
      await expectCanvasPixels(await vscode.shaderFrame(), [0, 191, 0]);
    } finally {
      await revertFixtureEditors(vscode, fixtureDir);
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
}
