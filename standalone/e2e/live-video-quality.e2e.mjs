import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';

const measureVideoQuality = async ({ base64, format, basic, containerDuration }) => {
  const video = document.createElement('video');
  video.src = `data:video/${format.toLowerCase()};base64,${base64}`;
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = reject;
  });
  const duration = Number.isFinite(video.duration) ? video.duration : containerDuration;
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
};

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
        globalThis.captureMediaRecorderOptions = [];
        globalThis.captureReadbacks = { readPixels: 0, mapAsync: 0 };
        const readPixels = WebGL2RenderingContext.prototype.readPixels;
        WebGL2RenderingContext.prototype.readPixels = function(...args) {
          globalThis.captureReadbacks.readPixels++;
          return readPixels.call(this, ...args);
        };
        if (globalThis.GPUBuffer) {
          const mapAsync = GPUBuffer.prototype.mapAsync;
          GPUBuffer.prototype.mapAsync = function(...args) {
            globalThis.captureReadbacks.mapAsync++;
            return mapAsync.call(this, ...args);
          };
        }
        const NativeMediaRecorder = MediaRecorder;
        globalThis.NativeMediaRecorder = NativeMediaRecorder;
        globalThis.MediaRecorder = class extends NativeMediaRecorder {
          constructor(stream, options) {
            globalThis.captureMediaRecorderOptions.push(options);
            globalThis.captureMediaRecorderStream = stream;
            super(stream, options);
          }
        };
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
      await expect(page.locator('.recording-panel h4', { hasText: 'Frame Rate' })).toHaveCount(0);
      await page.evaluate(() => {
        globalThis.captureReadbacks = { readPixels: 0, mapAsync: 0 };
      });
      await page.getByRole('button', { name: 'Start recording', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop & save', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => globalThis.captureMediaRecorderOptions.length)).toBe(1);
      await page.evaluate(() => {
        const chunks = [];
        const recorder = new globalThis.NativeMediaRecorder(
          globalThis.captureMediaRecorderStream,
          globalThis.captureMediaRecorderOptions.at(-1),
        );
        globalThis.nativeReference = {
          recorder,
          result: new Promise((resolve, reject) => {
            recorder.ondataavailable = event => {
              if (event.data.size > 0) {
                chunks.push(event.data);
              }
            };
            recorder.onerror = () => reject(new Error('native reference encoding failed'));
            recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
          }),
        };
        recorder.start();
      });
      // Cover a full shader colour cycle rather than one favourable short phase.
      await page.waitForTimeout(basic ? 1500 : 8000);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Stop & save', exact: true }).evaluate(button => {
        button.addEventListener('click', () => globalThis.nativeReference.recorder.stop(), { once: true, capture: true });
      });
      await page.getByRole('button', { name: 'Stop & save', exact: true }).click();
      const download = await downloading;
      await download.saveAs(testInfo.outputPath(`live.${format.toLowerCase()}`));
      const chunks = [];
      for await (const chunk of await download.createReadStream()) {
        chunks.push(chunk);
      }
      const nativeReferenceBase64 = await page.evaluate(async () => {
        const blob = await globalThis.nativeReference.result;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return btoa(binary);
      });
      const productBytes = Buffer.concat(chunks);
      const readbacks = await page.evaluate(() => globalThis.captureReadbacks);
      if (shader === 'aurora-glsl') {
        expect(readbacks.readPixels + readbacks.mapAsync).toBe(0);
      } else {
        expect(readbacks.readPixels + readbacks.mapAsync).toBeLessThanOrEqual(1);
      }
      const referenceBytes = Buffer.from(nativeReferenceBase64, 'base64');
      let containerDuration;
      const input = new Input({ source: new BufferSource(productBytes), formats: ALL_FORMATS });
      try {
        containerDuration = await input.computeDuration();
        if (format === 'WebM') {
          const track = await input.getPrimaryVideoTrack();
          const packetTimes = [];
          for await (const packet of new EncodedPacketSink(track).packets()) {
            packetTimes.push(packet.timestamp);
          }
          expect(packetTimes.length).toBeGreaterThan(1);
          for (let i = 1; i < packetTimes.length; i++) {
            expect(packetTimes[i]).toBeGreaterThanOrEqual(packetTimes[i - 1]);
          }
        }
      } finally {
        input.dispose();
      }
      const referenceInput = new Input({ source: new BufferSource(referenceBytes), formats: ALL_FORMATS });
      let referenceDuration;
      try {
        referenceDuration = await referenceInput.computeDuration();
      } finally {
        referenceInput.dispose();
      }
      const quality = await page.evaluate(measureVideoQuality, { base64: productBytes.toString('base64'), format, basic, containerDuration });
      const referenceQuality = await page.evaluate(measureVideoQuality, { base64: nativeReferenceBase64, format, basic, containerDuration: referenceDuration });
      await testInfo.attach('decoded-quality.json', {
        body: JSON.stringify({ product: quality, reference: referenceQuality, captureFrameTimes: await page.evaluate(() => globalThis.captureFrameTimes), encoderConfigs: await page.evaluate(() => globalThis.captureEncoderConfigs) }, null, 2),
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
        const mean = scores => scores.reduce((sum, score) => sum + score, 0) / scores.length;
        expect(Math.min(...quality.scores)).toBeGreaterThan(30);
        expect(mean(quality.scores)).toBeGreaterThanOrEqual(mean(referenceQuality.scores) - 1);
        expect(Math.min(...quality.scores)).toBeGreaterThanOrEqual(Math.min(...referenceQuality.scores) - 1);
      }
      {
        const recorder = await page.evaluate(() => globalThis.captureMediaRecorderOptions.at(-1));
        expect(recorder).toMatchObject({ videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 0 });
        const expectedMimeType = await page.evaluate((format) => (format === 'WebM'
          ? ['video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
          : ['video/mp4;codecs=avc1', 'video/mp4']
        ).find(type => MediaRecorder.isTypeSupported(type)), format);
        expect(recorder.mimeType).toBe(expectedMimeType);
        expect(containerDuration).toBeGreaterThan(basic ? 0 : 6.3);
      }
      if (format === 'MP4') {
        expect(quality.width % 2).toBe(0);
        expect(quality.height % 2).toBe(0);
      }
    });
  }
}
