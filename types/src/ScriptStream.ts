export interface ScriptStreamOptions {
    maxPerFrame?: number;
    maxQueued?: number;
}
export interface ScriptStreamInfo {
    name: string;
    maxPerFrame: number;
    maxQueued: number;
}
export interface ScriptStreamChunk {
    name: string;
    data: number[];
    queued: number;
}
export interface ScriptStreamFrame {
    session: number;
    sequence: number;
    streams: ScriptStreamChunk[];
}
/** Bounded FIFO. A leased chunk stays queued until a rendered frame acknowledges it. */
export class ScriptStream {
  readonly maxPerFrame: number;
  readonly maxQueued: number;
  private chunks: number[][] = [];
  private offset = 0;
  private size = 0;
  private active = true;
  private consumers = new Set<ScriptStream>();
  constructor(options: ScriptStreamOptions = {}) {
    this.maxPerFrame = options.maxPerFrame ?? 4096;
    this.maxQueued = options.maxQueued ?? Math.max(65536, this.maxPerFrame);
    if (!Number.isInteger(this.maxPerFrame) || this.maxPerFrame < 1 || this.maxPerFrame > 65536 ||
            !Number.isInteger(this.maxQueued) || this.maxQueued < this.maxPerFrame || this.maxQueued > 1048576) {
      throw new Error('Stream limits require 1–65536 words per frame and a queue up to 1048576 words, at least one frame');
    }
  }
  get queued(): number {
    return this.consumers.size ? Math.max(...[...this.consumers].map(stream => stream.queued)) : this.size;
  }
  push(data: ArrayLike<number>): boolean {
    if (!this.active) {
      return false;
    }
    if (!data || !Number.isSafeInteger(data.length) || data.length < 0) {
      throw new Error('Stream push expects uint32 words');
    }
    if (data.length > this.maxQueued - this.queued) {
      return false;
    }
    const copy: number[] = [];
    for (let index = 0; index < data.length; index++) {
      const word = data[index];
      if (!Number.isInteger(word) || word < 0 || word > 4294967295) {
        throw new Error('Stream push expects uint32 words');
      }
      copy.push(word);
    }
    if (copy.length) {
      if (this.consumers.size) {
        for (const stream of this.consumers) {
          stream.append(copy);
        }
      } else {
        this.append(copy);
      }
    }
    return true;
  }
  private append(copy: number[]): void {
    this.chunks.push(copy);
    this.size += copy.length;
  }
  /** Each preview has its own cursor; immutable chunks are shared across cursors. */
  fork(): ScriptStream {
    const consumer = new ScriptStream({ maxPerFrame: this.maxPerFrame, maxQueued: this.maxQueued });
    if (this.consumers.size === 0) {
      consumer.chunks = this.chunks;
      consumer.offset = this.offset;
      consumer.size = this.size;
      this.chunks = [];
      this.offset = 0;
      this.size = 0;
    }
    this.consumers.add(consumer);
    return consumer;
  }
  release(consumer: ScriptStream): void {
    this.consumers.delete(consumer);
    consumer.dispose();
  }
  peek(): number[] {
    const out: number[] = [];
    for (let chunk = 0; chunk < this.chunks.length && out.length < this.maxPerFrame; chunk++) {
      const values = this.chunks[chunk];
      for (let index = chunk === 0 ? this.offset : 0; index < values.length && out.length < this.maxPerFrame; index++) {
        out.push(values[index]);
      }
    }
    return out;
  }
  consume(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > this.size) {
      throw new Error('Invalid stream acknowledgement');
    }
    this.size -= count;
    while (count > 0) {
      const available = this.chunks[0].length - this.offset;
      const taken = Math.min(count, available);
      this.offset += taken;
      count -= taken;
      if (this.offset === this.chunks[0].length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
  }
  clear(): void {
    this.chunks = [];
    this.offset = 0;
    this.size = 0;
    for (const stream of this.consumers) {
      stream.clear();
    }
  }
  dispose(): void {
    this.clear();
    this.active = false;
    for (const stream of this.consumers) {
      stream.dispose();
    }
    this.consumers.clear();
  }
}

export interface ScriptStreamQueueStatus {
  session: number;
  consumer: string;
  request: number;
  streams: { name: string; queued: number }[];
}
