/**
 * Test-only bridge for the Playwright E2E suite.
 *
 * Serves a loopback endpoint that evaluates a function against the real `vscode`
 * module, which is how the specs open documents, move the cursor and run
 * commands - the job `browser.executeWorkbench` did under WebdriverIO.
 *
 * This is a real extension rather than an --extensionTestsPath module because
 * that module runs once: when VS Code restarts the extension host during
 * startup the bridge would vanish for good, leaving the suite talking to a dead
 * port. An extension re-activates with the host and republishes its port.
 */
const http = require('node:http');
const fs = require('node:fs');

const MAX_BODY_BYTES = 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('bridge request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function activate(context) {
  const vscode = require('vscode');
  const portFile = process.env.SHADER_STUDIO_PW_PORT_FILE;
  if (!portFile) {
    return;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    try {
      const { source, args = [] } = JSON.parse(await readBody(req));
      const fn = new Function(`return (${source})`)();
      const value = await fn(vscode, ...args);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, value: value === undefined ? null : value }));
    } catch (error) {
      // VS Code serialises enormous bundled stacks; a prefix is enough.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(error?.stack ?? error).slice(0, 600) }));
    }
  });

  server.listen(0, '127.0.0.1', () => {
    // Written atomically: the suite re-reads this on every call, and a partial
    // read would send it to a port nothing is listening on.
    const temporary = `${portFile}.${process.pid}`;
    fs.writeFileSync(temporary, String(server.address().port), 'utf8');
    fs.renameSync(temporary, portFile);
  });

  context.subscriptions.push({ dispose: () => server.close() });
}

module.exports = { activate, deactivate() {} };
