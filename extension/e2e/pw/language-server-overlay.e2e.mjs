import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'overlay-language-service.slang');

function helpers(vscode) {
  let frame;
  const app = () => frame;

  const refreshFrame = async () => { frame = await vscode.shaderFrame(); return frame; };

  const overlayReady = () => expect.poll(
    () => app().locator('.editor-overlay .monaco-editor').count(),
    { message: 'Monaco overlay never rendered', timeout: 30_000 },
  ).toBeGreaterThan(0);

  async function setSlangLanguageServerEnabled(enabled) {
    await vscode.evaluateInHost(async (vscode, nextEnabled) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        'languageServers.slang.enabled', nextEnabled, vscode.ConfigurationTarget.Global,
      );
    }, enabled);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await refreshFrame();
    await overlayReady();
  }

  /** Monaco splits a line into nested spans; match the exact token text. */
  const token = (text) => app()
    .locator('.editor-overlay .view-line span span')
    .filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .first();

  async function hoverTextForToken(text, expected) {
    await app().locator('body').press('Escape').catch(() => { /* nothing focused */ });
    await token(text).hover({ timeout: 30_000 });
    const hover = app().locator('.editor-overlay .monaco-hover-content').first();
    await expect.poll(async () => (await hover.count()) ? hover.innerText() : '', {
      message: `Monaco hover for ${text} did not contain ${expected}`,
      timeout: 30_000,
    }).toMatch(expected);
    return hover.innerText();
  }

  return { app, refreshFrame, overlayReady, setSlangLanguageServerEnabled, hoverTextForToken };
}

test.use({ vscodeKey: 'language-server-overlay' });

test.describe('Shader language servers in the Monaco overlay', () => {
  /** @type {ReturnType<typeof helpers>} */
  let h;

  test.beforeAll(async ({ vscode }) => {
    h = helpers(vscode);

    await vscode.evaluateInHost(async (vscode, targetPath) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        'languageServers.slang.enabled', true, vscode.ConfigurationTarget.Global,
      );
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    await h.refreshFrame();

    const overlayVisible = await h.app().locator('.editor-overlay .monaco-editor').count();
    if (!overlayVisible) {
      await vscode.evaluateInHost(async (vscode) => {
        await vscode.commands.executeCommand('shader-studio.toggleEditorOverlay');
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await h.refreshFrame();
    }
    await h.overlayReady();
  });

  test.afterAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        'languageServers.slang.enabled', undefined, vscode.ConfigurationTarget.Global,
      );
    }).catch(() => { /* the host may already be going away */ });
  });

  test('shows documented Slang hover content', async () => {
    const hover = await h.hoverTextForToken('fmod', /remainder/i);
    expect(hover).toMatch(/remainder/i);
  });

  test('shows renderer Slang compiler diagnostics when the language server is disabled', async () => {
    await h.setSlangLanguageServerEnabled(false);

    await expect.poll(async () => {
      const marker = await h.app().locator('.editor-overlay .squiggly-error').count();
      if (marker) return 'marker';
      return h.app().evaluate(() => JSON.stringify({
        rendererError: document.querySelector('.error-tooltip-content')?.textContent?.trim() ?? null,
        activeBuffer: document.querySelector('.editor-overlay')?.getAttribute('data-active-buffer') ?? null,
        markerUpdates: document.querySelector('.editor-overlay')?.getAttribute('data-marker-updates') ?? null,
        markerCount: document.querySelector('.editor-overlay')?.getAttribute('data-marker-count') ?? null,
        errorsCount: document.querySelector('.editor-overlay')?.getAttribute('data-errors-count') ?? null,
      }));
    }, { message: 'Monaco did not render the Shader Studio Slang compiler marker', timeout: 30_000 })
      .toBe('marker');

    const hover = await h.hoverTextForToken('unknownValue', /undefined identifier/i);
    expect(hover).toMatch(/undefined identifier/i);
  });
});
