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
const crypto = require('node:crypto');

const MAX_BODY_BYTES = 1024 * 1024;
const MINIMUM_TOKEN_BYTES = 32;

class BadRequestError extends Error {}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BadRequestError('bridge request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isAuthorised(req, token) {
  const provided = req.headers.authorization;
  const expected = `Bearer ${token}`;
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function writeJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function validateRequest(body) {
  let request;
  try {
    request = JSON.parse(body);
  } catch {
    throw new BadRequestError('bridge request body must be valid JSON');
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || typeof request.source !== 'string' || !Array.isArray(request.args ?? [])) {
    throw new BadRequestError('bridge request must contain a function source and argument array');
  }
  return { source: request.source, args: request.args ?? [] };
}

function invokeVscode(vscode, source, args) {
  // The bridge is only loaded from extension/e2e/pw (excluded from VSIXes), is
  // bound to loopback, and requires a 256-bit token generated per Playwright
  // worker. `source` deliberately remains dynamic so E2E specs can drive the
  // real VS Code API; validate/authenticate the request before this operation.
  // lgtm[js/code-injection]
  const fn = new Function(`return (${source})`)();
  return fn(vscode, ...args);
}

function createBridgeServer({ vscode, token, invoke = invokeVscode }) {
  if (typeof token !== 'string' || Buffer.byteLength(token) < MINIMUM_TOKEN_BYTES) {
    throw new Error('bridge token must contain at least 32 bytes');
  }

  return http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    if (req.url !== '/') {
      res.writeHead(404).end();
      return;
    }
    if (!isAuthorised(req, token)) {
      res.writeHead(401).end();
      return;
    }
    try {
      const { source, args } = validateRequest(await readBody(req));
      const value = await invoke(vscode, source, args);
      writeJson(res, 200, { ok: true, value: value === undefined ? null : value });
    } catch (error) {
      if (error instanceof BadRequestError) {
        writeJson(res, 400, { ok: false, error: error.message });
        return;
      }
      // VS Code serialises enormous bundled stacks; a prefix is enough.
      writeJson(res, 200, { ok: false, error: String(error?.stack ?? error).slice(0, 600) });
    }
  });
}

function publishPortFile({ portFile, port, owner = crypto.randomUUID() }) {
  const publication = JSON.stringify({ owner, port });
  const temporary = `${portFile}.${process.pid}.${owner}`;
  fs.writeFileSync(temporary, publication, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, portFile);
  return publication;
}

async function closeBridgeServer({ server, portFile, publication }) {
  await new Promise((resolve) => server.close(() => resolve()));
  try {
    if (fs.readFileSync(portFile, 'utf8') === publication) {
      fs.rmSync(portFile, { force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function activate(context) {
  const portFile = process.env.SHADER_STUDIO_PW_PORT_FILE;
  const token = process.env.SHADER_STUDIO_PW_BRIDGE_TOKEN;
  if (!portFile || !token) {
    return;
  }

  const server = createBridgeServer({ vscode: require('vscode'), token });
  let publication;

  server.listen(0, '127.0.0.1', () => {
    // Written atomically: the suite re-reads this on every call, and a partial
    // read would send it to a port nothing is listening on.
    publication = publishPortFile({ portFile, port: server.address().port });
  });

  context.subscriptions.push({ dispose: () => closeBridgeServer({ server, portFile, publication }) });
}

module.exports = {
  activate,
  closeBridgeServer,
  createBridgeServer,
  deactivate() {},
  publishPortFile,
};
