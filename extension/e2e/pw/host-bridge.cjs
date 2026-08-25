/**
 * Extension-host bridge for the Playwright E2E suite.
 *
 * Loaded through --extensionTestsPath, so it runs inside the extension host with
 * the real `vscode` module in scope. It serves a tiny loopback HTTP endpoint that
 * evaluates a function body against `vscode`, which is how the specs drive VS
 * Code itself (opening documents, moving the cursor, running commands) rather
 * than pantomiming through the command palette.
 *
 * run() intentionally never resolves: VS Code exits as soon as it does, and the
 * suite needs the window to stay up until Playwright closes it.
 */
const http = require('node:http');
const fs = require('node:fs');
const vscode = require('vscode');

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

exports.run = function run() {
  return new Promise((_resolve, reject) => {
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
        res.writeHead(200, { 'content-type': 'application/json' });
        // VS Code serialises enormous bundled stacks; a prefix is enough to diagnose.
        const detail = String(error?.stack ?? error).slice(0, 600);
        res.end(JSON.stringify({ ok: false, error: detail }));
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const portFile = process.env.SHADER_STUDIO_PW_PORT_FILE;
      if (!portFile) {
        reject(new Error('SHADER_STUDIO_PW_PORT_FILE was not set'));
        return;
      }
      fs.writeFileSync(portFile, String(port), 'utf8');
    });
  });
};
