import { afterEach, describe, expect, it, vi } from 'vitest';
import * as files from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { McpRecordingArtifacts } from '../../src/app/mcp/McpRecordingArtifacts';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, stat: vi.fn(original.stat) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-recording-'));
  directories.push(directory);
  return { directory, artifacts: new McpRecordingArtifacts(directory) };
}
function reader(bytes: Buffer) {
  return async (offset: number, count: number) => ({ offset, totalBytes: bytes.length, data: bytes.subarray(offset, offset + count).toString('base64') });
}

describe('MCP recording artifacts', () => {
  it('persists chunked videos privately and deduplicates concurrent status requests', async () => {
    const { artifacts } = await fixture();
    const data = Buffer.alloc(300_000, 42);
    const [first, second] = await Promise.all([
      artifacts.save('preview:job', 'video/webm', data.length, reader(data)),
      artifacts.save('preview:job', 'video/webm', data.length, reader(data)),
    ]);
    expect(first).toEqual(second);
    expect(first.uri).toBe(`shader-studio://recordings/${first.id}`);
    expect(await readFile(first.path)).toEqual(data);
    expect(await artifacts.read(first.id)).toEqual({ mimeType: 'video/webm', data: data.toString('base64') });
    await writeFile(first.path, 'changed');
    await expect(artifacts.read(first.id)).rejects.toThrow('size changed');
    await expect(artifacts.read('../secret')).rejects.toThrow('Unknown');
  });

  it('rejects unsupported, oversized, malformed and cancelled transfers without partial artifacts', async () => {
    const { artifacts, directory } = await fixture();
    const data = Buffer.from('video');
    await expect(artifacts.save('type', 'image/png', 5, reader(data))).rejects.toThrow('MP4');
    for (const size of [0, -1, 1.5, 32 * 1024 * 1024 + 1]) {
      await expect(artifacts.save(`size${size}`, 'video/mp4', size, reader(data))).rejects.toThrow('32 MiB');
    }
    const cancelled = AbortSignal.abort(new Error('cancelled'));
    await expect(artifacts.save('abort', 'video/mp4', 5, reader(data), cancelled)).rejects.toThrow('cancelled');
    for (const chunk of [
      { offset: 1, totalBytes: 5, data: 'dmlkZW8=' },
      { offset: 0, totalBytes: 6, data: 'dmlkZW8=' },
      { offset: 0, totalBytes: 5, data: 'x'.repeat(100) },
      { offset: 0, totalBytes: 5, data: 'bad' },
    ]) {
      await expect(artifacts.save('retry', 'video/mp4', 5, async () => chunk)).rejects.toThrow('Invalid recording chunk');
    }
    const controller = new AbortController();
    await expect(artifacts.save('midflight', 'video/mp4', 5, async () => {
      controller.abort(new Error('cancelled')); return reader(data)(0, 5);
    }, controller.signal)).rejects.toThrow('cancelled');
    expect(await readdir(directory)).toEqual([]);
    expect((await artifacts.save('retry', 'video/mp4', 5, reader(data))).mimeType).toBe('video/mp4');
  });

  it('retains only ten generated files and leaves unrelated files alone', async () => {
    const { artifacts, directory } = await fixture();
    await writeFile(path.join(directory, 'keep.txt'), 'keep');
    const ids = [];
    for (let index = 0; index < 12; index++) {
      ids.push((await artifacts.save(String(index), 'video/mp4', 1, reader(Buffer.from([index])))).id);
    }
    expect(await readdir(directory)).toHaveLength(11);
    await expect(artifacts.read(ids[0])).rejects.toThrow('expired');
  });

  it('cleans abandoned recording transfers on the next save while preserving recent transfers and unrelated files', async () => {
    const { directory } = await fixture();
    const abandoned = ['recording-dead.mp4.part', 'recording-beef.webm.part'];
    const preserved = ['recording-cafe.mp4.part', 'recording-feed.webm.part', 'unrelated.mp4.part'];
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const name of [...abandoned, ...preserved]) {
      const filePath = path.join(directory, name);
      await writeFile(filePath, 'partial');
      if (abandoned.includes(name) || name === 'unrelated.mp4.part') {
        await utimes(filePath, old, old);
      }
    }
    const directoryName = 'recording-ab.mp4.part';
    await mkdir(path.join(directory, directoryName));
    await utimes(path.join(directory, directoryName), old, old);

    // A new instance models the extension restarting after a crash.
    const restarted = new McpRecordingArtifacts(directory);
    const artifact = await restarted.save('after-restart', 'video/mp4', 1, async (offset, count) => {
      const names = await readdir(directory);
      expect(abandoned.every(name => !names.includes(name))).toBe(true);
      return reader(Buffer.from([1]))(offset, count);
    });
    expect((await readdir(directory)).sort()).toEqual([...preserved, directoryName, path.basename(artifact.path)].sort());
    expect(await restarted.read(artifact.id)).toMatchObject({ data: 'AQ==' });
  });

  it('continues saving if another window removes a partial file during the cleanup scan', async () => {
    const { artifacts, directory } = await fixture();
    const partialPath = path.join(directory, 'recording-dead.mp4.part');
    await writeFile(partialPath, 'partial');
    vi.mocked(files.stat).mockImplementationOnce(async () => {
      await rm(partialPath);
      throw Object.assign(new Error('File was removed'), { code: 'ENOENT' });
    });
    const artifact = await artifacts.save('concurrent-cleanup', 'video/mp4', 1, reader(Buffer.from([1])));
    expect(await artifacts.read(artifact.id)).toMatchObject({ data: 'AQ==' });
    expect(await readdir(directory)).toEqual([path.basename(artifact.path)]);
  });

  it('reports cleanup access failures and allows a later save to retry', async () => {
    const { artifacts, directory } = await fixture();
    const partialName = 'recording-dead.webm.part';
    await writeFile(path.join(directory, partialName), 'partial');
    vi.mocked(files.stat).mockRejectedValueOnce(Object.assign(new Error('Access denied'), { code: 'EACCES' }));
    await expect(artifacts.save('retry-cleanup', 'video/webm', 1, reader(Buffer.from([1])))).rejects.toThrow('Access denied');
    expect(await readdir(directory)).toEqual([partialName]);
    const artifact = await artifacts.save('retry-cleanup', 'video/webm', 1, reader(Buffer.from([1])));
    expect(await artifacts.read(artifact.id)).toMatchObject({ data: 'AQ==' });
  });
});
