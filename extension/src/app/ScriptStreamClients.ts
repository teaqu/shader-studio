import type { ScriptStreamFrame } from '@shader-studio/types';
interface StreamProvider {
  getScriptStreamQueues?(session: number, consumer: string): { name: string; queued: number }[] | null;
    requestScriptStreamFrame(session: number, acknowledgedSequence?: number, consumer?: string): ScriptStreamFrame | null;
    releaseScriptStreamConsumer(session: number, consumer: string): void;
}
/** Owns preview cursors so disconnects cannot leave a producer permanently backpressured. */
export class ScriptStreamClients {
  private clients = new Map<object, {
        session: number;
        consumer: string;
    }>();
  constructor(private provider: StreamProvider) { }
  handle(payload: unknown, respond: (message: unknown) => void, owner: object): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const { session, request, acknowledgedSequence, consumer, release, status } = payload as Record<string, unknown>;
    if (typeof session !== 'number' || !Number.isSafeInteger(session) || session < 1 ||
            typeof request !== 'number' || !Number.isSafeInteger(request) || request < 1 ||
            (acknowledgedSequence !== undefined && (typeof acknowledgedSequence !== 'number' || !Number.isSafeInteger(acknowledgedSequence) || acknowledgedSequence < 1)) ||
            typeof consumer !== 'string' || consumer.length < 1 || consumer.length > 128) {
      return;
    }
    if (status === true) {
      const streams = this.provider.getScriptStreamQueues?.(session, consumer);
      if (streams) {
        respond({type: 'scriptStreamStatus', payload: {session, consumer, request, streams}});
      }
      return;
    }
    if (release === true) {
      const current = this.clients.get(owner);
      if (current?.session === session && current.consumer === consumer) {
        this.release(owner);
      }
      return;
    }
    try {
      const frame = this.provider.requestScriptStreamFrame(session, acknowledgedSequence as number | undefined, consumer);
      if (!frame) {
        return;
      }
      const previous = this.clients.get(owner);
      if (previous && (previous.session !== session || previous.consumer !== consumer)) {
        this.release(owner);
      }
      this.clients.set(owner, { session, consumer });
      respond({ type: 'scriptStreamFrame', payload: { frame, request } });
    } catch (error) {
      respond({ type: 'error', payload: [`Script streams: ${String(error)}`] });
    }
  }
  release(owner: object): void {
    const client = this.clients.get(owner);
    if (client) {
      this.provider.releaseScriptStreamConsumer(client.session, client.consumer);
      this.clients.delete(owner);
    }
  }
}
