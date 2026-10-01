import { spawn as spawnProcess, spawnSync } from 'node:child_process';

/**
 * Every X client on a display shares one input focus. Parallel workers each
 * launch a VS Code window, and a window that starts up or activates takes that
 * focus from the others. Playwright emulates focus for the workbench's main
 * frame, but the preview is an out-of-process webview frame that still sees the
 * real focus change: open menus close and Monaco cancels its suggest widget in
 * whichever window lost it. Giving each VS Code its own display removes the
 * shared focus instead of racing it.
 */
export function shouldUsePrivateDisplay({ platform, env, hasXvfb }) {
  if (platform !== 'linux' || !hasXvfb) {
    return false;
  }
  return !env.SHADER_STUDIO_E2E_SHARED_DISPLAY;
}

export function hasXvfb(spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('Xvfb', ['-help'], { stdio: 'ignore' });
  return !result.error;
}

/**
 * Starts Xvfb on a free display and resolves once it accepts clients.
 * `-displayfd` makes the server pick the number and report it on that fd only
 * after it is ready, so there is no fixed number to collide on and no polling.
 */
export function startPrivateDisplay({ screen = '1920x1080x24', timeout = 15_000, spawn = spawnProcess } = {}) {
  const server = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', screen, '-nolisten', 'tcp'], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stdio[2]?.on('data', (chunk) => {
    stderr += chunk;
  });

  return new Promise((resolve, reject) => {
    let reported = '';
    const fail = (reason) => {
      clearTimeout(timer);
      server.kill();
      reject(new Error(`${reason}${stderr ? `\n${stderr.trim()}` : ''}`));
    };
    const timer = setTimeout(() => fail(`Xvfb did not report a display within ${timeout}ms`), timeout);
    server.once('error', (error) => fail(`Xvfb failed to start: ${error.message}`));
    server.once('exit', (code, signal) => fail(`Xvfb exited before reporting a display (${signal ?? code})`));
    server.stdio[3].on('data', (chunk) => {
      reported += chunk;
      const newline = reported.indexOf('\n');
      if (newline < 0) {
        return;
      }
      const number = reported.slice(0, newline).trim();
      if (!/^\d+$/.test(number)) {
        fail(`Xvfb reported an invalid display: ${JSON.stringify(number)}`);
        return;
      }
      clearTimeout(timer);
      server.removeAllListeners('exit');
      server.removeAllListeners('error');
      resolve({
        display: `:${number}`,
        close: () => new Promise((done) => {
          if (server.exitCode !== null || server.signalCode !== null) {
            done();
            return;
          }
          server.once('exit', () => done());
          server.kill();
        }),
      });
    });
  });
}

/**
 * The display one VS Code window should run on: a private one when the policy
 * above applies, otherwise the inherited one. `env` is merged into the launch
 * environment; `close` stops the private server, if any.
 */
export async function openWindowDisplay({ platform = process.platform, env = process.env, xvfb = hasXvfb, start = startPrivateDisplay } = {}) {
  if (!shouldUsePrivateDisplay({ platform, env, hasXvfb: xvfb() })) {
    return { private: false, env: {}, close: async () => {} };
  }
  const { display, close } = await start();
  return { private: true, env: { DISPLAY: display }, close };
}
