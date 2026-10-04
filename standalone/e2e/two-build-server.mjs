import { createServer } from 'node:http';

/** Serves the preview through one origin and swaps in a second build's worker
 * and identity on demand. Playwright cannot intercept worker script fetches,
 * so the swap has to happen at the server. */
export async function startTwoBuildServer(upstream) {
  const upstreamUrl = new URL(upstream);
  if (upstreamUrl.protocol !== 'http:' || upstreamUrl.hostname !== '127.0.0.1' || upstreamUrl.username || upstreamUrl.password) {
    throw new Error('The update test requires a local preview server');
  }
  let nextBuild = false;
  const server = createServer(async (request, response) => {
    if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) {
      response.writeHead(400);
      response.end('Expected a local preview path');
      return;
    }
    // Only the path and query come from the request. The destination stays fixed.
    const requested = new URL(request.url, 'http://127.0.0.1');
    const url = new URL(upstreamUrl);
    url.pathname = requested.pathname;
    url.search = requested.search;
    try {
      const upstreamResponse = await fetch(url, { redirect: 'error', headers: { accept: request.headers.accept ?? '*/*' } });
      let body = Buffer.from(await upstreamResponse.arrayBuffer());
      const headers = Object.fromEntries([...upstreamResponse.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name)));
      if (nextBuild && url.pathname.endsWith('/sw.js')) {
        body = Buffer.from(body.toString().replace(/(const CACHE = "shader-studio-[^"]+)"/, '$1-next"'));
      }
      if (nextBuild && url.pathname.endsWith('/app-build.json')) {
        body = Buffer.from(JSON.stringify({ buildId: 'next-build', channel: 'production' }));
      }
      response.writeHead(upstreamResponse.status, { ...headers, 'cache-control': 'no-store' });
      response.end(body);
      } catch {
      response.writeHead(502);
      response.end('Preview request failed');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    publishNextBuild: () => {
      nextBuild = true;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

