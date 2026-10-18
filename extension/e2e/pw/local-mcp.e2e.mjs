import { test, expect, workspacePath } from './fixtures.mjs';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { revertFixtureEditors } from './editor-actions.mjs';
import { findConnectionScreen } from './ai-connection-screen.mjs';

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
    await vscode.evaluateInHost(async vscode => {
      await vscode.commands.executeCommand('shader-studio.connectAiAssistant');
    });
    const connection = await findConnectionScreen(vscode);
    await expect(connection.locator('#status')).toHaveText('Waiting for an assistant');
    token = await connection.getByLabel('Token', { exact: true }).inputValue();
    expect(await vscode.evaluateInHost(vscode => vscode.workspace.getConfiguration('shader-studio').get('mcpToken') === undefined)).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(16);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return result;
    };
    await expect.poll(async () => normalizedPath((await call('list_previews')).structuredContent.previews[0]?.path)).toBe(normalizedPath(shaderPath));
    const previewId = (await call('list_previews')).structuredContent.previews[0].id;
    expect((await call('get_logs')).structuredContent).toMatchObject({ collecting: false, entries: [] });
    expect((await call('start_log_collection', { duration: 300 })).structuredContent.collecting).toBe(true);
    const documentation = await call('read_documentation');
    expect(documentation.structuredContent.topics).toEqual(expect.arrayContaining([
      expect.objectContaining({ topic: 'configuration' }),
      expect.objectContaining({ topic: 'uniforms' }),
    ]));
    const docs = await client.listResources();
    expect(docs.resources.length).toBe(documentation.structuredContent.topics.length);
    for (const resource of docs.resources) {
      const contents = await client.readResource({ uri: resource.uri });
      expect(contents.contents[0].text.length).toBeGreaterThan(100);
    }
    expect((await call('read_documentation', { topic: 'configuration' })).content[0].text).toContain('"script": "uniforms.ts"');
    const inputs = (await call('get_inputs', { previewId })).structuredContent.inputs;
    expect(inputs).toMatchObject({ scope: 'live-preview', pass: 'Image', customUniforms: [],
      builtins: { iMouse: [0, 0, 0, 0], iTime: expect.any(Number), iResolution: expect.any(Array) },
    });
    // A preview is listed as soon as it selects the shader; its first compile may
    // still be in flight, so read pixels only once that compile has rendered.
    let initial;
    await expect.poll(async () => {
      initial = await call('capture_output', { previewId });
      const { compileSequence, renderedSequence, compiling } = initial.structuredContent;
      return !compiling && typeof renderedSequence === 'number' && renderedSequence === compileSequence;
    }, { message: 'the first compile never rendered' }).toBe(true);
    expect(pixel(initial)).toEqual([255, 0, 0, 255]);
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
    const otherPath = join(directory, 'isolated.glsl');
    await call('create_file', { path: otherPath, text: red });
    expect(pixel(await call('capture_output', { previewId })), 'create_file must preserve the current preview').toEqual([0, 255, 0, 255]);
    await call('select_shader', { previewId: browserId, path: otherPath });
    expect(pixel(await call('capture_output', { previewId: browserId }))).toEqual([255, 0, 0, 255]);
    expect(pixel(await call('capture_output', { previewId }))).toEqual([0, 255, 0, 255]);
    await browser.close();
    browser = undefined;

    // Script-provided inputs retain their source and expose temporary MCP writes.
    writeFileSync(join(directory, 'uniforms.ts'), 'export function uniforms() { return { uGain: 0.25 }; }');
    const beforeScript = (await call('read_file', { path: configPath })).structuredContent;
    await call('update_file', { path: configPath, text: JSON.stringify({ version: '1.0', script: 'uniforms.ts', passes: { Image: {} } }), expectedRevision: beforeScript.revision, previewId });
    await call('set_playback', { previewId, paused: false });
    await expect.poll(async () => (await call('get_inputs', { previewId })).structuredContent.inputs.customUniforms).toEqual([
      expect.objectContaining({ name: 'uGain', type: 'float', value: 0.25, pausedValue: null, lastWriter: 'script', scriptMayOverwrite: true, defaultValue: null, range: null }),
    ]);
    await call('set_playback', { previewId, paused: true });
    await call('update_settings', { previewId, uniforms: { uGain: 0.75 } });
    expect((await call('get_inputs', { previewId })).structuredContent.inputs.customUniforms).toEqual([
      expect.objectContaining({ name: 'uGain', value: 0.75, lastWriter: 'mcp', scriptMayOverwrite: true }),
    ]);

    // Build a feedback/input fixture using only MCP file tools.
    const gamePath = join(directory, 'input-game.glsl');
    const controlsPath = join(directory, 'input-game.controls.glsl');
    const controls = `void mainImage(out vec4 c, in vec2 p) {
      vec4 state = texelFetch(iChannel0, ivec2(0), 0);
      float held = texelFetch(iChannel1, ivec2(32, 0), 0).r;
      // The keyboard press row preserves a press even when release and down land between frames.
      float pressed = texelFetch(iChannel1, ivec2(32, 1), 0).r;
      if (iFrame == 0) state = vec4(0);
      if (pressed > 0.5) { state.x += 1.0; if (state.z <= 0.0) state.w = 2.0; }
      state.w -= 8.0 * iTimeDelta;
      state.z = max(0.0, state.z + state.w * iTimeDelta);
      state.y = held;
      c = state;
    }`;
    await call('create_file', { path: controlsPath, text: controls });
    await call('create_file', { path: gamePath, text: 'void mainImage(out vec4 c, in vec2 p) { vec4 s = texelFetch(iChannel0, ivec2(0), 0); c = s.x < 0.5 ? vec4(1,0,0,1) : s.x < 1.5 ? vec4(0,1,0,1) : vec4(0,0,1,1); }' });
    await call('create_file', { path: join(directory, 'input-game.sha.json'), text: JSON.stringify({ version: '1.0', passes: {
      BufferA: { path: 'input-game.controls.glsl', resolution: { width: 1, height: 1 }, inputs: { iChannel0: { type: 'buffer', source: 'BufferA' }, iChannel1: { type: 'keyboard' } } },
      Image: { inputs: { iChannel0: { type: 'buffer', source: 'BufferA' } } },
    } }) });
    expect((await client.callTool({ name: 'create_file', arguments: { path: gamePath, text: 'overwrite' } })).isError).toBe(true);
    const selected = await call('select_shader', { previewId, path: gamePath });
    expect(normalizedPath(selected.structuredContent.previewPath)).toBe(normalizedPath(gamePath));
    await call('set_playback', { previewId, reset: true, paused: false });
    const controlsRead = (await call('read_file', { path: controlsPath })).structuredContent;
    const dependency = await call('update_file', { path: controlsPath, text: controls + '\n', expectedRevision: controlsRead.revision });
    expect(normalizedPath(dependency.structuredContent.previewPath)).toBe(normalizedPath(gamePath));
    expect(pixel(await call('capture_output', { previewId }))).toEqual([255, 0, 0, 255]);
    const feedback = async () => (await call('read_feedback', { previewId, pass: 'BufferA', x: 0, y: 0, width: 1, height: 1 })).structuredContent.values;
    await expect.poll(async () => (await feedback())[0]).toBe(0);
    await call('inject_input', { previewId, events: [{ type: 'pointer_down', x: 12, y: 16 }, { type: 'pointer_move', x: 24, y: 30 }] });
    expect((await call('get_inputs', { previewId })).structuredContent.inputs.builtins.iMouse[0]).toBe(24);
    await call('inject_input', { previewId, events: [{ type: 'pointer_up' }, { type: 'key_down', code: 'KeyW' }] });
    await call('inject_input', { previewId, events: [{ type: 'key_up', code: 'KeyW' }] });
    const video = (await call('start_recording', { previewId, format: 'mp4', duration: 8, fps: 20, width: 160, height: 90, recordInputs: true })).structuredContent;
    await call('inject_input', { previewId, events: [{ type: 'key_down', code: 'Space' }] });
    await expect.poll(async () => (await feedback())[0]).toBe(1);
    await call('inject_input', { previewId, events: [{ type: 'key_up', code: 'Space' }] });
    await expect.poll(async () => (await feedback())[2]).toBe(0);
    await call('inject_input', { previewId, events: [{ type: 'key_down', code: 'Space' }] });
    await expect.poll(async () => (await feedback())[0]).toBe(2);
    await call('inject_input', { previewId, events: [{ type: 'key_up', code: 'Space' }] });
    expect(pixel(await call('capture_output', { previewId }))).toEqual([0, 0, 255, 255]);
    await expect.poll(async () => (await call('get_recording', { previewId, id: video.id })).structuredContent.frameTimestamps.length).toBeGreaterThan(1);
    await call('stop_recording', { previewId, id: video.id });
    let completed;
    await expect.poll(async () => {
      completed = (await call('get_recording', { previewId, id: video.id })).structuredContent;
      return completed.state;
    }).toBe('completed');
    expect(completed).toMatchObject({ previewSwitched: false, recompiled: false, source: { revision: expect.any(String) }, artifact: { path: expect.any(String), bytes: expect.any(Number) } });
    expect(normalizedPath(completed.source.path)).toBe(normalizedPath(gamePath));
    expect(completed.inputTimeline.events.filter(item => item.event.type === 'key_down' && item.event.code === 'Space')).toHaveLength(2);
    expect(completed.frameTimestamps.length).toBeGreaterThan(1);
    const artifact = await client.readResource({ uri: completed.artifact.uri });
    expect(artifact.contents[0].mimeType).toBe('video/mp4');
    expect(Buffer.from(artifact.contents[0].blob, 'base64').subarray(4, 8).toString()).toBe('ftyp');
    browser = await chromium.launch();
    const videoPage = await browser.newPage();
    const decoded = await videoPage.evaluate(async data => {
      const video = document.createElement('video');
      video.muted = true;
      video.src = `data:video/mp4;base64,${data}`;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error('Exported video could not be decoded'));
      });
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    }, artifact.contents[0].blob);
    expect(decoded).toMatchObject({ width: 160, height: 90 });
    expect(decoded.duration).toBeGreaterThan(0);
    await browser.close();
    browser = undefined;
    await call('replay_inputs', { previewId, mode: 'reset-and-play' });
    await expect.poll(async () => (await call('get_input_replay', { previewId })).structuredContent.state).toBe('completed');
    const replayedTimeline = completed.inputTimeline.events.map(item => `${item.event.type}${item.event.code ? `:${item.event.code}` : ''}@${item.time.toFixed(3)}`).join(' ');
    await expect.poll(async () => (await feedback())[0], { message: `replay did not count both Space presses; recorded timeline: ${replayedTimeline}` }).toBe(2);

    // Request a few timed PNGs without starting a video encoder.
    const frameJob = (await call('start_frame_capture', { previewId, times: [0, 0.1, 0.2], mode: 'reset-and-play', width: 80, height: 45 })).structuredContent;
    let frameResult;
    await expect.poll(async () => {
      frameResult = await call('get_frame_capture', { previewId, id: frameJob.id });
      return frameResult.structuredContent.state;
    }).toBe('completed');
    expect(frameResult.structuredContent).toMatchObject({ previewSwitched: false, recompiled: false, source: { revision: expect.any(String) } });
    expect(normalizedPath(frameResult.structuredContent.source.path)).toBe(normalizedPath(gamePath));
    expect(frameResult.structuredContent.frames.map(frame => frame.requestedTime)).toEqual([0, 0.1, 0.2]);
    const frameImages = frameResult.content.filter(item => item.type === 'image');
    expect(frameImages).toHaveLength(3);
    for (const [index, image] of frameImages.entries()) {
      const png = PNG.sync.read(Buffer.from(image.data, 'base64'));
      expect([png.width, png.height]).toEqual([80, 45]);
      expect(pixel({ content: [image] })).toEqual([255, 0, 0, 255]);
      expect(frameResult.structuredContent.frames[index].elapsedTime).toBeGreaterThanOrEqual(frameResult.structuredContent.frames[index].requestedTime - 0.002);
      expect(frameResult.structuredContent.frames[index].data).toBeUndefined();
    }
    const cancelledFrames = (await call('start_frame_capture', { previewId, times: [60] })).structuredContent;
    expect((await call('cancel_frame_capture', { previewId, id: cancelledFrames.id })).structuredContent.state).toBe('cancelled');

    const webm = (await call('start_recording', { previewId, format: 'webm', duration: 0.5, fps: 10, width: 80, height: 46 })).structuredContent;
    let webmResult;
    await expect.poll(async () => {
      webmResult = (await call('get_recording', { previewId, id: webm.id })).structuredContent;
      return webmResult.state;
    }).toBe('completed');
    const webmArtifact = await client.readResource({ uri: webmResult.artifact.uri });
    expect(webmResult.frameTimestamps.length).toBeGreaterThan(1);
    expect(webmResult.actual.fps).toBeGreaterThan(0);
    expect(webmArtifact.contents[0].mimeType).toBe('video/webm');
    expect(Buffer.from(webmArtifact.contents[0].blob, 'base64').subarray(0, 4).toString('hex')).toBe('1a45dfa3');

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
    await call('select_shader', { previewId, path: wgslPath });
    await expect.poll(async () => (await call('list_previews')).structuredContent.previews.map(p => ({ ...p, path: normalizedPath(p.path) }))).toEqual(expect.arrayContaining([expect.objectContaining({ id: previewId, path: normalizedPath(wgslPath) })]));
    const resources = (await call('get_resources', { previewId })).structuredContent;
    expect(resources.passes.map(pass => ({ ...pass, path: normalizedPath(pass.path) }))).toEqual(expect.arrayContaining([{ name: 'Compute', kind: 'compute', path: normalizedPath(computePath) }]));
    expect(resources.storage.counter).toMatchObject({ count: 1, elementType: 'Counter' });
    const computeCapture = await call('capture_output', { previewId });
    expect(computeCapture.structuredContent.errors, JSON.stringify(computeCapture.structuredContent)).toEqual([]);
    expect(pixel(computeCapture)).toEqual([255, 0, 0, 255]);
    expect((await call('read_storage', { previewId, name: 'counter', start: 0, count: 1 })).structuredContent.storageRead.bytes).toEqual([8, 0, 0, 0]);
    const computeRead = (await call('read_file', { path: computePath })).structuredContent;
    expect(pixel(await call('update_file', { path: computePath, text: compute.replace('8u', '42u').replace('vec4f(1, 0, 0, 1)', 'vec4f(0, 1, 0, 1)'), expectedRevision: computeRead.revision, previewId, includePreview: true }))).toEqual([0, 255, 0, 255]);
    expect((await call('read_storage', { previewId, name: 'counter', count: 1 })).structuredContent.storageRead.bytes).toEqual([42, 0, 0, 0]);
    const bufferRead = (await call('read_file', { path: bufferPath })).structuredContent;
    expect(pixel(await call('update_file', { path: bufferPath, text: 'fn mainImage(p: vec2f) -> vec4f { return vec4f(0, 0, 1, 1); }', expectedRevision: bufferRead.revision, previewId, includePreview: true }))).toEqual([0, 0, 255, 255]);
    expect((await call('get_logs', { previewId })).structuredContent.entries.length).toBeGreaterThan(0);

    const stoppedLogs = (await call('stop_log_collection')).structuredContent;
    expect(stoppedLogs.collecting).toBe(false);
    expect(stoppedLogs.entries.length).toBeGreaterThan(0);
    await call('capture_output', { previewId });
    expect((await call('get_logs')).structuredContent.nextCursor).toBe(stoppedLogs.nextCursor);

    // Toggling MCP reattaches the existing webview and browser without reopening them.
    browser = await chromium.launch();
    const togglePage = await browser.newPage();
    await togglePage.goto(`http://127.0.0.1:${webPort}`);
    await expect.poll(async () => (await call('list_previews')).structuredContent.previews.some(preview => preview.kind === 'browser' && preview.path)).toBe(true);
    await vscode.evaluateInHost(async vscode => vscode.workspace.getConfiguration('shader-studio').update('mcpEnabled', false, vscode.ConfigurationTarget.Global));
    await expect.poll(async () => {
      try {
        await fetch(url); return false;
      } catch {
        return true;
      }
    }).toBe(true);
    await vscode.evaluateInHost(async vscode => vscode.workspace.getConfiguration('shader-studio').update('mcpEnabled', true, vscode.ConfigurationTarget.Global));
    await expect.poll(async () => {
      try {
        return (await fetch(url)).status;
      } catch {
        return 0;
      }
    }).toBe(401);
    const toggled = new Client({ name: 'toggle-agent', version: '1' });
    await toggled.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    try {
      const previews = (await toggled.callTool({ name: 'list_previews', arguments: {} })).structuredContent.previews;
      expect(previews.map(preview => preview.kind)).toEqual(expect.arrayContaining(['webview', 'browser']));
      for (const preview of previews) {
        expect(preview.error).toBeUndefined();
        expect(preview.path).toBeTruthy();
      }
      expect((await toggled.callTool({ name: 'get_logs', arguments: {} })).structuredContent).toMatchObject({ collecting: false, entries: [] });
    } finally {
      await toggled.close();
    }

    // Persisted user settings restart MCP after a real extension-host restart.
    await revertFixtureEditors(vscode, directory);
    await client.close();
    const oldFrame = await vscode.shaderFrame();
    // Reload from the host: the command palette cannot open while a webview holds focus.
    await vscode.evaluateInHost(vscode => {
      setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
    });
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
    expect((await restarted.callTool({ name: 'get_logs', arguments: {} })).structuredContent).toMatchObject({ collecting: false, entries: [] });
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
      for (const key of ['mcpEnabled', 'mcpPort', 'webServerPort']) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
      }
    });
    await revertFixtureEditors(vscode, directory);
    rmSync(directory, { recursive: true, force: true });
  }
});
