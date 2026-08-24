import assert from 'node:assert/strict';
import { join } from 'node:path';

const workspacePath = process.env.SHADER_STUDIO_E2E_WORKSPACE;
const shaderPath = join(workspacePath, 'overlay-language-service.slang');

let shaderStudioWebview;

async function setSlangLanguageServerEnabled(enabled) {
  await shaderStudioWebview.close();
  await browser.executeWorkbench(async (vscode, nextEnabled) => {
    await vscode.workspace.getConfiguration('shader-studio').update(
      'languageServers.slang.enabled',
      nextEnabled,
      vscode.ConfigurationTarget.Global,
    );
  }, enabled);
  await browser.pause(500);
  await shaderStudioWebview.open();
  await $('.editor-overlay .monaco-editor').waitForDisplayed({ timeout: 30_000 });
}

async function tokenElement(text) {
  const spans = await $$('.editor-overlay .view-line span span');
  for (const span of spans) {
    if ((await span.getText()).trim() === text) {
      return span;
    }
  }
  throw new Error(`Could not find Monaco token ${JSON.stringify(text)}`);
}

async function hoverTextForToken(text, expected) {
  await browser.keys(['Escape']);
  const token = await tokenElement(text);
  await token.moveTo();
  const hover = await $('.editor-overlay .monaco-hover-content');
  await hover.waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: `Monaco did not show hover content for ${text}`,
  });
  await browser.waitUntil(async () => expected.test(await hover.getText()), {
    timeout: 30_000,
    timeoutMsg: `Monaco hover for ${text} did not contain ${expected}`,
  });
  return hover.getText();
}

describe('Shader language servers in the Monaco overlay', () => {
  before(async () => {
    assert.ok(workspacePath, 'SHADER_STUDIO_E2E_WORKSPACE was not configured');
    await browser.executeWorkbench(async (vscode, targetPath) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        'languageServers.slang.enabled',
        true,
        vscode.ConfigurationTarget.Global,
      );
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: false,
      });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    const workbench = await browser.getWorkbench();
    shaderStudioWebview = await workbench.getWebviewByTitle('Shader Studio');
    await browser.pause(1_000);
    await shaderStudioWebview.open();
    await $('.canvas-container').waitForExist({ timeout: 60_000 });
    await browser.execute(() => {
      window.__shaderStudioOverlayErrors = [];
      window.addEventListener('error', (event) => {
        window.__shaderStudioOverlayErrors.push(`error: ${event.message} (${event.filename}:${event.lineno})`);
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__shaderStudioOverlayErrors.push(`rejection: ${String(event.reason?.stack ?? event.reason)}`);
      });
    });
    const overlayAlreadyVisible = await $('.editor-overlay .monaco-editor').isDisplayed();

    await shaderStudioWebview.close();
    if (!overlayAlreadyVisible) {
      await browser.executeWorkbench(async (vscode) => {
        await vscode.commands.executeCommand('shader-studio.toggleEditorOverlay');
      });
    }
    await browser.pause(500);
    await shaderStudioWebview.open();
    await $('.editor-overlay .monaco-editor').waitForDisplayed({ timeout: 30_000 });
  });

  after(async () => {
    try {
      await shaderStudioWebview?.close();
      await browser.executeWorkbench(async (vscode) => {
        await vscode.workspace.getConfiguration('shader-studio').update(
          'languageServers.slang.enabled',
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      });
    } catch {
      // The extension host can replace the iframe while closing the panel.
    }
  });

  it('shows documented Slang hover content', async () => {
    let hover;
    try {
      hover = await hoverTextForToken('fmod', /remainder/i);
    } catch (error) {
      const diagnostics = await browser.execute(() => ({
        errors: window.__shaderStudioOverlayErrors ?? [],
        resources: performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => /languageService|slang-wasm/i.test(name)),
      }));
      throw new Error(`${error.message}\nOverlay diagnostics: ${JSON.stringify(diagnostics, null, 2)}`);
    }
    assert.match(hover, /remainder/i);
  });

  it('shows renderer Slang compiler diagnostics when the language server is disabled', async () => {
    await setSlangLanguageServerEnabled(false);
    const marker = await $('.editor-overlay .squiggly-error');
    try {
      await marker.waitForExist({
        timeout: 30_000,
        timeoutMsg: 'Monaco did not render the Shader Studio Slang compiler marker',
      });
    } catch (error) {
      const diagnostics = await browser.execute(() => {
        const overlay = document.querySelector('.editor-overlay');
        return {
          rendererError: document.querySelector('.error-tooltip-content')?.textContent?.trim() ?? null,
          pauseHasError: document.querySelector('button[aria-label="Toggle pause"]')?.classList.contains('error'),
          overlayText: overlay?.textContent?.slice(0, 300) ?? null,
          // Which buffer the marker parser filters against: a mismatch with the
          // "Image:" prefix on the renderer error drops every marker silently.
          activeBuffer: overlay?.getAttribute('data-active-buffer') ?? null,
          // Marker rendering: any severity, not just error.
          squigglyClasses: Array.from(
            document.querySelectorAll('.editor-overlay [class*="squiggly"]'),
            (element) => element.className,
          ).slice(0, 10),
          viewLines: document.querySelectorAll('.editor-overlay .view-line').length,
          editorReady: document.querySelector('.editor-wrapper')?.classList.contains('ready') ?? null,
          // Did the Slang toolchain actually load in this webview?
          slangResources: performance.getEntriesByType('resource')
            .map((entry) => entry.name.split('/').pop())
            .filter((name) => /languageService|slang|wasm/i.test(name))
            .slice(0, 10),
          overlayErrors: window.__shaderStudioOverlayErrors ?? [],
        };
      });
      throw new Error(`${error.message}\nRenderer diagnostics: ${JSON.stringify(diagnostics, null, 2)}`);
    }
    const hover = await hoverTextForToken('unknownValue', /undefined identifier/i);
    assert.match(hover, /undefined identifier/i);
  });
});
