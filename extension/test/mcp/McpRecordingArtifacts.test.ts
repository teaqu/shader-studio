import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { McpRecordingArtifacts } from '../../src/app/mcp/McpRecordingArtifacts';

const directories: string[] = [];
afterEach(async () => {
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
});
