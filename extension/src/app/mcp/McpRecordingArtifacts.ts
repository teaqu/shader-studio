import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import * as path from 'node:path';

const MAX_BYTES = 32 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const artifactName = /^recording-[a-f0-9-]+\.(mp4|webm)$/;
const partialArtifactName = /^recording-[a-f0-9-]+\.(mp4|webm)\.part$/;
const PARTIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface RecordingArtifact {
  id: string;
  path: string;
  uri: string;
  mimeType: 'video/mp4' | 'video/webm';
  bytes: number;
}

export interface RecordingChunk {
  offset: number;
  totalBytes: number;
  data: string;
}

/** Copies bounded viewer video chunks into private, locally accessible artifacts. */
export class McpRecordingArtifacts {
  private readonly saved = new Map<string, Promise<RecordingArtifact>>();
  private readonly artifacts = new Map<string, RecordingArtifact>();
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string) {}

  save(
    key: string,
    mimeType: string,
    bytes: number,
    readChunk: (offset: number, count: number) => Promise<RecordingChunk>,
    signal?: AbortSignal,
  ): Promise<RecordingArtifact> {
    const previous = this.saved.get(key);
    if (previous) {
      return previous;
    }
    // Retention and publication share a directory; commit one artifact at a time.
    const pending = this.writes.then(() => this.copy(mimeType, bytes, readChunk, signal)).catch(error => {
      this.saved.delete(key);
      throw error;
    });
    this.writes = pending.catch(() => undefined);
    this.saved.set(key, pending);
    // Keep only recent lookup keys; files have a separate on-disk retention cap.
    if (this.saved.size > 10) {
      this.saved.delete(this.saved.keys().next().value!);
    }
    return pending;
  }

  async read(id: string): Promise<{ mimeType: string; data: string }> {
    const artifact = this.artifacts.get(id);
    if (!artifact) {
      throw new Error('Unknown or expired recording artifact. Call get_recording again.');
    }
    const info = await stat(artifact.path);
    if (info.size !== artifact.bytes || info.size > MAX_BYTES) {
      throw new Error('Recording artifact size changed.');
    }
    return { mimeType: artifact.mimeType, data: (await readFile(artifact.path)).toString('base64') };
  }

  private async copy(
    mimeType: string,
    bytes: number,
    readChunk: (offset: number, count: number) => Promise<RecordingChunk>,
    signal?: AbortSignal,
  ): Promise<RecordingArtifact> {
    if (mimeType !== 'video/mp4' && mimeType !== 'video/webm') {
      throw new Error('Recording must be MP4 or WebM.');
    }
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) {
      throw new Error('Recording must contain between 1 byte and 32 MiB.');
    }
    signal?.throwIfAborted();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.prune();
    signal?.throwIfAborted();
    const id = randomUUID();
    const filePath = path.join(this.directory, `recording-${id}.${mimeType.slice(6)}`);
    const temporaryPath = `${filePath}.part`;
    const file = await open(temporaryPath, 'wx', 0o600);
    try {
      for (let offset = 0; offset < bytes;) {
        signal?.throwIfAborted();
        const count = Math.min(CHUNK_BYTES, bytes - offset);
        const chunk = await readChunk(offset, count);
        signal?.throwIfAborted();
        if (chunk.offset !== offset || chunk.totalBytes !== bytes || typeof chunk.data !== 'string'
          || chunk.data.length > 4 * Math.ceil(count / 3)) {
          throw new Error('Invalid recording chunk metadata.');
        }
        const data = Buffer.from(chunk.data, 'base64');
        if (data.length !== count || data.toString('base64') !== chunk.data) {
          throw new Error('Invalid recording chunk data.');
        }
        await file.writeFile(data);
        offset += data.length;
      }
    } catch (error) {
      await file.close();
      await unlink(temporaryPath);
      throw error;
    }
    await file.close();
    await rename(temporaryPath, filePath);
    const artifact: RecordingArtifact = { id, path: filePath, uri: `shader-studio://recordings/${id}`, mimeType, bytes };
    this.artifacts.set(id, artifact);
    await this.prune();
    return artifact;
  }

  private async prune(): Promise<void> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    const candidates = entries.filter(entry => entry.isFile() && (artifactName.test(entry.name) || partialArtifactName.test(entry.name)));
    const files = (await Promise.all(candidates.map(async entry => {
      const filePath = path.join(this.directory, entry.name);
      try {
        return { filePath, partial: partialArtifactName.test(entry.name), modified: (await stat(filePath)).mtimeMs };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    }))).filter(file => file !== null);
    // Another extension host can be writing in this directory. Only remove
    // partial transfers old enough to be abandoned, never a recent transfer.
    const expiredBefore = Date.now() - PARTIAL_MAX_AGE_MS;
    for (const file of files.filter(file => file.partial && file.modified < expiredBefore)) {
      await rm(file.filePath, { force: true });
    }
    const completed = files.filter(file => !file.partial).sort((a, b) => b.modified - a.modified);
    for (const file of completed.slice(10)) {
      await rm(file.filePath, { force: true });
      for (const [id, artifact] of this.artifacts) {
        if (artifact.path === file.filePath) {
          this.artifacts.delete(id);
        }
      }
    }
  }
}
