import { test, expect } from '@playwright/test';

// Use Chromium's real software WebGPU adapter on headless machines.
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-dawn-features=allow_unsafe_apis'] } });

for (const shader of ['aurora-glsl', 'aurora-wgsl-wgsl']) {
  for (const format of ['MP4', 'WebM']) {
    test(`${shader} Live ${format} preserves smooth colour gradients`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId(`shader-option-${shader}`).click();
      await expect(page.getByTestId(`shader-option-${shader}`)).not.toContainText('Failed');
      const preview = page.getByTestId('web-preview').locator('canvas').first();
      await expect.poll(() => preview.evaluate(element => {
        const copy = new OffscreenCanvas(element.width, element.height);
        const context = copy.getContext('2d');
        context.drawImage(element, 0, 0);
        const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
        return pixels.some((value, index) => index % 4 !== 3 && value > 32);
      })).toBe(true);
      await page.getByLabel('Toggle export panel').click();
      await page.getByRole('button', { name: 'Video', exact: true }).click();
      await page.getByRole('button', { name: format, exact: true }).click();
      await page.getByRole('button', { name: 'Start recording', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop & save', exact: true })).toBeVisible();
      await page.waitForTimeout(1800);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Stop & save', exact: true }).click();
      const download = await downloading;
      const chunks = [];
      for await (const chunk of await download.createReadStream()) {
        chunks.push(chunk);
      }
      const quality = await page.evaluate(async ({ base64, format }) => {
        const video = document.createElement('video');
        video.src = `data:video/${format.toLowerCase()};base64,${base64}`;
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = reject;
        });
        const duration = video.duration;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        const scores = [];
        for (const time of [duration * 0.25, duration * 0.75]) {
          video.currentTime = time;
          await new Promise(resolve => {
 video.onseeked = resolve;
});
          ctx.drawImage(video, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          // Fit the shader's phase to this real captured frame; recording does
          // not reset iTime, so its start time is intentionally unspecified.
          let cc = 0, ss = 0, cs = 0, vc = 0, vs = 0;
          for (let y = 0; y < canvas.height; y += 4) {
            for (let x = 0; x < canvas.width; x += 4) {
              for (let c = 0; c < 3; c++) {
                const offset = (c === 1 ? (canvas.height - y - 0.5) / canvas.height : (x + 0.5) / canvas.width) + c * 2;
                const co = Math.cos(offset), si = Math.sin(offset);
                const value = (pixels[(y * canvas.width + x) * 4 + c] / 255 - 0.5) * 2;
                cc += co * co; ss += si * si; cs += co * si; vc += value * co; vs += value * si;
              }
            }
          }
          const phase = Math.atan2(-(vs * cc - vc * cs), vc * ss - vs * cs);
          let square = 0, count = 0;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              for (let c = 0; c < 3; c++) {
                const offset = (c === 1 ? (canvas.height - y - 0.5) / canvas.height : (x + 0.5) / canvas.width) + c * 2;
                const reference = Math.round(255 * (0.5 + 0.5 * Math.cos(phase + offset)));
                square += (pixels[(y * canvas.width + x) * 4 + c] - reference) ** 2;
                count++;
              }
            }
          }
          scores.push(10 * Math.log10(255 * 255 / (square / count)));
        }
        video.removeAttribute('src'); video.load();
        return { duration, scores, width: canvas.width, height: canvas.height };
      }, { base64: Buffer.concat(chunks).toString('base64'), format });
      expect(quality.duration).toBeGreaterThan(1);
      for (const score of quality.scores) {
        expect(score).toBeGreaterThanOrEqual(40);
      }
      if (format === 'MP4') {
        expect(quality.width % 2).toBe(0);
        expect(quality.height % 2).toBe(0);
      }
    });
  }
}
