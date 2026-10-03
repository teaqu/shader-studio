import * as assert from 'assert';
import { openCapturePreview, INTEGRATED_BROWSER_COMMAND, type CapturePreviewHost } from '../../app/CapturePreviewLauncher';

suite('CapturePreviewLauncher', () => {
  function fixture(commands = [INTEGRATED_BROWSER_COMMAND], running = false) {
    const events: string[] = [];
    const host: CapturePreviewHost = {
      getCommands: async () => commands,
      isServerRunning: () => running,
      startServer: () => {
        events.push('start'); running = true; 
      },
      getServerUrl: () => 'http://localhost:3000',
      openIntegratedBrowser: async url => {
        events.push(`integrated:${url}`); 
      },
      openExternalBrowser: async url => {
        events.push(`external:${url}`); 
      },
    };
    return { host, events };
  }

  test('starts the server and opens the integrated browser', async () => {
    const { host, events } = fixture();
    await openCapturePreview(host);
    assert.deepStrictEqual(events, ['start', 'integrated:http://localhost:3000']);
  });

  test('reuses the running server', async () => {
    const { host, events } = fixture([INTEGRATED_BROWSER_COMMAND], true);
    await openCapturePreview(host);
    assert.deepStrictEqual(events, ['integrated:http://localhost:3000']);
  });

  test('uses the external browser on older VS Code versions', async () => {
    const { host, events } = fixture([]);
    await openCapturePreview(host);
    assert.deepStrictEqual(events, ['start', 'external:http://localhost:3000']);
  });

  test('does not open a browser when server startup fails', async () => {
    const { host, events } = fixture();
    host.startServer = () => {
      events.push('failed-start'); 
    };
    await assert.rejects(openCapturePreview(host), /could not start/);
    assert.deepStrictEqual(events, ['failed-start']);
  });

  test('propagates integrated browser errors', async () => {
    const { host } = fixture();
    host.openIntegratedBrowser = async () => {
      throw new Error('browser unavailable'); 
    };
    await assert.rejects(openCapturePreview(host), /browser unavailable/);
  });
});
