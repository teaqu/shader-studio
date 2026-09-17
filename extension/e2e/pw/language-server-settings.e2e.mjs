import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const fixturePath = join(workspacePath, 'language-servers');

test.use({ vscodeKey: 'language-server-settings' });

test.describe('Shader language servers settings in VS Code', () => {
  test('honours independent GLSL, Slang, and WGSL enable settings after every server is loaded', async ({ vscode }) => {
    expect(workspacePath, 'SHADER_STUDIO_E2E_WORKSPACE was not configured').toBeTruthy();
    const result = await vscode.evaluateInHost(async (vscode, paths) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
      const configuration = vscode.workspace.getConfiguration('shader-studio');
      const hasIntrinsic = async (filePath) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const completions = await vscode.commands.executeCommand(
          'vscode.executeCompletionItemProvider',
          document.uri,
          new vscode.Position(0, 0),
        );
        return (completions?.items ?? []).some((item) => {
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          return label === 'iTimeDelta';
        });
      };
      const languages = Object.keys(paths);
      const snapshot = async () => Object.fromEntries(
        await Promise.all(languages.map(async (language) => [language, await hasIntrinsic(paths[language])])),
      );
      const results = {};
      try {
        results.initial = await snapshot();
        for (const disabled of languages) {
          for (const language of languages) {
            await configuration.update(`languageServers.${language}.enabled`, language === disabled ? false : true, vscode.ConfigurationTarget.Global);
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          results[`${disabled}Disabled`] = await snapshot();
        }
        return results;
      } finally {
        for (const language of languages) {
          await configuration.update(`languageServers.${language}.enabled`, undefined, vscode.ConfigurationTarget.Global);
        }
      }
    }, {
      glsl: join(fixturePath, 'image.glsl'),
      slang: join(fixturePath, 'image.slang'),
      wgsl: join(fixturePath, 'wgsl', 'image.wgsl'),
    });

    expect(result).toEqual({
      initial: { glsl: true, slang: true, wgsl: true },
      glslDisabled: { glsl: false, slang: true, wgsl: true },
      slangDisabled: { glsl: true, slang: false, wgsl: true },
      wgslDisabled: { glsl: true, slang: true, wgsl: false },
    });
  });
});
