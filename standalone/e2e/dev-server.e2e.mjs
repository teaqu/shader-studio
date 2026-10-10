import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

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
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText('xy');
});

test('keeps Export in its own panel when the viewer is hot replaced', async ({ page }) => {
  const viewerPath = new URL('../../ui/src/lib/components/ShaderViewer.svelte', import.meta.url);
  const source = await readFile(viewerPath, 'utf8');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle export panel', exact: true }).click();
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  const panel = page.locator('.recording-panel');
  const attachedToExport = () => panel.evaluate(element =>
    element.parentElement.parentElement.classList.contains('standalone-panel-content'));
  await expect.poll(attachedToExport).toBe(true);
  try {
    const updated = page.waitForEvent('console', {
      predicate: message => message.text().includes('[vite] hot updated:') && message.text().includes('ShaderViewer.svelte'),
    });
    // Trigger a genuine Svelte HMR replacement without changing behavior.
    await writeFile(viewerPath, source.replace('// DOM teleport refs', '// DOM teleport refs (HMR regression)'));
    await updated;
    expect(errors).toEqual([]);
    await expect.poll(attachedToExport).toBe(true);
    await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeVisible();
    await expect(page.locator('.no-active-shader-state')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.reload();
    await expect.poll(attachedToExport).toBe(true);
    await expect(page.getByRole('button', { name: 'Capture screenshot', exact: true })).toBeVisible();
  } finally {
    await writeFile(viewerPath, source);
  }
});
