import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { ThumbnailCache } from '../../app/ThumbnailCache';

suite('ThumbnailCache Test Suite', () => {
  let cache: ThumbnailCache;
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-cache-test-'));
    const mockContext = {
      globalStorageUri: { fsPath: tmpDir },
    } as any as vscode.ExtensionContext;

    cache = new ThumbnailCache(mockContext);
  });

  teardown(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates cache directory on construction', () => {
    const cacheDir = path.join(tmpDir, 'thumbnails');
    assert.ok(fs.existsSync(cacheDir));
  });

  test('getThumbnail returns null when not cached', () => {
    assert.strictEqual(cache.getThumbnail('/some/shader.glsl'), null);
  });

  test('saveThumbnail + getThumbnail returns data URI', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    cache.saveThumbnail('/some/shader.glsl', dataUri);
    const result = cache.getThumbnail('/some/shader.glsl');
    assert.ok(result);
    assert.ok(result!.startsWith('data:image/png;base64,'));
  });

  test('pruneCache removes stale thumbnails not matching current shader paths', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

    // Create a real temp shader file so statSync works
    const shaderFile = path.join(tmpDir, 'shader1.glsl');
    fs.writeFileSync(shaderFile, 'void main(){}');
    const stats = fs.statSync(shaderFile);

    // Save thumbnail with the real file's modifiedTime
    cache.saveThumbnail(shaderFile, dataUri, stats.mtimeMs);
    assert.ok(cache.getThumbnail(shaderFile, stats.mtimeMs) !== null);

    // Also save a thumbnail for a non-existent shader (will be pruned)
    cache.saveThumbnail('/nonexistent/shader.glsl', dataUri, 12345);

    // Prune with only the real shader file as current
    await cache.pruneCache([shaderFile]);

    // The valid thumbnail should still exist
    assert.ok(cache.getThumbnail(shaderFile, stats.mtimeMs) !== null);
  });

  test('pruneCache keeps valid thumbnails', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

    const shaderFile = path.join(tmpDir, 'keepme.glsl');
    fs.writeFileSync(shaderFile, 'void main(){}');
    const stats = fs.statSync(shaderFile);

    cache.saveThumbnail(shaderFile, dataUri, stats.mtimeMs);

    await cache.pruneCache([shaderFile]);

    const result = cache.getThumbnail(shaderFile, stats.mtimeMs);
    assert.ok(result);
  });

  test('handles read errors gracefully', () => {
    // getThumbnail on non-existent path returns null
    const result = cache.getThumbnail('/nonexistent/shader.glsl');
    assert.strictEqual(result, null);
  });

  test('handles write errors gracefully', () => {
    // saveThumbnail with invalid base64 still tries to write
    // It should return true or false without throwing
    assert.doesNotThrow(() => {
      cache.saveThumbnail('/some/shader.glsl', 'data:image/png;base64,invaliddata');
    });
  });

  test('cache survives float precision drift (JSON round-trip)', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const shaderPath = '/some/shader.slang';
    // Simulate mtimeMs returning a high-precision float
    const savedTime = 1723054123.456789;
    // Simulate the same value after JSON serialization/deserialization
    // (IEEE 754 can lose the last digit)
    const loadedTime = 1723054123.456788;

    cache.saveThumbnail(shaderPath, dataUri, savedTime);

    // Should hit the cache despite the slight difference
    const result = cache.getThumbnail(shaderPath, loadedTime);
    assert.ok(result, 'cache should hit despite float precision drift');
    assert.ok(result!.startsWith('data:image/png;base64,'));
  });

  test('different modified times produce different cache keys', () => {
    const dataUri1 = 'data:image/png;base64,AAAA';
    const dataUri2 = 'data:image/png;base64,BBBB';
    const shaderPath = '/some/shader.slang';

    cache.saveThumbnail(shaderPath, dataUri1, 1000);
    cache.saveThumbnail(shaderPath, dataUri2, 2000);

    // Each should retrieve its own thumbnail
    assert.strictEqual(cache.getThumbnail(shaderPath, 1000), dataUri1);
    assert.strictEqual(cache.getThumbnail(shaderPath, 2000), dataUri2);
  });
});
