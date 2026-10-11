import { test, expect, workspacePath } from './fixtures.mjs';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { revertFixtureEditors } from './editor-actions.mjs';

test.use({ vscodeKey: 'local-mcp' });
// The fixture launches VS Code before entering the test; the folder must exist
// at launch for VS Code to open it as a workspace rather than an empty window.
mkdirSync(workspacePath, { recursive: true });
const normalizedPath = value => process.platform === 'win32' ? value?.toLowerCase() : value;

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function pixel(result) {
  const image = result.content.find(item => item.type === 'image');
  expect(image?.mimeType).toBe('image/png');
  const png = PNG.sync.read(Buffer.from(image.data, 'base64'));
  const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

test('generic MCP edits files and captures both webview and server preview @gpu', async ({ vscode }) => {
  const directory = join(workspacePath, `local-mcp-${process.pid}`);
  const shaderPath = join(directory, 'mcp.glsl');
  const configPath = join(directory, 'mcp.sha.json');
  const red = 'void mainImage(out vec4 c, in vec2 p) { c = vec4(1, 0, 0, 1); }';
  const green = 'void mainImage(out vec4 c, in vec2 p) { c = vec4(0, 1, 0, 1); }';
  mkdirSync(directory, { recursive: true });
  writeFileSync(shaderPath, red);
  writeFileSync(configPath, '{"version":"1.0","passes":{"Image":{}}}');
  const port = await freePort();
  const webPort = await freePort();
  let token = '';
  const url = `http://127.0.0.1:${port}/mcp`;
  const client = new Client({ name: 'any-agent', version: '1' });
  let browser;
  try {
    await vscode.evaluateInHost((vscode, path) => {
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.file(path) });
      }
    }, workspacePath);
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.workspace.workspaceFolders?.length ?? 0)).toBeGreaterThan(0);
    expect(await vscode.evaluateInHost(vscode => vscode.workspace.getConfiguration('shader-studio').get('mcpEnabled'))).toBe(false);
    await vscode.evaluateInHost(async (vscode, settings) => {
      const config = vscode.workspace.getConfiguration('shader-studio');
      await config.update('mcpPort', settings.port, vscode.ConfigurationTarget.Global);
      await config.update('mcpEnabled', true, vscode.ConfigurationTarget.Global);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(settings.shaderPath));
      await vscode.window.showTextDocument(doc, { preview: false });
      await vscode.commands.executeCommand('shader-studio.view');
    }, { port, shaderPath });
    await expect.poll(async () => {
 try {
 return (await fetch(url)).status; 
} catch {
 return 0; 
} 
}).toBe(401);
    token = await vscode.evaluateInHost(vscode => vscode.workspace.getConfiguration('shader-studio').get('mcpToken'));
    expect(token.length).toBeGreaterThanOrEqual(16);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return result;
    };
    await expect.poll(async () => normalizedPath((await call('list_previews')).structuredContent.previews[0]?.path)).toBe(normalizedPath(shaderPath));
    const previewId = (await call('list_previews')).structuredContent.previews[0].id;
    expect(pixel(await call('capture_output', { previewId }))).toEqual([255, 0, 0, 255]);
    const read = (await call('read_file', { path: shaderPath })).structuredContent;
    const edited = await call('update_file', { path: shaderPath, text: green, expectedRevision: read.revision, previewId, includePreview: true });
    expect(edited.structuredContent).toMatchObject({ applied: true, dirty: true, errors: [] });
    expect(pixel(edited)).toEqual([0, 255, 0, 255]);
    expect(await vscode.evaluateInHost(async (vscode, path) => (await vscode.workspace.openTextDocument(path)).getText(), shaderPath)).toBe(green);
    const configRead = (await call('get_settings', { previewId })).structuredContent.configFile;
    const configEdit = await call('update_file', { path: configPath, text: configRead.text + '\n', expectedRevision: configRead.revision, previewId, includePreview: true });
    expect(pixel(configEdit)).toEqual([0, 255, 0, 255]);
    expect((await call('set_playback', { previewId, paused: true })).structuredContent.paused).toBe(true);
    expect((await call('update_settings', { previewId, speed: 2, fpsLimit: 30 })).structuredContent).toMatchObject({ speed: 2, fpsLimit: 30 });

    await vscode.evaluateInHost(async (vscode, webPort) => {
      await vscode.workspace.getConfiguration('shader-studio').update('webServerPort', webPort, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('shader-studio.startWebServer');
    }, webPort);
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${webPort}`);
    await expect.poll(async () => (await call('list_previews')).structuredContent.previews.some(preview => preview.kind === 'browser' && normalizedPath(preview.path) === normalizedPath(shaderPath))).toBe(true);
    const browserId = (await call('list_previews')).structuredContent.previews.find(preview => preview.kind === 'browser').id;
    expect(pixel(await call('capture_output', { previewId: browserId }))).toEqual([0, 255, 0, 255]);
    const serverClient = new Client({ name: 'web-server-agent', version: '1' });
    await serverClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${webPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    expect((await serverClient.listTools()).tools.some(tool => tool.name === 'update_file')).toBe(true);
    await serverClient.close();
    await browser.close();
    browser = undefined;

    // Exercise buffer/compute files and real storage values on WebGPU too.
    const wgslPath = join(directory, 'storage.wgsl');
    const computePath = join(directory, 'compute.wgsl');
    const bufferPath = join(directory, 'buffer.wgsl');
    const compute = `@compute @workgroup_size(1, 1, 1)
      fn fill(@builtin(global_invocation_id) id: vec3u) {
        atomicStore(&counter[0].value, 8u);
        writeOutput(id.xy, vec4f(1, 0, 0, 1));
      }`;
    writeFileSync(wgslPath, 'fn mainImage(p: vec2f) -> vec4f { return resultSampleLevel(p / iResolution.xy, 0.0); }');
    writeFileSync(computePath, compute);
    writeFileSync(bufferPath, 'fn mainImage(p: vec2f) -> vec4f { return resultSampleLevel(p / iResolution.xy, 0.0); }');
    writeFileSync(join(directory, 'common.wgsl'), 'struct Counter { value: atomic<u32>, }');
    writeFileSync(join(directory, 'storage.sha.json'), JSON.stringify({ version: '1', storage: { counter: { count: 1, elementType: 'Counter' } }, passes: {
      common: { path: 'common.wgsl' },
      Compute: { type: 'compute', path: 'compute.wgsl', entryPoint: 'fill' },
      BufferA: { path: 'buffer.wgsl', inputs: { result: { type: 'buffer', source: 'Compute' } } },
      Image: { inputs: { result: { type: 'buffer', source: 'BufferA' } } },
    } }));
    await vscode.evaluateInHost(async (vscode, path) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.window.showTextDocument(doc, { preview: false });
    }, wgslPath);
    await expect.poll(async () => (await call('list_previews')).structuredContent.previews.map(p => ({ ...p, path: normalizedPath(p.path) }))).toEqual(expect.arrayContaining([expect.objectContaining({ id: previewId, path: normalizedPath(wgslPath) })]));
    const resources = (await call('get_resources', { previewId })).structuredContent;
    expect(resources.passes.map(pass => ({ ...pass, path: normalizedPath(pass.path) }))).toEqual(expect.arrayContaining([{ name: 'Compute', kind: 'compute', path: normalizedPath(computePath) }]));
    expect(resources.storage.counter).toMatchObject({ count: 1, elementType: 'Counter' });
    expect(pixel(await call('capture_output', { previewId }))).toEqual([255, 0, 0, 255]);
    expect((await call('read_storage', { previewId, name: 'counter', start: 0, count: 1 })).structuredContent.storageRead.bytes).toEqual([8, 0, 0, 0]);
    const computeRead = (await call('read_file', { path: computePath })).structuredContent;
    expect(pixel(await call('update_file', { path: computePath, text: compute.replace('8u', '42u').replace('vec4f(1, 0, 0, 1)', 'vec4f(0, 1, 0, 1)'), expectedRevision: computeRead.revision, previewId, includePreview: true }))).toEqual([0, 255, 0, 255]);
    expect((await call('read_storage', { previewId, name: 'counter', count: 1 })).structuredContent.storageRead.bytes).toEqual([42, 0, 0, 0]);
    const bufferRead = (await call('read_file', { path: bufferPath })).structuredContent;
    expect(pixel(await call('update_file', { path: bufferPath, text: 'fn mainImage(p: vec2f) -> vec4f { return vec4f(0, 0, 1, 1); }', expectedRevision: bufferRead.revision, previewId, includePreview: true }))).toEqual([0, 0, 255, 255]);
    expect((await call('get_logs', { previewId })).structuredContent.entries.length).toBeGreaterThan(0);

    // Persisted user settings restart MCP after a real extension-host restart.
    await revertFixtureEditors(vscode, directory);
    await client.close();
    const oldFrame = await vscode.shaderFrame();
    await vscode.window.keyboard.press('F1');
    await vscode.window.locator('.quick-input-widget input').fill('>Developer: Reload Window');
    await vscode.window.keyboard.press('Enter');
    await expect.poll(() => oldFrame.isDetached()).toBe(true);
    await expect.poll(async () => {
 try {
 return (await fetch(url)).status; 
} catch {
 return 0; 
} 
}).toBe(401);
    const restarted = new Client({ name: 'reconnected-agent', version: '1' });
    await restarted.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    expect((await restarted.listTools()).tools.some(tool => tool.name === 'read_storage')).toBe(true);
    await restarted.close();
    await vscode.evaluateInHost(async vscode => vscode.workspace.getConfiguration('shader-studio').update('mcpEnabled', false, vscode.ConfigurationTarget.Global));
    await expect.poll(async () => {
 try {
 await fetch(url); return false; 
} catch {
 return true; 
} 
}).toBe(true);
  } finally {
    await client.close();
    await browser?.close();
    await vscode.evaluateInHost(async vscode => {
      await vscode.commands.executeCommand('shader-studio.stopWebServer');
      const config = vscode.workspace.getConfiguration('shader-studio');
      for (const key of ['mcpEnabled', 'mcpPort', 'mcpToken', 'webServerPort']) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
      }
    });
    await revertFixtureEditors(vscode, directory);
    rmSync(directory, { recursive: true, force: true });
  }
});
