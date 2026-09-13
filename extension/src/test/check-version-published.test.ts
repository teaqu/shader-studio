import * as assert from 'assert';
import * as path from 'path';
import { pathToFileURL } from 'url';

const scriptUrl = pathToFileURL(
  path.resolve(__dirname, '..', '..', 'scripts', 'check-version-published.mjs'),
).href;

type Manifest = { publisher: string; name: string; version: string };
type Checker = {
  marketplaceVersions(payload: unknown): string[];
  isOnMarketplace(manifest: Manifest, fetchImpl: unknown): Promise<boolean>;
  isOnOpenVsx(manifest: Manifest, fetchImpl: unknown): Promise<boolean>;
  registriesAlreadyServing(options: {
    manifest: Manifest;
    registries?: string[];
    fetchImpl?: unknown;
  }): Promise<string[]>;
  readManifest(root?: string): Manifest;
};

const manifest: Manifest = { publisher: 'teaqu', name: 'shader-studio', version: '1.1.0' };

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const marketplacePayload = (...versions: string[]) => ({
  results: [{ extensions: [{ versions: versions.map((version) => ({ version })) }] }],
});

/**
 * A registry keys on the version, so republishing the same one uploads nothing
 * and still reports success. These are the checks that stop a release from
 * going green while users keep the build they already have.
 */
suite('Refusing to release an already-published version', () => {
  let checker: Checker;

  suiteSetup(async () => {
    checker = await import(scriptUrl) as unknown as Checker;
  });

  suite('marketplaceVersions', () => {
    test('reads the versions out of a gallery response', () => {
      assert.deepStrictEqual(
        checker.marketplaceVersions(marketplacePayload('1.1.0', '1.0.2')),
        ['1.1.0', '1.0.2'],
      );
    });

    test('treats an extension the gallery has never seen as unpublished', () => {
      assert.deepStrictEqual(checker.marketplaceVersions({ results: [{ extensions: [] }] }), []);
      assert.deepStrictEqual(checker.marketplaceVersions({}), []);
    });
  });

  suite('isOnMarketplace', () => {
    test('asks the gallery for this extension and matches the version', async () => {
      const calls: any[] = [];
      const fetchImpl = async (url: string, init: any) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return jsonResponse(marketplacePayload('1.0.2', '1.1.0'));
      };

      assert.strictEqual(await checker.isOnMarketplace(manifest, fetchImpl), true);
      assert.strictEqual(
        calls[0].body.filters[0].criteria[0].value,
        'teaqu.shader-studio',
      );
    });

    test('reports a version the gallery does not carry', async () => {
      const fetchImpl = async () => jsonResponse(marketplacePayload('1.0.2'));

      assert.strictEqual(await checker.isOnMarketplace(manifest, fetchImpl), false);
    });

    test('throws rather than guessing when the gallery cannot be reached', async () => {
      const fetchImpl = async () => jsonResponse({}, 503);

      await assert.rejects(
        () => checker.isOnMarketplace(manifest, fetchImpl),
        /status 503/,
      );
    });
  });

  suite('isOnOpenVsx', () => {
    test('reads a published version as present', async () => {
      const urls: string[] = [];
      const fetchImpl = async (url: string) => {
        urls.push(url);
        return jsonResponse({ version: '1.1.0' });
      };

      assert.strictEqual(await checker.isOnOpenVsx(manifest, fetchImpl), true);
      assert.ok(urls[0].endsWith('/teaqu/shader-studio/1.1.0'), urls[0]);
    });

    test('reads a 404 as not published', async () => {
      const fetchImpl = async () => jsonResponse({ error: 'not found' }, 404);

      assert.strictEqual(await checker.isOnOpenVsx(manifest, fetchImpl), false);
    });

    test('throws on any other failure rather than assuming it is new', async () => {
      const fetchImpl = async () => jsonResponse({}, 500);

      await assert.rejects(() => checker.isOnOpenVsx(manifest, fetchImpl), /status 500/);
    });
  });

  suite('registriesAlreadyServing', () => {
    test('names every registry already carrying the version', async () => {
      const fetchImpl = async (url: string) => (url.includes('open-vsx')
        ? jsonResponse({ version: '1.1.0' })
        : jsonResponse(marketplacePayload('1.1.0')));

      assert.deepStrictEqual(
        await checker.registriesAlreadyServing({ manifest, fetchImpl }),
        ['VS Code Marketplace', 'Open VSX'],
      );
    });

    test('reports only the registry that has it, so a partial release can be finished', async () => {
      const fetchImpl = async (url: string) => (url.includes('open-vsx')
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse(marketplacePayload('1.1.0')));

      assert.deepStrictEqual(
        await checker.registriesAlreadyServing({ manifest, fetchImpl }),
        ['VS Code Marketplace'],
      );
    });

    test('says nothing carries a version neither registry has', async () => {
      const fetchImpl = async (url: string) => (url.includes('open-vsx')
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse(marketplacePayload('1.0.2')));

      assert.deepStrictEqual(
        await checker.registriesAlreadyServing({ manifest, fetchImpl }),
        [],
      );
    });

    test('can be limited to one registry', async () => {
      const urls: string[] = [];
      const fetchImpl = async (url: string) => {
        urls.push(url);
        return jsonResponse(marketplacePayload('1.1.0'));
      };

      const serving = await checker.registriesAlreadyServing({
        manifest, registries: ['marketplace'], fetchImpl,
      });

      assert.deepStrictEqual(serving, ['VS Code Marketplace']);
      assert.strictEqual(urls.length, 1);
    });

    test('rejects a registry name it does not know', async () => {
      await assert.rejects(
        () => checker.registriesAlreadyServing({ manifest, registries: ['npm'], fetchImpl: async () => jsonResponse({}) }),
        /unknown registry "npm"/,
      );
    });
  });

  suite('readManifest', () => {
    test('reads the identity the registries key on', () => {
      const read = checker.readManifest();

      assert.strictEqual(read.publisher, 'teaqu');
      assert.strictEqual(read.name, 'shader-studio');
      assert.ok(/^\d+\.\d+\.\d+/.test(read.version), read.version);
    });
  });
});
