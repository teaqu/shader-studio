import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { startTwoBuildServer } from './two-build-server.mjs';
import { readWorkspaceFiles } from './workspace-store.mjs';

test.use({ serviceWorkers: 'allow' });

test('a stale cache from another channel cannot replace the current shell on reload', async ({ page }) => {
  await page.goto('/shader-studio-icon.svg');
  await page.evaluate(async () => {
    const cache = await caches.open('shader-studio-unrelated-stale-build');
    await cache.put('/', new Response('<html><body>Stale shell from another channel</body></html>', { headers: { 'content-type': 'text/html' } }));
  });
  await page.goto('/');
  await controlledByWorker(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
  await expect(page.getByText('Stale shell from another channel')).toHaveCount(0);
});

test('installs the cached standalone shell and reloads it offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => navigator.serviceWorker.ready.then(() => navigator.serviceWorker.controller !== null));
    } catch {
      // An already-running preview may activate a freshly built worker and
      // perform its single safe reload while this poll is in flight.
      return false;
    }
  })
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await context.setOffline(false);
});

test('keeps offline compiler readiness after a refresh', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith('shader-studio-')).map((name) => caches.delete(name)));
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => navigator.serviceWorker.controller !== null)))
    .toBe(true);

  await page.getByRole('button', { name: 'Workspace' }).click();
  await page.getByRole('button', { name: 'Download compilers for offline use' }).click();
  const buildStatus = page.getByRole('status');
  await expect(buildStatus).toHaveAttribute('aria-label', /Ready offline/);

  await page.reload();
  await expect(buildStatus).toHaveAttribute('aria-label', /Ready offline/);
  await page.getByRole('button', { name: 'Workspace' }).click();
  await expect(page.getByRole('button', { name: 'Download compilers for offline use' })).toHaveCount(0);
});

test('serves every install icon from the offline cache', async ({ page, context }) => {
  await page.goto('/');
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => navigator.serviceWorker.ready.then(() => navigator.serviceWorker.controller !== null));
    } catch {
      return false;
    }
  }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  const icons = await page.evaluate(async () => {
    const manifestHref = document.querySelector('link[rel="manifest"]').href;
    const manifest = await (await fetch(manifestHref)).json();
    const sources = [
      ...manifest.icons.map((icon) => new URL(icon.src, manifestHref).href),
      document.querySelector('link[rel="apple-touch-icon"]').href,
    ];
    return Promise.all(sources.map(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return { src: new URL(src).pathname, width: image.naturalWidth };
    }));
  });
  await context.setOffline(false);

  expect(icons).toEqual(expect.arrayContaining([
    { src: '/icons/icon-192.png', width: 192 },
    { src: '/icons/icon-512.png', width: 512 },
    { src: '/icons/icon-maskable-512.png', width: 512 },
    { src: '/icons/apple-touch-icon.png', width: 180 },
  ]));
  expect(icons).toHaveLength(5);
});

async function controlledByWorker(page) {
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => navigator.serviceWorker.ready.then(() => navigator.serviceWorker.controller !== null));
    } catch {
      // The first activation may reload the page while this poll is in flight.
      return false;
    }
  }).toBe(true);
}

async function centrePixel(canvas) {
  const url = await canvas.evaluate((element) => element.toDataURL());
  const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
  const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  return [...data.subarray(offset, offset + 3)];
}

async function replaceShader(page, source, marker) {
  const editor = page.getByTestId('web-editor');
  await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
  await editor.locator('.inputarea').press('ControlOrMeta+A');
  await page.keyboard.insertText(source);
  // Reloading before IndexedDB commits would test nothing.
  await expect.poll(async () => (await readWorkspaceFiles(page))
    .some((file) => file.path.endsWith('/aurora.glsl') && file.contents.includes(marker))).toBe(true);
}

test('edits, renders and saves a shader across offline reloads', async ({ page, context }) => {
  await page.goto('/');
  await controlledByWorker(page);
  await page.getByRole('button', { name: 'Workspace' }).click();
  const prepare = page.getByRole('button', { name: 'Download compilers for offline use' });
  if (await prepare.count()) {
    await prepare.click();
  } else {
    await page.getByRole('button', { name: 'Workspace' }).click();
  }
  await expect(page.getByRole('status')).toHaveAttribute('aria-label', /Ready offline/);

  await page.getByTestId('shader-option-aurora-glsl').click();
  await replaceShader(page, 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.0, 1.0, 0.0, 1.0); } // online edit', 'online edit');

  await context.setOffline(true);
  try {
    await page.reload();
    const editor = page.getByTestId('web-editor');
    const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    await expect(page.getByTestId('shader-option-aurora-glsl')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.locator('.view-lines')).toContainText('online edit');
    await expect.poll(() => centrePixel(canvas)).toEqual([0, 255, 0]);

    await replaceShader(page, 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0, 0.0, 0.0, 1.0); } // offline edit', 'offline edit');
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 0, 0]);

    await page.reload();
    await expect(editor.locator('.view-lines')).toContainText('offline edit');
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 0, 0]);
  } finally {
    await context.setOffline(false);
  }
});

test('a first install does not offer an update', async ({ page }) => {
  await page.goto('/');
  await controlledByWorker(page);
  // The build id arrives after registration, so the status has settled.
  await expect(page.getByRole('status')).toHaveAttribute('title', /Build /);

  await expect(page.getByRole('button', { name: 'Update ready' })).toHaveCount(0);
});

test('accepting a newer build keeps an edit made just before the update', async ({ page, baseURL }) => {
  const builds = await startTwoBuildServer(baseURL);
  try {
    await page.goto(`${builds.origin}/`);
    await controlledByWorker(page);
    const status = page.getByRole('status');
    await expect(status).toHaveAttribute('title', /Build \S+/);
    const firstBuild = (await status.getAttribute('title')).match(/Build (\S+)/)[1];
    expect(firstBuild).not.toBe('next-build');
    await expect(page.getByRole('button', { name: 'Update ready' })).toHaveCount(0);
    await page.getByTestId('shader-option-aurora-glsl').click();

    builds.publishNextBuild();
    await page.getByRole('button', { name: 'Workspace' }).click();
    await page.getByRole('button', { name: 'Check for Updates' }).click();
    const updateReady = page.getByRole('button', { name: 'Update ready' });
    // The offer appears only once the new worker has fetched and precached the
    // app shell; that measured 4.2-5.6s here, past the default 5s assertion.
    await expect(updateReady).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');

    // Typed while the update waits; the shell must save it before reloading.
    const editor = page.getByTestId('web-editor');
    await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
    await editor.locator('.inputarea').press('ControlOrMeta+A');
    await page.keyboard.insertText('void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.75); } // before update');
    const reloaded = page.waitForEvent('load');
    await updateReady.click();
    await reloaded;

    await expect(page.getByRole('status')).toHaveAttribute('title', /Build next-build/);
    await expect(page.getByRole('button', { name: 'Update ready' })).toHaveCount(0);
    await expect(page.getByTestId('shader-option-aurora-glsl')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.locator('.view-lines')).toContainText('before update');
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([expect.stringMatching(/-next$/)]);
  } finally {
    await builds.close();
  }
});
