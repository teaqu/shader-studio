import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

/**
 * This deliberately drives VS Code's own suggest widget instead of calling
 * vscode.executeCompletionItemProvider. The latter cannot prove that Monaco
 * filters a member completion's replacement range while a user types it.
 */
const scenarios = [
  {
    language: 'GLSL',
    extension: 'glsl',
    source: `void mainImage(out vec4 color, in vec2 pixelPosition) {
  vec4 literalColor = vec4(0.2, 0.4, 0.6, 1.0);
  color = literalColor;
}
`,
    accepted: '  color = literalColor.bgra;\n',
  },
  {
    language: 'Slang',
    extension: 'slang',
    source: `float4 mainImage(float2 pixelPosition) {
  float4 literalColor = float4(0.2, 0.4, 0.6, 1.0);
  return literalColor;
}
`,
    accepted: '  return literalColor.bgra;\n',
  },
  {
    language: 'WGSL',
    extension: 'wgsl',
    source: `fn mainImage(pixelPosition: vec2f) -> vec4f {
  let literalColor = vec4f(0.2, 0.4, 0.6, 1.0);
  return literalColor;
}
`,
    accepted: '  return literalColor.bgra;\n',
  },
];

test.use({ vscodeKey: 'swizzle-completion' });

test.describe('native vector swizzle completion', () => {
  test.beforeAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
    });
  });

  for (const scenario of scenarios) {
    // Compiling the preview is part of the assertion, so the WebGPU languages
    // belong on the GPU runner.
    test(`${scenario.language} replaces a typed swizzle prefix and compiles the preview${scenario.extension === 'glsl' ? '' : ' @gpu'}`, async ({ vscode }) => {
      const stem = `swizzle-native-${scenario.extension}`;
      const shaderPath = join(workspacePath, `${stem}.${scenario.extension}`);
      const configPath = join(workspacePath, `${stem}.sha.json`);
      const expectedSource = scenario.source.replace('literalColor;\n', 'literalColor.bgra;\n');

      try {
        await vscode.evaluateInHost(async (vscode, paths, source) => {
          await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.config), Buffer.from(JSON.stringify({
            version: '1.0',
            passes: { Image: { path: `./${paths.name}` } },
          }, null, 2), 'utf8'));
          await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.shader), Buffer.from(source, 'utf8'));
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(paths.shader));
          const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
          const offset = document.getText().lastIndexOf('literalColor') + 'literalColor'.length;
          const position = document.positionAt(offset);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position));
        }, { shader: shaderPath, config: configPath, name: `${stem}.${scenario.extension}` }, scenario.source);

        await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'));
        const widget = vscode.window.locator('.suggest-widget');
        await vscode.window.keyboard.type('.');
        await expect.poll(() => vscode.evaluateInHost(async (vscode) =>
          vscode.window.activeTextEditor?.document.getText() ?? '',
        ), { message: 'the typed member selector never reached the native editor' }).toContain('literalColor.;');
        await expect.poll(() => vscode.evaluateInHost(async (vscode) => {
          const editor = vscode.window.activeTextEditor;
          const text = editor.document.getText();
          const memberEnd = text.lastIndexOf('literalColor.') + 'literalColor.'.length;
          const completions = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider', editor.document.uri, editor.document.positionAt(memberEnd),
          );
          const preferred = new Set(['x', 'y', 'z', 'w', 'xy']);
          return (completions?.items ?? [])
            .map((item) => ({ label: typeof item.label === 'string' ? item.label : item.label.label, sortText: item.sortText }))
            .filter((item) => preferred.has(item.label) && item.sortText)
            .sort((a, b) => a.sortText.localeCompare(b.sortText))
            .map((item) => item.label);
        }), { message: 'native completion provider never returned ranked swizzles', timeout: 30_000 })
          .toEqual(['x', 'y', 'z', 'w', 'xy']);
        await vscode.window.keyboard.press('Escape');
        await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('editor.action.triggerSuggest'));
        await expect(widget, 'typing a dot should promptly open VS Code member suggestions').toBeVisible({ timeout: 30_000 });
        await vscode.window.keyboard.type('bgra', { delay: 80 });
        const swizzle = widget.locator('.label-name').filter({ hasText: /^bgra$/ }).first();
        await expect(swizzle, 'the native suggestion list should retain reordered colour swizzles after prefix filtering')
          .toBeVisible({ timeout: 30_000 });

        // Selecting the actual Monaco row exercises its completion acceptance
        // path, including replacing the already typed `b` rather than inserting
        // a duplicate prefix.
        await swizzle.click();
        await expect.poll(() => vscode.evaluateInHost(async (vscode) =>
          vscode.window.activeTextEditor?.document.getText() ?? '',
        )).toBe(expectedSource);
        expect(expectedSource).toContain(scenario.accepted);

        await vscode.window.keyboard.press('ControlOrMeta+S');
        await expect.poll(() => vscode.evaluateInHost(async (vscode, path) =>
          new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path))), shaderPath,
        )).toBe(expectedSource);

        await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('shader-studio.view'));
        const frame = await vscode.shaderFrame();
        await expect(frame.locator('.canvas-container canvas').first(), `${scenario.language} preview never appeared after accepting bgra`)
          .toBeVisible({ timeout: 90_000 });
        await expect(frame.locator('[aria-label="Toggle pause"]').first(), `${scenario.language} preview reported a compile error`)
          .not.toHaveClass(/error/);
      } finally {
        await vscode.evaluateInHost(async (vscode, paths) => {
          const shaderUri = vscode.Uri.file(paths[0]);
          const shader = vscode.workspace.textDocuments.find((document) => document.uri.toString() === shaderUri.toString());
          if (shader) {
            await vscode.window.showTextDocument(shader, { preview: false, preserveFocus: false });
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
          }
          for (const path of paths) {
            await vscode.workspace.fs.delete(vscode.Uri.file(path), { useTrash: false }).then(undefined, () => {});
          }
        }, [shaderPath, configPath]);
      }
    });
  }
});
