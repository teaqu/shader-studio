import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { startTwoBuildServer } from './two-build-server.mjs';

test('the update proxy never forwards an absolute request to another server', async () => {
  let unexpectedRequests = 0;
  let lastPreviewPath;
  const other = createServer((_request, response) => {
    unexpectedRequests++;
    response.end('unexpected');
  });
  const upstream = createServer((request, response) => {
    lastPreviewPath = request.url;
    if (request.url === '/redirect') {
      response.writeHead(302, { location: `http://127.0.0.1:${other.address().port}/secret` });
    }
    response.end('preview');
  });
  await Promise.all([upstream, other].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  const proxy = await startTwoBuildServer(`http://127.0.0.1:${upstream.address().port}/`);
  try {
    for (const target of [`http://127.0.0.1:${other.address().port}/secret`, `//127.0.0.1:${other.address().port}/secret`, '/\\secret']) {
      const status = await new Promise((resolve, reject) => {
        const call = request(proxy.origin, { path: target }, response => {
          response.resume();
          resolve(response.statusCode);
        });
        call.on('error', reject);
        call.end();
      });
      assert.equal(status, 400);
    }
    assert.equal((await fetch(`${proxy.origin}/redirect`)).status, 502);
    assert.equal(unexpectedRequests, 0);
    assert.equal(await (await fetch(`${proxy.origin}/assets/example.js?build=1`)).text(), 'preview');
    assert.equal(lastPreviewPath, '/assets/example.js?build=1');
  } finally {
    await proxy.close();
    await Promise.all([upstream, other].map(server => new Promise(resolve => server.close(resolve))));
  }
});

test('the update proxy rejects remote or authenticated upstreams before listening', async () => {
  for (const upstream of ['https://127.0.0.1/', 'http://example.com/', 'http://user:password@127.0.0.1/']) {
    await assert.rejects(startTwoBuildServer(upstream), /requires a local preview/);
  }
});
