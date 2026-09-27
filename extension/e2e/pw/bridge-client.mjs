import { readFileSync } from 'node:fs';

export function readBridgePort(portFile) {
  const endpoint = JSON.parse(readFileSync(portFile, 'utf8'));
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
    throw new Error('bridge published an invalid port');
  }
  return endpoint.port;
}

const defaultSleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

function isTransientBridgeError(error) {
  const detail = `${String(error?.message ?? error)}${String(error?.code ?? '')}${String(error?.cause?.code ?? '')}`;
  return /Canceled|ENOENT|ECONNREFUSED|ECONNRESET|fetch failed/i.test(detail);
}

export async function evaluateBridgeCall({
  portFile,
  token,
  source,
  args,
  timeout = 60_000,
  interval = 500,
  readPort = readBridgePort,
  fetchImpl = fetch,
  sleep = defaultSleep,
}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      // Re-read for every attempt: an extension-host restart briefly removes
      // the publication, then replaces it with a different listening port.
      const port = readPort(portFile);
      const response = await fetchImpl(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ source, args }),
      });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(`extension host: ${result.error}`);
      }
      return result.value;
    } catch (error) {
      if (!isTransientBridgeError(error) || Date.now() >= deadline) {
        throw error;
      }
      await sleep(interval);
    }
  }
}
