import { expect, test } from '@playwright/test';

// Headless Chromium needs this flag to expose a WebGPU adapter for Slang.
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu'] } });

test.describe('renderer diagnostics', () => {
  for (const language of ['glsl', 'slang']) {
    for (const separate of [false, true]) {
      test(`${language} renderer compile errors appear and clear in the ${separate ? 'separate' : 'main'} editor`, async ({ page }) => {
        await page.goto('/');
        await page.getByTestId(language === 'glsl' ? 'shader-option-aurora-glsl' : 'shader-option-aurora-slang-slang').click();
        if (separate) {
          await page.getByRole('button', { name: 'Open in separate editor' }).click();
        }
        const editor = separate ? page.getByTestId('file-editor') : page.getByTestId('web-editor');
        const valid = language === 'glsl'
          ? 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }'
          : 'float4 mainImage(float2 coord) { return float4(1.0); }';
        const broken = '#error standalone_compile_regression\n' + valid;
        await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.insertText(broken);
        const status = page.getByTestId('web-preview').getByLabel('Toggle pause');
        await expect(status).toHaveClass(/error/);
        const markers = editor.locator('[data-marker-count]');
        await expect(markers).not.toHaveAttribute('data-marker-count', '0');
        await expect(editor.locator('.squiggly-error').first()).toBeVisible();
        await page.reload();
        await expect(editor.locator('.view-lines')).toContainText('standalone_compile_regression');
        await expect(markers).not.toHaveAttribute('data-marker-count', '0');
        await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.insertText(valid);
        await expect(status).not.toHaveClass(/error/);
        await expect(markers).toHaveAttribute('data-marker-count', '0');
        await expect(editor.locator('.squiggly-error')).toHaveCount(0);
      });
    }
  }
});
