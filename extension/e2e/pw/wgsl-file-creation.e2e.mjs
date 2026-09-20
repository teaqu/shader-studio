import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { openConfigPanel } from './config-panel.mjs';

test.setTimeout(45_000);
test.use({ vscodeKey: 'language-file-creation' });

async function prepareShader(vscode, shaderPath, configPath, source) {
  writeFileSync(shaderPath, source);
  writeFileSync(configPath, JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } }, null, 2));
  await vscode.evaluateInHost(async (vscode, path) => {
    // Each case creates its own preview. Close the previous case's retained
    // webview so frame discovery cannot select a panel being hidden.
    const previews = vscode.window.tabGroups.all.flatMap(group => group.tabs)
      .filter(tab => tab.input instanceof vscode.TabInputWebview);
    await vscode.window.tabGroups.close(previews);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand('shader-studio.view');
    return true;
  }, shaderPath);
}

async function openConfig(frame) {
  await expect(frame.locator('.config-panel')).toBeHidden();
  await openConfigPanel(frame);
  await expect(frame.locator('.config-panel')).toBeVisible();
}

async function simpleDialogState(vscode) {
  const setting = await vscode.evaluateInHost(async vscode =>
    vscode.workspace.getConfiguration('files').get('simpleDialog.enable'));
  const ui = await vscode.window.evaluate(() => ({
    quickInputCount: document.querySelectorAll('.quick-input-widget').length,
    monacoDialogCount: document.querySelectorAll('.monaco-dialog-box').length,
    roleDialogCount: document.querySelectorAll('[role="dialog"]').length,
    inputs: Array.from(document.querySelectorAll('input'), input => ({
      ariaLabel: input.getAttribute('aria-label'),
      className: input.className,
      placeholder: input.getAttribute('placeholder'),
      visible: Boolean(input.offsetParent),
    })),
    visibleText: document.body.innerText.slice(-1_500),
  }));
  return { setting, ui };
}

async function saveWithSimpleDialog(vscode, path, expectedDefaultPath) {
  const input = vscode.window.locator('.quick-input-widget input:visible, .monaco-dialog-box input:visible').last();
  try {
    await expect(input).toBeVisible({ timeout: 8_000 });
  } catch (failure) {
    throw new Error(`${failure.message}\nCreate dialog state: ${JSON.stringify(await simpleDialogState(vscode))}`);
  }
  await expect(input).toHaveValue(expectedDefaultPath);
  await input.fill(path);
  await input.press('Enter');
  await expect(input).toBeHidden({ timeout: 8_000 });
}

for (const language of [
  { name: 'GLSL', extension: 'glsl', source: 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }', vertex: 'void mainVertex' },
  { name: 'Slang', extension: 'slang', source: 'float4 mainImage(float2 coord) { return float4(1.0); }', vertex: 'void mainVertex' },
  { name: 'WGSL', extension: 'wgsl', source: 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }', vertex: 'ptr<function, vec3f>' },
]) {
  // Slang and WGSL need a WebGPU adapter to render what they create.
  test.describe(`${language.name} file creation in the VS Code config panel${language.extension === 'glsl' ? '' : ' @gpu'}`, () => {
    const fixtureDir = join(workspacePath, 'wgsl-authoring');
    const shaderPath = join(fixtureDir, `generated-file-creation-${language.extension}.${language.extension}`);
    const configPath = shaderPath.replace(new RegExp(`\\.${language.extension}$`), '.sha.json');
    const scriptPath = shaderPath.replace(new RegExp(`\\.${language.extension}$`), '.uniforms.ts');
    const vertexPath = shaderPath.replace(new RegExp(`\\.${language.extension}$`), `.vertex.${language.extension}`);
    const vertexSuggestedPath = shaderPath.replace(new RegExp(`\\.${language.extension}$`), `.image.vert.${language.extension}`);

    test.beforeEach(async ({ vscode }) => {
      await prepareShader(vscode, shaderPath, configPath, language.source);
    });

    test.afterEach(async ({ vscode }) => {
      const frame = await vscode.shaderFrame();
      if (await frame.locator('.config-panel').isVisible()) {
        await openConfigPanel(frame);
        await expect(frame.locator('.config-panel')).toBeHidden();
      }
      await vscode.evaluateInHost(async vscode => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      });
      for (const path of [shaderPath, configPath, scriptPath, vertexPath, scriptPath.replace(/\.ts$/, '.js'), scriptPath.replace(/\.ts$/, '.js.map'), `${shaderPath}.uniforms.ts`]) {
        try {
          rmSync(path); 
        } catch { /* fixture cleanup */ }
      }
    });

    test('uses the shader basename for scripts and creates a vertex hook', async ({ vscode }) => {
      const frame = await vscode.shaderFrame();
      await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('notifications.clearAll'));
      await openConfig(frame);
      await frame.getByRole('button', { name: '+ New' }).click();
      await frame.getByRole('menuitem', { name: 'Script' }).click();
      const script = frame.locator('.script-tab-content');
      await script.locator('.create-file-btn').click();
      await saveWithSimpleDialog(vscode, scriptPath, scriptPath);
      await expect.poll(() => existsSync(scriptPath), { timeout: 8_000 }).toBe(true);
      expect(existsSync(`${shaderPath}.uniforms.ts`)).toBe(false);
      await frame.getByRole('button', { name: 'Image', exact: true }).click();
      await frame.locator('select').filter({ has: frame.locator('option[value="plane"]') }).first().selectOption('plane');
      const vertex = frame.locator('.vertex-shader-title').locator('..');
      await vertex.locator('.create-file-btn').click();
      await saveWithSimpleDialog(vscode, vertexPath, vertexSuggestedPath);
      await expect.poll(() => existsSync(vertexPath), { timeout: 8_000 }).toBe(true);
      const source = readFileSync(vertexPath, 'utf8');
      expect(source).toContain(language.vertex);
      if (language.extension === 'wgsl') {
        expect(source).toContain('ptr<function, vec2f>');
      }
      await expect(frame.locator('.canvas-container canvas').first()).toBeVisible();
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
    });
  });
}
