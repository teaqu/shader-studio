import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const fixturePath = join(workspacePath, 'language-servers');

test.use({ vscodeKey: 'language-server-settings' });

test.describe('Shader language servers settings in VS Code', () => {
  test('honours independent GLSL and Slang enable settings after both servers are loaded', async ({ vscode }) => {
    expect(workspacePath, 'SHADER_STUDIO_E2E_WORKSPACE was not configured').toBeTruthy();
    const result = await vscode.evaluateInHost(async (vscode, glslPath, slangPath) => {
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
      try {
        const glslInitiallyEnabled = await hasIntrinsic(glslPath);
        const slangInitiallyEnabled = await hasIntrinsic(slangPath);
        await configuration.update('languageServers.glsl.enabled', false, vscode.ConfigurationTarget.Global);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const glslDisabled = await hasIntrinsic(glslPath);
        const slangWhileGlslDisabled = await hasIntrinsic(slangPath);
        await configuration.update('languageServers.glsl.enabled', true, vscode.ConfigurationTarget.Global);
        await configuration.update('languageServers.slang.enabled', false, vscode.ConfigurationTarget.Global);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const slangDisabled = await hasIntrinsic(slangPath);
        const glslWhileSlangDisabled = await hasIntrinsic(glslPath);
        return {
          glslInitiallyEnabled,
          slangInitiallyEnabled,
          glslDisabled,
          slangWhileGlslDisabled,
          slangDisabled,
          glslWhileSlangDisabled,
        };
      } finally {
        await configuration.update('languageServers.glsl.enabled', undefined, vscode.ConfigurationTarget.Global);
        await configuration.update('languageServers.slang.enabled', undefined, vscode.ConfigurationTarget.Global);
      }
    }, join(fixturePath, 'image.glsl'), join(fixturePath, 'image.slang'));

    expect(result).toEqual({
      glslInitiallyEnabled: true,
      slangInitiallyEnabled: true,
      glslDisabled: false,
      slangWhileGlslDisabled: true,
      slangDisabled: false,
      glslWhileSlangDisabled: true,
    });
  });
});
