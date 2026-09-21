import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { revertFixtureEditors } from './editor-actions.mjs';

const fixtureDir = join(workspacePath, 'wgsl-language-parity');
const errorsPath = join(fixtureDir, 'errors.wgsl');
const signaturePath = join(fixtureDir, 'signature.wgsl');
const colorsPath = join(fixtureDir, 'colors.wgsl');

test.use({ vscodeKey: 'wgsl-language-parity' });

async function showEditor(vscode, path) {
  return vscode.evaluateInHost(async (vscode, targetPath) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false });
    return document.uri.toString();
  }, path);
}

async function errorDiagnostics(vscode, uri) {
  return vscode.evaluateInHost(async (vscode, documentUri) => vscode.languages.getDiagnostics(vscode.Uri.parse(documentUri))
    .filter((item) => item.severity === vscode.DiagnosticSeverity.Error)
    .map((item) => ({ line: item.range.start.line, message: item.message, source: item.source ?? 'renderer' })), uri);
}

async function documentText(vscode, path) {
  return vscode.evaluateInHost(async (vscode, targetPath) => (
    vscode.workspace.textDocuments.find((document) => document.uri.fsPath === targetPath)?.getText() ?? ''
  ), path);
}

function editor(vscode) {
  return vscode.window.locator('.monaco-editor').filter({ has: vscode.window.locator('.view-lines') }).filter({ visible: true }).first();
}

test.describe('WGSL authoring parity in VS Code', () => {
  test.beforeAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
    });
  });

  test.afterEach(async ({ vscode }) => {
    await revertFixtureEditors(vscode, fixtureDir);
  });

  // Waits on the renderer's own WGSL compile, which needs a WebGPU adapter:
  // without one the instance is dropped and reports that as the only error.
  test('shows service errors before compilation, yields each line to the renderer, and clears after typing a fix @gpu', async ({ vscode }) => {
    const uri = await showEditor(vscode, errorsPath);
    await expect.poll(() => errorDiagnostics(vscode, uri), { message: 'the WGSL service never reported the undefined identifier' })
      .toEqual([{ line: 2, message: "Undefined identifier 'mysteriousGain'.", source: 'shader-studio-wgsl-ls' }]);

    await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('shader-studio.view'));
    await expect.poll(async () => {
      const errors = await errorDiagnostics(vscode, uri);
      return errors.length === 1 && errors[0].line === 2 && errors[0].source === 'renderer';
    }, { message: 'the renderer error never replaced the service error on its line', timeout: 90_000 }).toBe(true);

    await editor(vscode).locator('.view-line').getByText('mysteriousGain').dblclick();
    await vscode.window.keyboard.type('1.5');
    await expect.poll(() => documentText(vscode, errorsPath)).toContain('shade * 1.5,');
    await expect.poll(() => errorDiagnostics(vscode, uri), { message: 'errors survived the typed correction', timeout: 60_000 }).toEqual([]);
    expect(readFileSync(errorsPath, 'utf8')).toContain('mysteriousGain');
  });

  test('shows structured signature help while typing nested arguments', async ({ vscode }) => {
    await showEditor(vscode, signaturePath);
    await editor(vscode).locator('.view-line').getByText('return vec4f(lit, 1.0);').click();
    await vscode.window.keyboard.press('Home');
    await vscode.window.keyboard.type('let c = shade(');
    const hints = vscode.window.locator('.parameter-hints-widget').filter({ visible: true });
    await expect(hints).toContainText('fn shade(color: vec3f, gain: f32) -> vec3f');
    await expect(hints).toContainText('Scales a colour by gain.');
    await expect(hints.locator('.parameter.active')).toHaveText('color: vec3f');

    await vscode.window.keyboard.type('vec3f(max(1.0, 2.0)), ');
    await expect(hints.locator('.parameter.active')).toHaveText('gain: f32');
  });

  test('edits vec3f and vec3<f32> swatches through the colour picker without changing their constructors', async ({ vscode }) => {
    await showEditor(vscode, colorsPath);
    const original = readFileSync(colorsPath, 'utf8');
    for (const [index, pattern] of [
      [0, /let tint = vec3f\((\d*\.?\d+), (\d*\.?\d+), (\d*\.?\d+)\);/],
      [1, /let glow = vec3<f32>\((\d*\.?\d+), (\d*\.?\d+), (\d*\.?\d+)\);/],
    ]) {
      const swatch = editor(vscode).locator('.colorpicker-color-decoration').nth(index);
      await expect(swatch).toBeVisible();
      await swatch.click();
      const picker = vscode.window.locator('.colorpicker-widget').filter({ visible: true });
      await expect(picker).toBeVisible();
      const saturation = picker.locator('.saturation-wrap');
      const box = await saturation.boundingBox();
      await vscode.window.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
      await expect.poll(async () => {
        const line = (await documentText(vscode, colorsPath)).split('\n')[index + 1];
        return pattern.test(line) && line !== original.split('\n')[index + 1];
      }, { message: `swatch ${index} lost its constructor spelling or never changed` }).toBe(true);
      await vscode.window.keyboard.press('Escape');
    }
  });
});
