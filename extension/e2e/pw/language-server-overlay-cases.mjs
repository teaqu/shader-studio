import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { openEditorOverlay } from './editor-overlay.mjs';

const scenarios = {
  slang: {
    label: 'Slang',
    shaderPath: join(workspacePath, 'overlay-language-service.slang'),
    intrinsic: 'fmod',
    intrinsicDoc: /remainder/i,
    serviceDiagnostic: /undefined identifier/i,
    compilerDiagnostic: /undefined identifier/i,
  },
  wgsl: {
    label: 'WGSL',
    shaderPath: join(workspacePath, 'overlay-language-service-wgsl.wgsl'),
    intrinsic: 'fract',
    intrinsicDoc: /fraction/i,
    serviceDiagnostic: /undefined identifier/i,
    // Tint names the same failure differently from the language service.
    compilerDiagnostic: /unresolved (?:value|identifier)|undefined identifier/i,
  },
};

function helpers(vscode, settingKey) {
  let frame;
  const app = () => frame;

  const refreshFrame = async () => {
    frame = await vscode.shaderFrame(); return frame;
  };

  const overlayReady = () => expect.poll(
    () => app().locator('.editor-overlay .monaco-editor').count(),
    { message: 'Monaco overlay never rendered', timeout: 30_000 },
  ).toBeGreaterThan(0);

  async function setLanguageServerEnabled(enabled) {
    await vscode.evaluateInHost(async (vscode, nextEnabled, key) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        key, nextEnabled, vscode.ConfigurationTarget.Global,
      );
    }, enabled, settingKey);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await refreshFrame();
    await overlayReady();
  }

  /**
   * Monaco merges adjacent tokens that share a colour into one span, so a token
   * is not addressable as an element of its own - `unknownValue` is rendered
   * inside the span `unknownValue + remainder`. Measure the substring with a
   * DOM range and return the span plus the token's centre within it.
   */
  async function tokenTarget(text) {
    const span = app()
      .locator('.editor-overlay .view-line span span')
      .filter({ hasText: text })
      .first();
    await span.waitFor({ state: 'visible', timeout: 30_000 });
    const position = await span.evaluate((element, needle) => {
      const node = Array.from(element.childNodes).find(
        (candidate) => candidate.nodeType === Node.TEXT_NODE && candidate.textContent?.includes(needle),
      );
      const index = node ? (node.textContent ?? '').indexOf(needle) : -1;
      if (index < 0) {
        return null;
      }
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const token = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { x: token.left - box.left + token.width / 2, y: token.top - box.top + token.height / 2 };
    }, text);
    if (!position) {
      throw new Error(`token ${text} was not found in the overlay`);
    }
    return { span, position };
  }

  async function hoverTextForToken(text, expected) {
    await app().locator('body').press('Escape').catch(() => { /* nothing focused */ });
    const { span, position } = await tokenTarget(text);
    await span.hover({ position, timeout: 30_000 });
    const hover = app().locator('.editor-overlay .monaco-hover-content').first();
    await expect.poll(async () => (await hover.count()) ? hover.innerText() : '', {
      message: `Monaco hover for ${text} did not contain ${expected}`,
      timeout: 30_000,
    }).toMatch(expected);
    return hover.innerText();
  }

  return { app, refreshFrame, overlayReady, setLanguageServerEnabled, hoverTextForToken, tokenTarget };
}

