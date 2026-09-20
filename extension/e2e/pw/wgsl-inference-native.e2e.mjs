import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const stem = 'wgsl-inference-native';
const shaderPath = join(workspacePath, `${stem}.wgsl`);
const configPath = join(workspacePath, `${stem}.sha.json`);
const source = `fn mainImage(pixelPosition: vec2f) -> vec4f {
  let uv = vec2f(0.25, 0.75);
  let direct = normalize(uv);
  let bits = bitcast<vec2u>(uv);
  let leading = countLeadingZeros(vec2u(8u, 4u));
  let matrix = mat2x3f(vec3f(0.125, 0.25, 0.5), vec3f(0.75, 1.0, 0.875));
  let matrixColumn = matrix[0];
  let matrixScalar = matrix[1][2];
  let comparison = uv < vec2f(0.5, 1.0);
  let comparisonComponent = comparison.x;
  return vec4f(direct, matrixScalar, 1.0);
}
`;
const savedSource = source.replace('normalize(uv);\n', 'normalize(uv).yx;\n');

test.use({ vscodeKey: 'wgsl-inference-native' });

function row(frame, name) {
  return frame.locator('.var-row').filter({
    has: frame.locator('.var-name', { hasText: new RegExp(`^${name}$`) }),
  });
}

async function showAt(vscode, path, line, character = 2) {
  await vscode.evaluateInHost(async (vscode, targetPath, lineNumber, column) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false,
    });
    const position = new vscode.Position(lineNumber, column);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }, path, line, character);
}

async function enableInspector(frame) {
  await expect.poll(() => frame.evaluate(() => !document.querySelector(
    'button.collapse-debug[aria-label="Toggle debug mode"]')?.disabled,
  ), { message: 'WGSL shader never finished loading', timeout: 90_000 }).toBe(true);
  await frame.evaluate(() => {
    const button = document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]');
    if (button instanceof HTMLElement && !button.classList.contains('active')) {
      button.click();
    }
  });
  await expect(frame.locator('.debug-panel')).toBeVisible();
  if (await frame.locator('.variables-section').count() === 0) {
    await frame.getByLabel('Toggle variable inspector').click();
  }
  await expect(frame.locator('.variables-section')).toBeVisible();
}

test.describe('WGSL inference through the native VS Code editor @gpu', () => {
  test.beforeAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
    });
  });

  test('completes a direct normalize expression, persists inferred source, hovers it, and captures supported derived values', async ({ vscode }) => {
    try {
      await vscode.evaluateInHost(async (vscode, paths, text) => {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.config), Buffer.from(JSON.stringify({
          version: '1.0', passes: { Image: { path: `./${paths.name}` } },
        }, null, 2), 'utf8'));
        await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.shader), Buffer.from(text, 'utf8'));
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(paths.shader));
        const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
        const offset = document.getText().indexOf('normalize(uv)') + 'normalize(uv)'.length;
        const position = document.positionAt(offset);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
      }, { shader: shaderPath, config: configPath, name: `${stem}.wgsl` }, source);

      // A direct expression is incomplete while the popup is open, so this
      // checks the same recovery/inference path a person gets while typing.
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'));
      await vscode.window.keyboard.type('.');
      await expect.poll(() => vscode.evaluateInHost(async (vscode) =>
        vscode.window.activeTextEditor?.document.getText() ?? '',
      ), { message: 'the typed member selector never reached the native editor' }).toContain('normalize(uv).;');
      await expect.poll(() => vscode.evaluateInHost(async (vscode) => {
        const editor = vscode.window.activeTextEditor;
        const text = editor.document.getText();
        const memberEnd = text.indexOf('normalize(uv).') + 'normalize(uv).'.length;
        const completions = await vscode.commands.executeCommand(
          'vscode.executeCompletionItemProvider', editor.document.uri, editor.document.positionAt(memberEnd),
        );
        return (completions?.items ?? []).some((item) => (
          typeof item.label === 'string' ? item.label : item.label.label
        ) === 'yx');
      }), { message: 'native completion provider never inferred normalize(uv) as a vector', timeout: 30_000 }).toBe(true);
      await vscode.window.keyboard.press('Escape');
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('editor.action.triggerSuggest'));
      const widget = vscode.window.locator('.suggest-widget');
      await vscode.window.keyboard.type('y', { delay: 80 });
      const yx = widget.locator('.label-name').filter({ hasText: /^yx$/ }).first();
      await expect(yx, 'normalize(uv). never produced inferred vector members').toBeVisible({ timeout: 30_000 });
      await yx.click();
      await expect.poll(() => vscode.evaluateInHost(async (vscode) =>
        vscode.window.activeTextEditor?.document.getText() ?? '',
      )).toBe(savedSource);

      await vscode.window.keyboard.press('ControlOrMeta+S');
      await expect.poll(() => vscode.evaluateInHost(async (vscode, path) =>
        new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path))), shaderPath,
      )).toBe(savedSource);

      // Close and reopen the real document before asking the language service
      // for native hover UI, so this is not accidentally reading unsaved state.
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('workbench.action.closeActiveEditor'));
      await showAt(vscode, shaderPath, 2, 6);
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('editor.action.showHover'));
      const hover = vscode.window.locator('.monaco-hover-content').filter({ visible: true }).first();
      await expect(hover, 'native hover never reported the inferred normalize result').toContainText(/direct.*vec2(?:f|<f32>)/i, { timeout: 30_000 });
      await vscode.window.keyboard.press('Escape');

      await showAt(vscode, shaderPath, 10);
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('shader-studio.view'));
      let frame = await vscode.shaderFrame();
      await expect(frame.locator('.canvas-container canvas').first()).toBeVisible({ timeout: 90_000 });
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
      await enableInspector(frame);

      // Selecting the return line gives the capture planner every inferred
      // local above it. Matrix/bool-vector values stay intentionally absent,
      // while their supported component expressions remain inspectable.
      await showAt(vscode, shaderPath, 10);
      frame = await vscode.shaderFrame();
      for (const [name, type] of [
        ['bits', /vec2(?:u|<u32>)/],
        ['leading', /vec2(?:u|<u32>)/],
        ['matrixColumn', /vec3(?:f|<f32>)/],
        ['matrixScalar', /f32/],
        ['comparisonComponent', /bool/],
      ]) {
        await expect(row(frame, name), `inspector never captured inferred ${name}`).toBeVisible({ timeout: 45_000 });
        await expect(row(frame, name).locator('.var-type')).toHaveText(type);
        await expect(row(frame, name).locator('.var-value')).not.toHaveText(/^\s*$/);
      }
      await expect(row(frame, 'matrix')).toHaveCount(0);
      await expect(row(frame, 'comparison')).toHaveCount(0);
      await expect(frame.getByLabel('Show capture errors', { exact: true })).toHaveCount(0);
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
    } finally {
      await vscode.evaluateInHost(async (vscode, paths) => {
        for (const path of paths) {
          await vscode.workspace.fs.delete(vscode.Uri.file(path), { useTrash: false }).then(undefined, () => {});
        }
      }, [shaderPath, configPath]);
    }
  });
});
