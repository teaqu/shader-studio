// Soak-branch only: reports which WebGPU adapter Playwright's Chromium gets on
// this runner and proves a canvas getCurrentTexture -> copyTextureToBuffer ->
// mapAsync round-trip, so GPU results can be judged against real hardware.
import { chromium } from 'playwright';

const variants = [
  { name: 'default launch (as vitest browser provider)', options: { args: ['--enable-unsafe-webgpu'] } },
  { name: 'full chromium channel', options: { channel: 'chromium', args: ['--enable-unsafe-webgpu'] } },
];

async function probe(page) {
  return page.evaluate(async () => {
    const out = { hasGpu: !!navigator.gpu };
    if (!navigator.gpu) return out;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ...out, adapter: null };
    const info = adapter.info ?? {};
    out.adapter = {
      vendor: info.vendor, architecture: info.architecture, device: info.device,
      description: info.description, isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter,
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      maxSampledTexturesPerShaderStage: adapter.limits.maxSampledTexturesPerShaderStage,
    };
    const device = await adapter.requestDevice();
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    document.body.appendChild(canvas);
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, alphaMode: 'opaque' });
    const texture = context.getCurrentTexture();
    const buffer = device.createBuffer({ size: 256 * 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 0.5, b: 0.25, a: 1 } }] });
    pass.end();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, { width: 64, height: 64 });
    const t0 = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const t1 = performance.now();
    await buffer.mapAsync(GPUMapMode.READ);
    const t2 = performance.now();
    const px = Array.from(new Uint8Array(buffer.getMappedRange(0, 4)));
    buffer.unmap();
    const [r, g, b] = format === 'bgra8unorm' ? [px[2], px[1], px[0]] : [px[0], px[1], px[2]];
    out.roundTrip = {
      format, rawPixel: px, rgb: [r, g, b],
      ok: Math.abs(r - 255) <= 2 && Math.abs(g - 128) <= 2 && Math.abs(b - 64) <= 2,
      submittedWorkDoneMs: +(t1 - t0).toFixed(2), mapAsyncMs: +(t2 - t1).toFixed(2),
    };
    return out;
  });
}

let failed = false;
for (const variant of variants) {
  let browser;
  try {
    browser = await chromium.launch(variant.options);
    const page = await browser.newPage();
    await page.route('https://probe.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('https://probe.test/');
    const result = await probe(page);
    console.log(`\n## ${variant.name} (Chromium ${browser.version()})\n${JSON.stringify(result, null, 2)}`);
    if (!result.roundTrip?.ok) failed = true;
  } catch (error) {
    console.log(`\n## ${variant.name}\nERROR: ${error.stack ?? error}`);
    failed = true;
  } finally {
    await browser?.close();
  }
}
process.exit(failed ? 1 : 0);