export function registerLanguageServerOverlayTests(language) {
  const scenario = scenarios[language];
  const settingKey = `languageServers.${language}.enabled`;

  test.use({ vscodeKey: `language-server-overlay-${language}` });

  test.describe(`${scenario.label} language server in the Monaco overlay`, () => {
    /** @type {ReturnType<typeof helpers>} */
    let h;

    test.beforeAll(async ({ vscode }) => {
      h = helpers(vscode, settingKey);

      await vscode.evaluateInHost(async (vscode, targetPath, key) => {
        await vscode.workspace.getConfiguration('shader-studio').update(
          key, true, vscode.ConfigurationTarget.Global,
        );
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
        });
        await vscode.commands.executeCommand('shader-studio.view');
      }, scenario.shaderPath, settingKey);

      await openEditorOverlay(vscode);
      await h.refreshFrame();
      await h.overlayReady();
    });

    test.afterAll(async ({ vscode }) => {
      await vscode.evaluateInHost(async (vscode, key) => {
        await vscode.workspace.getConfiguration('shader-studio').update(
          key, undefined, vscode.ConfigurationTarget.Global,
        );
      }, settingKey).catch(() => { /* the host may already be going away */ });
    });

    test(`shows documented ${scenario.label} hover content`, async () => {
      const hover = await h.hoverTextForToken(scenario.intrinsic, scenario.intrinsicDoc);
      expect(hover).toMatch(scenario.intrinsicDoc);
    });

    test(`shows renderer ${scenario.label} compiler diagnostics when the language server is disabled`, async () => {
      await h.setLanguageServerEnabled(false);

      await expect.poll(async () => {
        const marker = await h.app().locator('.editor-overlay .squiggly-error').count();
        if (marker) {
          return 'marker';
        }
        return h.app().evaluate(() => JSON.stringify({
          rendererError: document.querySelector('.error-tooltip-content')?.textContent?.trim() ?? null,
          activeBuffer: document.querySelector('.editor-overlay')?.getAttribute('data-active-buffer') ?? null,
          markerUpdates: document.querySelector('.editor-overlay')?.getAttribute('data-marker-updates') ?? null,
          markerCount: document.querySelector('.editor-overlay')?.getAttribute('data-marker-count') ?? null,
          errorsCount: document.querySelector('.editor-overlay')?.getAttribute('data-errors-count') ?? null,
        }));
      }, { message: `Monaco did not render the Shader Studio ${scenario.label} compiler marker`, timeout: 30_000 })
        .toBe('marker');

      const hover = await h.hoverTextForToken('unknownValue', scenario.compilerDiagnostic);
      expect(hover).toMatch(scenario.compilerDiagnostic);
    });

    test('reports a shared diagnostic once when the language server and the compiler agree', async () => {
      await h.setLanguageServerEnabled(true);

      // Both the language service and the renderer compile flag `unknownValue`;
      // arbitration keeps one report (Slang keeps the service's, WGSL the
      // renderer's), so the hover must list it exactly once.
      const either = new RegExp(`${scenario.serviceDiagnostic.source}|${scenario.compilerDiagnostic.source}`, 'i');
      const hover = await h.hoverTextForToken('unknownValue', either);
      const reports = hover.match(new RegExp(either.source, 'gi')) ?? [];
      expect(reports.length, `hover listed the diagnostic ${reports.length} times:\n${hover}`).toBe(1);
    });

    // Last in the file on purpose: this is the only test that edits the buffer,
    // and leaving the typed line behind cannot disturb the tests above.
    test('opens the completion dropdown while typing', async () => {
      await h.setLanguageServerEnabled(true);

      // Open a fresh line inside mainImage and type a prefix. `iResolution` is a
      // Shader Studio built-in the language service merges into every non-member
      // completion, and it appears nowhere in this shader's text - so Monaco's
      // word-based suggestions cannot produce it and a hit proves the language
      // service reached the widget.
      // Clicking places the cursor; keys then go through the editor's own input
      // element so they land in the webview rather than the editor behind it.
      const cursor = await h.tokenTarget('remainder');
      await cursor.span.click({ position: cursor.position, timeout: 30_000 });
      const input = h.app().locator('.editor-overlay textarea.inputarea').first();
      await input.press('End');
      await input.press('Enter');
      await input.pressSequentially('iResol', { delay: 120 });

      const suggestion = h.app().locator('.suggest-widget .monaco-list-row')
        .filter({ hasText: /^iResolution/ })
        .first();
      await expect(suggestion).toBeVisible({ timeout: 30_000 });

      await input.press('Escape');
    });
  });
}
