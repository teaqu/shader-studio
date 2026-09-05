import { test, expect, workspacePath } from './fixtures.mjs';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'dedup', 'dedup.slang');
const configPath = join(workspacePath, 'dedup', 'dedup.sha.json');
// The pinned VS Code exposes 16 textures: 24 logical inputs share 12 images,
// plus a compute output. Chromium renderer tests cover 24 distinct textures
// when the adapter supports that larger budget.
const originalConfig = readFileSync(configPath, 'utf8');

test.use({ vscodeKey: 'slang-dedup' });

async function showShader(vscode, line = 0) {
  await vscode.evaluateInHost(async (vscode, path, line) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    const position = new vscode.Position(line, 4);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }, shaderPath, line);
}

async function expectPreview(frame, rgb, vscode) {
  await expect(frame.getByLabel('Toggle debug mode', { exact: true }).first()).toBeEnabled();
  if (vscode) {
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('notifications.clearAll'));
  }
  await expect(frame.locator('.canvas-container canvas').first()).toBeVisible();
  let logged = false;
  await expect.poll(async () => {
    // Screenshot the presented WebGPU canvas: toDataURL may observe a cleared
    // swapchain after presentation, rather than what the user sees.
    const screenshot = await frame.locator('.canvas-container canvas').first().screenshot();
    const pixel = await frame.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const pixel = [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
      bitmap.close();
      return pixel.slice(0, 3);
    }, screenshot.toString('base64'));
    if (!logged) { console.log('preview pixel', { expected: rgb, actual: pixel }); logged = true; }
    // macOS screenshot compositing quantizes the expected yellow to [254,255,1].
    // Allow one 8-bit step here; shader capture values below remain exact.
    return Math.max(...pixel.map((value, index) => Math.abs(value - rgb[index])));
  }, { message: `preview never displayed ${rgb.join(', ')}` }).toBeLessThanOrEqual(1);
  await expect(frame.locator('[aria-label="Toggle pause"]')).not.toHaveClass(/error/);
}

async function setToggle(frame, label, active) {
  // Responsive toolbars keep a hidden control and add a visible menu copy.
  const state = frame.getByLabel(label, { exact: true }).first();
  if ((await state.getAttribute('class') ?? '').includes('active') !== active) {
    const visible = frame.locator(`[aria-label="${label}"]:visible`);
    if (await visible.count() === 0) {
      await frame.getByLabel('Open options menu', { exact: true }).click();
    }
    await expect(visible).toBeEnabled();
    await visible.click();
  }
  if (active) {
    await expect(state).toHaveClass(/active/);
  } else {
    await expect(state).not.toHaveClass(/active/);
  }
}

async function expectCapture(vscode, frame, sum = 24, alias = 1) {
  // Startup notifications can cover the webview options button in VS Code.
  await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('notifications.clearAll'));
  console.log('enabling debug');
  await setToggle(frame, 'Toggle debug mode', true);
  await setToggle(frame, 'Toggle variable inspector', true);
  console.log('selecting capture line');
  await showShader(vscode, 7);
  await expect(frame.locator('.header-info').first()).toContainText('L8');
  for (const [name, value] of [['sum', sum], ['aliasRed', alias], ['computedGreen', 1]]) {
    const row = frame.getByRole('group', { name: `Preview ${name}`, exact: true });
    await expect(row).toBeVisible();
    console.log('capture row', name, await row.innerText());
    await expect.poll(async () => Number((await row.locator('.var-value').innerText()).trim()), {
      message: `captured ${name} should equal ${value}`,
    }).toBe(value);
  }
  await expect(frame.getByLabel('Show capture errors', { exact: true })).toHaveCount(0);
  await setToggle(frame, 'Toggle debug mode', false);
}

async function saveConfig(vscode, text) {
  await vscode.evaluateInHost(async (vscode, path, text) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    await editor.edit(builder => builder.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text));
    await document.save();
  }, configPath, text);
  await showShader(vscode);
}

