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
  await page.keyboard.insertText([
    'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
    '  vec2 uv = fragCoord / iResolution.xy;',
    '  ',
    '  fragColor = vec4(uv, 0.0, 1.0);',
    '}',
  ].join('\n'));
  await editor.locator('.view-lines .view-line').nth(2).click();
  await input.press('End');

  await page.keyboard.type('uv.', { delay: 100 });

  const suggestions = page.locator('.suggest-widget:visible');
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText('xy');
});
