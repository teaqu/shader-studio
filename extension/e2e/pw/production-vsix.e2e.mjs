import { test, expect, workspacePath } from './fixtures.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectCanvasPixels } from './editor-actions.mjs';

const vsixPath = process.env.SHADER_STUDIO_E2E_PRODUCTION_VSIX;
const fixtureDir = join(workspacePath, `production-vsix-${process.pid}`);
const shaderPath = join(fixtureDir, 'green.wgsl');
const configPath = join(fixtureDir, 'green.sha.json');

test.use({ vscodeKey: 'production-vsix', productionVsixPath: vsixPath ?? null });
test.skip(!vsixPath, 'Set SHADER_STUDIO_E2E_PRODUCTION_VSIX to run the packaged-extension smoke test.');

test('uses the installed production extension to render a WGSL shader', async ({ vscode }) => {
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(shaderPath, [
    'fn mainImage(coord: vec2f) -> vec4f {',
    '  let green = vec4f(0.0, 1.0, 0.0, 1.0);',
    '  return green;',
    '}',
    '',
  ].join('\n'));
  writeFileSync(configPath, JSON.stringify({ version: '1', passes: { Image: { inputs: {} } } }, null, 2));
  try {
    const extension = await vscode.evaluateInHost(async (vscode) => {
      const installed = vscode.extensions.getExtension('teaqu.shader-studio');
      if (!installed) {
        throw new Error('teaqu.shader-studio was not installed from the production VSIX');
      }
      await installed.activate();
      return { extensionPath: installed.extensionPath, active: installed.isActive };
    });
    expect(extension.active).toBe(true);
    expect(extension.extensionPath.startsWith(`${vscode.extensionsDir}/`)).toBe(true);

    await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      const position = new vscode.Position(1, 4);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    const frame = await vscode.shaderFrame();
    await expectCanvasPixels(frame, [0, 255, 0]);

    await frame.locator('.canvas-container canvas').first().click();
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.window.tabGroups.activeTabGroup.activeTab?.label))
      .toBe('Shader Studio');
    const debugButton = frame.locator('button.collapse-debug');
    if (await debugButton.isVisible()) {
      await debugButton.click();
    } else {
      await frame.getByLabel('Open options menu', { exact: true }).click();
      await expect.poll(() => vscode.evaluateInHost(vscode => vscode.window.tabGroups.activeTabGroup.activeTab?.label))
        .toBe('Shader Studio');
      await frame.locator('.options-menu-item[aria-label="Toggle debug mode"]').click();
    }
    await expect(frame.locator('.debug-panel')).toBeVisible();
    if (await frame.locator('.variables-section').count() === 0) {
      await frame.getByLabel('Toggle variable inspector').click();
    }
    await expect(frame.locator('.variables-section')).toBeVisible();
    await expect.poll(() => frame.evaluate(() => document.querySelector('.header-info')?.textContent?.trim() ?? ''))
      .toContain('L2');
    await expect.poll(async () => (await frame.locator('.variables-section .var-name').allTextContents()).join(' '))
      .toMatch(/green/);
  } finally {
    await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
