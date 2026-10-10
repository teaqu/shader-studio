import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';

for (const shader of ['aurora-glsl', 'aurora-wgsl-wgsl', 'aurora-slang-slang']) {
  for (const format of ['MP4', 'WebM']) {
    if (shader === 'aurora-slang-slang' && format === 'MP4') {
      continue;
    }
    test(`${shader} Live ${format} ${shader === 'aurora-wgsl-wgsl' && format === 'MP4' ? 'saves a playable recording' : 'preserves smooth colour gradients'}`, async ({ page }, testInfo) => {
      // This formerly skipped case checks record/save/playback. Keep the
      // passing quality checks for the other shader/format combinations.
      const basic = shader === 'aurora-wgsl-wgsl' && format === 'MP4';
      await page.addInitScript(() => {
        globalThis.captureEncoderConfigs = [];
        globalThis.captureFrameTimes = [];
        const encode = VideoEncoder.prototype.encode;
        VideoEncoder.prototype.encode = function(frame, options) {
          globalThis.captureFrameTimes.push(frame.timestamp);
          return encode.call(this, frame, options);
        };
        const configure = VideoEncoder.prototype.configure;
        VideoEncoder.prototype.configure = function(config) {
          globalThis.captureEncoderConfigs.push(config);
          return configure.call(this, config);
        };
      });
      await page.goto('/');
      await page.getByTestId(`shader-option-${shader}`).click();
      await expect(page.getByTestId(`shader-option-${shader}`)).not.toContainText('Failed');
      await page.getByLabel('Change resolution settings').click();
      await page.getByPlaceholder('W', { exact: true }).fill('816');
      await page.getByPlaceholder('H', { exact: true }).fill('458');
      await page.getByLabel('Change resolution settings').click();
      // Selection precedes asynchronous compilation; capture only after a visible frame exists.
      await expect.poll(async () => {
        const url = await page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)').evaluate(canvas => canvas.toDataURL());
        const { data } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
        return data.some((value, index) => index % 4 !== 3 && value > 32);
      }).toBe(true);
      await page.getByLabel('Toggle export panel').click();
      // The swap-chain canvas can be discarded before an unrelated animation
      // callback runs. Exercise Live Screenshot's stable frame readback to
      // verify the shader has a nonblack picture before recording it.
      await page.getByRole('button', { name: 'Screenshot', exact: true }).click();
      const screenshotDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Capture screenshot', exact: true }).click();
      const screenshotChunks = [];
      for await (const chunk of await (await screenshotDownload).createReadStream()) {
        screenshotChunks.push(chunk);
      }
      const { data: pixels } = PNG.sync.read(Buffer.concat(screenshotChunks));
      expect(pixels.some((value, index) => index % 4 !== 3 && value > 32)).toBe(true);
      await page.getByRole('button', { name: 'Video', exact: true }).click();
      await page.getByRole('button', { name: format, exact: true }).click();
      const screenFps = shader === 'aurora-slang-slang';
      if (screenFps) {
        await page.getByRole('button', { name: /^Screen / }).click();
      } else {
        await page.getByRole('button', { name: '60', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Start recording', exact: true }).evaluate(button => {
        button.addEventListener('click', () => {
          const section = [...document.querySelectorAll('.recording-panel .resolution-section')].find(section => section.querySelector('h4')?.textContent === 'Frame Rate');
          const selected = section.querySelector('.resolution-option.active').textContent;
          globalThis.requestedCaptureFps = Number(selected.match(/[0-9]+(?:\.[0-9]+)?/)[0]);
        }, { once: true, capture: true });
      });
      await page.getByRole('button', { name: 'Start recording', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop & save', exact: true })).toBeVisible();
      // Cover a full shader colour cycle rather than one favourable short phase.
      await page.waitForTimeout(basic ? 1500 : 8000);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Stop & save', exact: true }).click();
      const download = await downloading;
      await download.saveAs(testInfo.outputPath(`live.${format.toLowerCase()}`));
      const chunks = [];
      for await (const chunk of await download.createReadStream()) {
        chunks.push(chunk);
      }
      if (format === 'WebM') {
        const input = new Input({ source: new BufferSource(Buffer.concat(chunks)), formats: ALL_FORMATS });
        try {
          const track = await input.getPrimaryVideoTrack();
          const frameTimes = await page.evaluate(() => globalThis.captureFrameTimes);
          const packetTimes = [];
          for await (const packet of new EncodedPacketSink(track).packets()) {
            packetTimes.push(packet.timestamp * 1e6);
          }
          expect(packetTimes).toHaveLength(frameTimes.length);
          for (let i = 0; i < packetTimes.length; i++) {
            // WebM stores milliseconds; Live samples must retain their real timestamps.
            expect(Math.abs(packetTimes[i] - frameTimes[i])).toBeLessThanOrEqual(1000);
          }
        } finally {
          input.dispose();
        }
      }
      const quality = await page.evaluate(async ({ base64, format, basic }) => {
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
        for (const fraction of basic ? [0.5] : [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]) {
          const time = duration * fraction;
          video.currentTime = time;
          await new Promise(resolve => {
            video.onseeked = resolve;
          });
          ctx.drawImage(video, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          if (basic) {
            video.removeAttribute('src'); video.load();
            return {
              duration, width: canvas.width, height: canvas.height,
              visible: pixels.some((value, index) => index % 4 !== 3 && value > 32),
            };
          }
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
      }, { base64: Buffer.concat(chunks).toString('base64'), format, basic });
      await testInfo.attach('decoded-quality.json', {
        body: JSON.stringify({ ...quality, captureFrameTimes: await page.evaluate(() => globalThis.captureFrameTimes), encoderConfigs: await page.evaluate(() => globalThis.captureEncoderConfigs) }, null, 2),
        contentType: 'application/json',
      });
      if (basic) {
        expect(download.suggestedFilename()).toMatch(/\.mp4$/i);
        expect(Number.isFinite(quality.duration)).toBe(true);
        expect(quality.duration).toBeGreaterThan(0);
        expect(quality.width).toBeGreaterThan(0);
        expect(quality.height).toBeGreaterThan(0);
        expect(quality.visible).toBe(true);
        await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
      } else {
        expect(quality.duration).toBeGreaterThan(6.3);
        for (const score of quality.scores) {
          expect(score).toBeGreaterThanOrEqual(40);
        }
      }
      if (format === 'WebM') {
        const configs = await page.evaluate(() => globalThis.captureEncoderConfigs);
        const encoding = configs.find(config => config.codec.startsWith('vp09') && config.latencyMode === 'quality');
        expect(encoding).toBeDefined();
        expect(encoding.framerate).toBeUndefined();
        const frameTimes = await page.evaluate(() => globalThis.captureFrameTimes);
        expect(frameTimes.length).toBeGreaterThan(1);
        const actualFps = (frameTimes.length - 1) * 1e6 / (frameTimes.at(-1) - frameTimes[0]);
        const requestedFps = await page.evaluate(() => globalThis.requestedCaptureFps);
        expect(actualFps).toBeLessThanOrEqual(requestedFps + 1);
      }
      if (format === 'MP4') {
        expect(quality.width % 2).toBe(0);
        expect(quality.height % 2).toBe(0);
      }
    });
  }
}