test.describe('Slang dedup full app flows', () => {
  test.afterEach(async ({ vscode }, info) => {
    if (info.status !== info.expectedStatus) {
      await info.attach('vscode-window', { body: await vscode.window.screenshot(), contentType: 'image/png' });
      const frame = await vscode.shaderFrame(1000).catch(() => null);
      if (frame) {
        await info.attach('shader-ui', { body: await frame.locator('body').innerText(), contentType: 'text/plain' });
      }
    }
  });

  test.afterAll(async () => {
    writeFileSync(configPath, originalConfig); 
  });

  test('renders and captures 24 texture inputs, updates aliases, and survives VS Code reload', async ({ vscode }) => {
    await showShader(vscode);
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.view'));
    let frame = await vscode.shaderFrame();
    await test.step("initial preview", () => expectPreview(frame, [255, 255, 0], vscode));
    await test.step("initial capture", () => expectCapture(vscode, frame));

    const changed = JSON.parse(originalConfig);
    changed.passes.Image.inputs.alias.path = './blue.svg';
    changed.passes.Image.inputs.alias.filter = 'linear';
    await saveConfig(vscode, JSON.stringify(changed, null, 2));
    frame = await vscode.shaderFrame();
    await expectPreview(frame, [255, 255, 255], vscode);
    await expectCapture(vscode, frame, 24, 0);

    await vscode.evaluateInHost(async vscode => {
      setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
    });
    await expect.poll(() => frame.isDetached(), { message: 'VS Code never reloaded its webview' }).toBe(true);
    // The extension does not register a webview serializer: reopen the saved
    // shader through the same command a user runs after restarting VS Code.
    await showShader(vscode);
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.view'));
    frame = await vscode.shaderFrame();
    await expectPreview(frame, [255, 255, 255], vscode);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).passes.Image.inputs.alias.path).toBe('./blue.svg');
    await expectCapture(vscode, frame, 24, 0);
    await saveConfig(vscode, originalConfig);
  });

  test('renders and captures through the browser-connected UI and survives page reload', async ({ vscode }) => {
    await saveConfig(vscode, originalConfig);
    await vscode.evaluateInHost(async vscode => {
      await vscode.commands.executeCommand('shader-studio.view');
      await vscode.workspace.getConfiguration('shader-studio').update('webServerPort', 38473, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('shader-studio.startWebServer');
    });
    // `channel: 'chromium'` picks the full Chromium build. The default launch
    // uses the headless shell, whose only WebGPU adapter is SwiftShader: it
    // reports 16 sampled textures, renders at about 1 FPS, and presents black.
    // The full build reaches the real adapter (48 textures, 16 samplers here),
    // which is the texture-rich, sampler-poor budget dedup exists for.
    const browser = await chromium.launch({
      channel: 'chromium',
      args: [
        '--enable-unsafe-webgpu',
        // The VS Code window overlaps this one, and Chromium stops
        // requestAnimationFrame in a window it considers occluded.
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    });
    try {
      const page = await browser.newPage();
      page.on('pageerror', error => console.log('browser page error', error.message));
      page.on('console', message => { if (message.type() === 'error') console.log('browser console error', message.text()); });
      await page.goto('http://127.0.0.1:38473');
      await expectPreview(page, [255, 255, 0]);
      await expectCapture(vscode, page);
      const changed = JSON.parse(originalConfig);
      changed.passes.Image.inputs.alias.path = './blue.svg';
      changed.passes.Image.inputs.alias.filter = 'linear';
      await saveConfig(vscode, JSON.stringify(changed, null, 2));
      await expectPreview(page, [255, 255, 255]);
      await page.reload();
      await expectPreview(page, [255, 255, 255]);
      await expectCapture(vscode, page, 24, 0);
    } catch (error) {
      const page = browser.contexts()[0]?.pages()[0];
      if (page) {
        await test.info().attach('browser-ui', { body: await page.locator('body').innerText(), contentType: 'text/plain' });
        await test.info().attach('browser-window', { body: await page.screenshot(), contentType: 'image/png' });
      }
      throw error;
    } finally {
      await browser.close();
      await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.stopWebServer'));
      await saveConfig(vscode, originalConfig);
    }
  });
});
