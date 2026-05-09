import type { Transport } from '../transport/MessageTransport';
import type { ProfileIndex, ProfileData } from '@shader-studio/types';

export class FileProfileAdapter {
  private pending = new Map<string, (msg: Record<string, unknown>) => void>();

  constructor(private transport: Transport) {
    transport.onMessage((event: MessageEvent) => {
      const m = event.data as Record<string, unknown>;
      const requestId = m?.requestId as string | undefined;
      if (requestId && this.pending.has(requestId)) {
        const resolve = this.pending.get(requestId)!;
        this.pending.delete(requestId);
        resolve(m);
      }
    });
  }

  private request<T extends Record<string, unknown>>(
    message: Record<string, unknown>
  ): Promise<T> {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve as (msg: Record<string, unknown>) => void);
      this.transport.postMessage({ ...message, requestId });
    });
  }

  async readIndex(): Promise<ProfileIndex | null> {
    const resp = await this.request<{ index: ProfileIndex | null }>({
      type: 'profile:readIndex',
    });
    return resp.index;
  }

  async readProfile(id: string): Promise<ProfileData | null> {
    const resp = await this.request<{ data: ProfileData | null }>({
      type: 'profile:readProfile',
      id,
    });
    return resp.data;
  }

  async writeProfile(id: string, data: ProfileData): Promise<void> {
    this.transport.postMessage({ type: 'profile:writeProfile', id, data });
  }

  async writeIndex(index: ProfileIndex): Promise<void> {
    this.transport.postMessage({ type: 'profile:writeIndex', index });
  }

  async deleteProfile(id: string): Promise<void> {
    this.transport.postMessage({ type: 'profile:deleteProfile', id });
  }
}
