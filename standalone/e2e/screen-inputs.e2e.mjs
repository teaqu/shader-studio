import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { workspace } from './language-service-fixtures.mjs';

for (const language of ['glsl', 'wgsl', 'slang']) {
  test(`${language} screen shares explicitly, previews, survives edits and stops`, async ({ page }) => {
    await page.addInitScript(() => {
      window.__screenStreams = [];
      window.__screenCalls = 0;
      window.__screenColor = '#00ffff';
      navigator.mediaDevices.getDisplayMedia = async constraints => {
        if (!navigator.userActivation.isActive || !constraints.video || constraints.audio !== false) {
throw new Error('Screen sharing must start from a click without audio');
}
        window.__screenCalls++;
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 120;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(0, 0, 160, 120);
        const stream = canvas.captureStream(30);
        window.__screenStreams.push(stream);
        const timer = setInterval(() => {
          ctx.fillStyle = window.__screenColor;
          ctx.fillRect(0, 0, 160, 120);
        }, 30);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
        return stream;
      };
    });
    const code = language === 'glsl'
      ? 'void mainImage(out vec4 c,in vec2 p){vec3 v=texture(screen.sampler,vec2(.5)).rgb;c=screen.loaded==1&&screen.size.x==160.&&v.g>.8&&v.b>.8?vec4(0,1,0,1):vec4(1,0,0,1);}'
      : language === 'slang'
        ? 'float4 mainImage(float2 p){float3 v=sample2DLevel(screen.texture,screen.sampler,float2(.5),0).rgb;return screen.loaded&&screen.size.x==160&&v.g>.8&&v.b>.8?float4(0,1,0,1):float4(1,0,0,1);}'
        : 'fn mainImage(p:vec2f)->vec4f{let v=sample2DLevel(screenTexture,screenSampler,vec2f(.5),0).rgb;if(screen.loaded&&screen.size.x==160&&v.g>.8&&v.b>.8){return vec4f(0,1,0,1);}return vec4f(1,0,0,1);}';
    await page.route('**/__screen_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto('/__screen_fixture__');
    await workspace(page, [
      [`shared.${language}`, code],
      ['plain.glsl', 'void mainImage(out vec4 c,in vec2 p){c=vec4(0,1,0,1);}'],
      ['shared.sha.json', JSON.stringify({ version: '1', passes: { Image: { inputs: { screen: { type: 'keyboard' } } } } })],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-shared-${language}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await page.locator('.channel-row').filter({ hasText: 'screen' }).click();
    await page.getByRole('tab', { name: 'Misc', exact: true }).click();
    await page.getByRole('button', { name: 'Screen', exact: true }).click();
    const start = page.getByRole('button', { name: 'Start screen sharing', exact: true });
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => window.__screenCalls)).toBe(0);
    await start.click();
    await expect(page.getByRole('button', { name: 'Stop screen sharing', exact: true })).toBeVisible();
    const output = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    const expectColor = async (color = [0, 255, 0]) => {
      await expect.poll(async () => {
        const url = await output.evaluate(e => e.toDataURL());
        const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
        const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
        return [...data.subarray(offset, offset + 3)];
      }).toEqual(color);
    };
    await expectColor();
    await expect(page.getByText(/Open the Screen channel and click Start sharing/)).toHaveCount(0);
    const preview = page.getByRole('button', { name: 'Screen', exact: true }).getByLabel('Live screen preview');
    await expect.poll(() => preview.evaluate(e => [...e.getContext('2d').getImageData(80, 60, 1, 1).data])).toEqual([0, 255, 255, 255]);
    await page.evaluate(() => {
 window.__screenColor = '#ffff00';
});
    await expectColor([255, 0, 0]);
    await page.evaluate(() => {
 window.__screenColor = '#00ffff';
});
    await expectColor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: '+ Add Channel', exact: true }).click();
    await page.getByRole('button', { name: /Keyboard$/ }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expectColor();
    expect(await page.evaluate(() => window.__screenCalls)).toBe(1);
    await page.locator('.channel-row').filter({ hasText: 'screen' }).click();
    await page.getByRole('button', { name: 'Stop screen sharing', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__screenStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
    await expect(start).toBeEnabled();
    await page.reload();
    await page.locator('.channel-row').filter({ hasText: 'screen' }).click();
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => window.__screenCalls)).toBe(0);
    await start.click();
    await expectColor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTestId('shader-option-plain-glsl').click();
    await expect.poll(() => page.evaluate(() => window.__screenStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  });
}

for (const language of ['glsl', 'wgsl', 'slang']) {
  test(`${language} screen sampling controls change rendered pixels`, async ({ page }) => {
    await page.addInitScript(() => {
      window.__screenCalls = 0;
      navigator.mediaDevices.getDisplayMedia = async () => {
        window.__screenCalls++;
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 120;
        const ctx = canvas.getContext('2d');
        const paint = () => {
          for (const [color, x, y] of [['#ff0000', 0, 0], ['#00ff00', 80, 0], ['#0000ff', 0, 60], ['#ffffff', 80, 60]]) {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 80, 60);
          }
        };
        paint();
        const stream = canvas.captureStream(30);
        const timer = setInterval(paint, 30);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
        return stream;
      };
    });
    // Three vertical bands probe orientation, out-of-range wrap, and a pixel edge.
    const code = language === 'glsl'
      ? 'void mainImage(out vec4 c,in vec2 p){float x=p.x/iResolution.x;vec2 uv=vec2(x<.333?.25:x<.666?1.25:.5,.25);c=vec4(texture(screen.sampler,uv).rgb,1);}'
      : language === 'slang'
        ? 'float4 mainImage(float2 p){float x=p.x/iResolution.x;float2 uv=float2(x<.333?.25:x<.666?1.25:.5,.25);return float4(sample2DLevel(screen.texture,screen.sampler,uv,0).rgb,1);}'
        : 'fn mainImage(p:vec2f)->vec4f{let x=p.x/iResolution.x;let u=select(select(.5,1.25,x<.666),.25,x<.333);return vec4f(sample2DLevel(screenTexture,screenSampler,vec2f(u,.25),0).rgb,1);}';
    await page.route('**/__screen_sampling__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto('/__screen_sampling__');
    await workspace(page, [
      [`sampling.${language}`, code],
      ['sampling.sha.json', JSON.stringify({ version: '1', passes: { Image: { inputs: { screen: { type: 'screen' } } } } })],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-sampling-${language}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await page.locator('.channel-row').filter({ hasText: 'screen' }).click();
    // Controls must use the host theme rather than the browser's native colours.
    for (const theme of [
      { background: 'rgb(45, 45, 45)', foreground: 'rgb(204, 204, 204)', border: 'rgb(60, 60, 60)' },
      { background: 'rgb(255, 255, 255)', foreground: 'rgb(32, 32, 32)', border: 'rgb(190, 190, 190)' },
    ]) {
      await page.evaluate(theme => {
        const style = document.querySelector('.misc-grid').style;
        style.setProperty('--vscode-input-background', theme.background);
        style.setProperty('--vscode-input-foreground', theme.foreground);
        style.setProperty('--vscode-input-border', theme.border);
        style.setProperty('--vscode-focusBorder', 'rgb(0, 122, 204)');
      }, theme);
      for (const label of ['Filter:', 'Wrap:']) {
        const control = page.getByLabel(label);
        await expect(control).toHaveCSS('background-color', theme.background);
        await expect(control).toHaveCSS('color', theme.foreground);
        await control.blur();
        await expect(control).toHaveCSS('border-top-color', theme.border);
        await control.focus();
        await expect(control).toHaveCSS('border-top-color', 'rgb(0, 122, 204)');
      }
    }
    await page.locator('.misc-grid').evaluate(e => e.removeAttribute('style'));
    await page.getByRole('button', { name: 'Start screen sharing', exact: true }).click();
    const output = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    const pixels = async () => {
      const url = await output.evaluate(e => e.toDataURL());
      const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
      return [.16, .5, .83].map(x => {
        const offset = (Math.floor(height / 2) * width + Math.floor(width * x)) * 4;
        return [...data.subarray(offset, offset + 3)].map(v => Math.round(v / 16) * 16);
      });
    };
    const flip = page.getByLabel('Flip vertically');
    // Quantization allows video colour conversion rounding but preserves each effect.
    await expect.poll(pixels).toEqual([[0, 0, 256], [256, 256, 256], [128, 128, 256]]);
    await flip.uncheck();
    await expect.poll(pixels).toEqual([[256, 0, 0], [0, 256, 0], [128, 128, 0]]);
    await page.getByLabel('Wrap:').selectOption('repeat');
    await expect.poll(pixels).toEqual([[256, 0, 0], [256, 0, 0], [128, 128, 0]]);
    await page.getByLabel('Filter:').selectOption('nearest');
    await expect.poll(pixels).toEqual([[256, 0, 0], [256, 0, 0], [0, 256, 0]]);
    expect(await page.evaluate(() => window.__screenCalls)).toBe(1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.channel-row').filter({ hasText: 'screen' }).click();
    await expect(page.getByLabel('Filter:')).toHaveValue('nearest');
    await expect(page.getByLabel('Wrap:')).toHaveValue('repeat');
    await expect(flip).not.toBeChecked();
  });
}
