import type { ScriptStreamFrame, ScriptStreamInfo, ScriptStreamQueueStatus } from '@shader-studio/types';
export interface ScriptStreamRequest {
    session: number;
    request: number;
    consumer: string;
    release?: boolean; status?: boolean;
    acknowledgedSequence?: number;
}
/** One bounded frame in flight. Consumption happens only after GPU submission. */
export class ScriptStreamDelivery {
  info: ScriptStreamInfo[] = [];
  private consumer = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  private statusRequest = 0;
  private acceptedStatusRequest = 0;
  private lastFrame = new Map<string, number>();
  private queued = new Map<string, number>();
  private session = 0;
  private request = 0;
  private waiting = false;
  private pending: ScriptStreamFrame | null = null;
  private acknowledge: number | undefined;
  private send: ((request: ScriptStreamRequest) => void) | undefined;
  configure(info: ScriptStreamInfo[], session: number, send: (request: ScriptStreamRequest) => void): void {
    this.dispose();
    this.info = info.map(stream => ({ ...stream }));
    this.session = session;
    this.send = send;
  }
  refreshStatus(): void {
    if (this.info.length) {
      this.send?.({ session: this.session, consumer: this.consumer, request: ++this.statusRequest, status: true });
    }
  }
  receiveStatus(status: ScriptStreamQueueStatus): void {
    if (status.session !== this.session || status.consumer !== this.consumer || (status.request <= this.acceptedStatusRequest || status.request > this.statusRequest)) {
      return;
    }
    this.acceptedStatusRequest = status.request;
    for (const info of this.info) {
      const queued = status.streams.find(stream => stream.name === info.name)?.queued;
      if (queued !== undefined && Number.isInteger(queued) && queued >= 0 && queued <= info.maxQueued) {
        this.queued.set(info.name, queued);
      }
    }
  }
  receive(frame: ScriptStreamFrame, request: number): boolean {
    if (!this.waiting || frame.session !== this.session || request !== this.request || frame.sequence <= (this.acknowledge ?? 0)) {
      return false;
    }
    if (frame.streams.length !== this.info.length || this.info.some(info => {
      const chunks = frame.streams.filter(chunk => chunk.name === info.name);
      return chunks.length !== 1 || chunks[0].data.length > info.maxPerFrame || chunks[0].data.some(word => !Number.isInteger(word) || word < 0 || word > 4294967295);
    })) {
      return false;
    }
    this.waiting = false;
    this.pending = frame;
    for (const chunk of frame.streams) {
      this.queued.set(chunk.name, chunk.queued);
    }
    return true;
  }
  prepare(write: (name: string, data: Uint32Array) => void, consume: boolean): void {
    for (const info of this.info) {
      const chunk = consume ? this.pending?.streams.find(chunk => chunk.name === info.name) : undefined;
      const words = new Uint32Array(1 + (chunk?.data.length ?? 0));
      words[0] = chunk?.data.length ?? 0;
      if (chunk) {
        words.set(chunk.data, 1);
      }
      write(info.name, words);
    }
    if (consume && !this.pending && !this.waiting && this.info.length) {
      this.requestNext();
    }
  }
  submitted(consume: boolean): void {
    if (!consume || !this.pending) {
      return;
    }
    for (const chunk of this.pending.streams) {
      this.lastFrame.set(chunk.name, chunk.data.length);
      this.queued.set(chunk.name, Math.max(0, chunk.queued - chunk.data.length));
    }
    this.acknowledge = this.pending.sequence;
    this.pending = null;
    this.requestNext();
  }
  private requestNext(): void {
    this.waiting = true;
    this.send?.({ session: this.session, request: ++this.request, consumer: this.consumer, acknowledgedSequence: this.acknowledge });
  }
  status() {
    return this.info.map(info => ({ ...info, queued: this.queued.get(info.name) ?? 0, lastFrame: this.lastFrame.get(info.name) ?? 0 }));
  }
  reset(): void {
    this.acceptedStatusRequest = ++this.statusRequest;
    this.lastFrame.clear();
    this.queued.clear();
    this.request++;
    this.waiting = false;
    this.pending = null;
    this.acknowledge = undefined;
  }
  dispose(): void {
    if (this.info.length) {
      this.send?.({ session: this.session, request: ++this.request, consumer: this.consumer, release: true });
    }
    this.reset();
    this.info = [];
    this.send = undefined;
  }
}
