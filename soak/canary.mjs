// Soak-branch only: a separate Chromium process that submits trivial GPU work
// every 250ms and logs how long the queue takes to drain, with wall-clock time,
// so corpus stalls can be matched against GPU-wide (host) stalls.
import { chromium } from 'playwright';
import { appendFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'canary.log';
writeFileSync(out, '');
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage();
await page.route('https://canary.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
await page.goto('https://canary.test/');
await page.exposeFunction('report', (line) => appendFileSync(out, `${line}\n`));
await page.evaluate(async () => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const texture = device.createTexture({ size: [64, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  let samples = 0; let worst = 0; let sum = 0;
  for (;;) {
    const encoder = device.createCommandEncoder();
    encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }).end();
    const start = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - start;
    samples += 1; sum += ms; worst = Math.max(worst, ms);
    if (ms > 100) await window.report(`spike t=${Date.now()} ms=${ms.toFixed(0)}`);
    if (samples % 120 === 0) {
      await window.report(`window t=${Date.now()} samples=${samples} avg=${(sum / samples).toFixed(1)} worst=${worst.toFixed(0)}`);
      samples = 0; sum = 0; worst = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});
