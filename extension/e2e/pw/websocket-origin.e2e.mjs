import { test, expect } from './fixtures.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';

test.use({ vscodeKey: 'websocket-origin' });

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(url) {
  await expect.poll(async () => {
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  }).toBe(true);
}

async function websocketResult(page, port) {
  return page.evaluate(wsPort => new Promise(resolve => {
    const socket = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    let opened = false;
    socket.addEventListener('open', () => {
      opened = true;
      socket.close();
      resolve('open');
    }, { once: true });
    socket.addEventListener('error', () => resolve('rejected'), { once: true });
    socket.addEventListener('close', () => {
      if (!opened) {
        resolve('rejected');
      }
    }, { once: true });
  }), port);
}

test('browser WebSocket access follows the confirmed web server port', async ({ vscode }) => {
  const attacker = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Unrelated local page</title>');
  });
  await new Promise((resolve, reject) => {
    attacker.once('error', reject);
    attacker.listen(0, '127.0.0.1', resolve);
  });
  const attackerAddress = attacker.address();
  const attackerPort = typeof attackerAddress === 'object' && attackerAddress ? attackerAddress.port : 0;
  const firstPort = await availablePort();
  const browser = await chromium.launch();

  try {
    await vscode.evaluateInHost(async (vscode, port) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        'webServerPort', port, vscode.ConfigurationTarget.Global,
      );
      await vscode.commands.executeCommand('shader-studio.startWebServer');
    }, firstPort);

    const firstUrl = `http://127.0.0.1:${firstPort}`;
    await waitForHttp(firstUrl);
    const preview = await browser.newPage();
    await preview.goto(firstUrl);
    const webSocketPort = await preview.evaluate(() => window.shaderViewConfig?.port);
    expect(webSocketPort).toBeGreaterThan(0);
    await expect(websocketResult(preview, webSocketPort)).resolves.toBe('open');

    const secondPort = await availablePort();
    await vscode.evaluateInHost(async (vscode, port) => {
      await vscode.workspace.getConfiguration('shader-studio').update(
        'webServerPort', port, vscode.ConfigurationTarget.Global,
      );
    }, secondPort);
    await expect(websocketResult(preview, webSocketPort)).resolves.toBe('open');

    const unrelated = await browser.newPage();
    await unrelated.goto(`http://127.0.0.1:${attackerPort}`);
    await expect(websocketResult(unrelated, webSocketPort)).resolves.toBe('rejected');

    await vscode.evaluateInHost(async vscode => {
      await vscode.commands.executeCommand('shader-studio.stopWebServer');
      await vscode.commands.executeCommand('shader-studio.startWebServer');
    });
    const secondUrl = `http://127.0.0.1:${secondPort}`;
    await waitForHttp(secondUrl);
    const restartedPreview = await browser.newPage();
    await restartedPreview.goto(secondUrl);
    await expect(websocketResult(restartedPreview, webSocketPort)).resolves.toBe('open');
  } finally {
    await browser.close();
    await new Promise(resolve => attacker.close(resolve));
    await vscode.evaluateInHost(async vscode => {
      await vscode.commands.executeCommand('shader-studio.stopWebServer');
      await vscode.workspace.getConfiguration('shader-studio').update(
        'webServerPort', undefined, vscode.ConfigurationTarget.Global,
      );
    });
  }
});
