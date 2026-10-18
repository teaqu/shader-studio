import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { archiveDownload } from '../lib/archiveDownload';

it('downloads multiple files with exact asset bytes and workspace paths', async () => {
  const files = [{ path: '/a.txt', asset: false }, { path: '/images/a.png', asset: true }, { path: '/other.txt', asset: false }];
  const contents = new Map([['/a.txt', 'hello λ'], ['/images/a.png', 'data:image/png;base64,AID/']]);
  const result = await archiveDownload(files, ['/a.txt', '/images/a.png'], async path => contents.get(path) ?? null);
  const zip = await JSZip.loadAsync(result.bytes);
  expect(result.name).toBe('files.zip');
  expect(await zip.file('a.txt')!.async('string')).toBe('hello λ');
  expect([...await zip.file('images/a.png')!.async('uint8array')]).toEqual([0, 128, 255]);
  expect(zip.file('other.txt')).toBeNull();
});

it('downloads folders recursively, including empty folders, without duplicates', async () => {
  const files = [{ path: '/assets', asset: false, directory: true }, { path: '/assets/empty', asset: false, directory: true }, { path: '/assets/nested/a.txt', asset: false }];
  const result = await archiveDownload(files, ['/assets', '/assets/nested/a.txt'], async () => 'source');
  const zip = await JSZip.loadAsync(result.bytes);
  expect(result.name).toBe('assets.zip');
  expect(zip.files['assets/empty/'].dir).toBe(true);
  expect(await zip.file('assets/nested/a.txt')!.async('string')).toBe('source');
});

it('rejects missing files and decodes non-base64 asset data', async () => {
  const files = [{ path: '/photo.svg', asset: true }];
  await expect(archiveDownload(files, ['/photo.svg'], async () => null)).rejects.toThrow('no longer exists');
  const result = await archiveDownload(files, ['/photo.svg'], async () => 'data:image/svg+xml,%3Csvg%2F%3E');
  expect(await (await JSZip.loadAsync(result.bytes)).file('photo.svg')!.async('string')).toBe('<svg/>');
});
