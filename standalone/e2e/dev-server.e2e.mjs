import { expect, test } from '@playwright/test';

// The dev server serves the language-service worker unbundled, so it only runs
// when the worker keeps its own origin: a module worker copied into a blob URL
// cannot resolve its imports and dies before answering a single request.
test('answers language-service requests against the dev server', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  const input = editor.locator('.inputarea');
  await editor.locator('.view-lines').click();
  await input.press('ControlOrMeta+A');
  const source = [
    'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
    '  vec2 uv = fragCoord / iResolution.xy;',
    '  ',
    '  fragColor = vec4(uv, 0.0, 1.0);',
    '}',
  ].join('\n');
  // Paste the complete document so Monaco does not auto-close the opening
  // brace and leave this language-service fixture with a second trailing `}`.
  await page.evaluate(text => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData, bubbles: true, cancelable: true,
    }));
  }, source);
  await editor.locator('.view-lines .view-line').nth(2).click();
  await input.press('End');

  await page.keyboard.type('uv.', { delay: 100 });

  const suggestions = page.locator('.suggest-widget:visible');
  // The worker is served unbundled here, so it can still be loading when the
  // selector is typed. Monaco closes a session that had nothing to show and
  // does not reopen it by itself, so retype the selector until the service
  // answers rather than waiting on a session that has already gone.
  await expect.poll(async () => {
    if (await suggestions.isVisible()) {
      return true;
    }
    await input.press('Backspace');
    await page.keyboard.type('.', { delay: 100 });
    return suggestions.isVisible();
  }, { message: 'the dev-server language service never offered completions', timeout: 60_000 }).toBe(true);
  await expect(suggestions).toContainText('xy');
});
