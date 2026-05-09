import { describe, it, expect, vi } from 'vitest';
import { FileProfileAdapter } from '../../lib/profiles/FileProfileAdapter';
import type { ProfileIndex, ProfileData } from '@shader-studio/types';

// Mock transport matching the real Transport interface.
// onMessage receives (event: MessageEvent) => void, so we fire MessageEvents.
function makeTransport() {
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  const postMessage = vi.fn((msg: Record<string, unknown>) => {
    // Simulate async extension response for read messages
    setTimeout(() => {
      if (!messageHandler) {
        return;
      }
      if (msg.type === 'profile:readIndex') {
        messageHandler(
          new MessageEvent('message', {
            data: { type: 'profile:indexData', requestId: msg.requestId, index: null },
          })
        );
      } else if (msg.type === 'profile:readProfile') {
        messageHandler(
          new MessageEvent('message', {
            data: { type: 'profile:profileData', requestId: msg.requestId, data: null },
          })
        );
      }
    }, 0);
  });

  const transport = {
    postMessage,
    onMessage: vi.fn((handler: (event: MessageEvent) => void) => {
      messageHandler = handler;
    }),
    dispose: vi.fn(),
    getType: vi.fn(() => 'vscode' as const),
    isConnected: vi.fn(() => true),
  };

  return { transport, postMessage };
}

describe('FileProfileAdapter', () => {
  it('readIndex resolves with index from response', async () => {
    const { transport } = makeTransport();
    const adapter = new FileProfileAdapter(transport);
    const result = await adapter.readIndex();
    expect(transport.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'profile:readIndex' })
    );
    expect(result).toBeNull();
  });

  it('readProfile sends id and resolves with data', async () => {
    const { transport } = makeTransport();
    const adapter = new FileProfileAdapter(transport);
    const result = await adapter.readProfile('default');
    expect(transport.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'profile:readProfile', id: 'default' })
    );
    expect(result).toBeNull();
  });

  it('writeProfile sends fire-and-forget', async () => {
    const { transport } = makeTransport();
    const adapter = new FileProfileAdapter(transport);
    const data = {
      theme: 'dark',
      layout: null,
      configPanel: { isVisible: false },
      debugPanel: {
        isVisible: false,
        isVariableInspectorEnabled: false,
        isInlineRenderingEnabled: true,
        isPixelInspectorEnabled: true,
      },
      performancePanel: { isVisible: false },
    } as ProfileData;
    await adapter.writeProfile('default', data);
    expect(transport.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'profile:writeProfile', id: 'default', data })
    );
  });

  it('writeIndex sends index', async () => {
    const { transport } = makeTransport();
    const adapter = new FileProfileAdapter(transport);
    const index: ProfileIndex = { active: 'default', order: [] };
    await adapter.writeIndex(index);
    expect(transport.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'profile:writeIndex', index })
    );
  });

  it('deleteProfile sends id', async () => {
    const { transport } = makeTransport();
    const adapter = new FileProfileAdapter(transport);
    await adapter.deleteProfile('wide-editor');
    expect(transport.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'profile:deleteProfile', id: 'wide-editor' })
    );
  });

  it('concurrent reads resolve independently by requestId', async () => {
    let handlers: Array<(event: MessageEvent) => void> = [];
    const sentMessages: Record<string, unknown>[] = [];

    const transport = {
      postMessage: vi.fn((msg: Record<string, unknown>) => {
        sentMessages.push(msg);
      }),
      onMessage: vi.fn((handler: (event: MessageEvent) => void) => {
        handlers.push(handler);
      }),
      dispose: vi.fn(),
      getType: vi.fn(() => 'vscode' as const),
      isConnected: vi.fn(() => true),
    };

    const adapter = new FileProfileAdapter(transport);

    const p1 = adapter.readIndex();
    const p2 = adapter.readIndex();

    // Extract the requestIds from the sent messages
    const [msg1, msg2] = sentMessages as Array<{ type: string; requestId: string }>;
    expect(msg1.requestId).not.toBe(msg2.requestId);

    const index1: ProfileIndex = { active: 'a', order: [] };
    const index2: ProfileIndex = { active: 'b', order: [] };

    // Respond in reverse order to prove independent resolution
    for (const handler of handlers) {
      handler(
        new MessageEvent('message', {
          data: { type: 'profile:indexData', requestId: msg2.requestId, index: index2 },
        })
      );
      handler(
        new MessageEvent('message', {
          data: { type: 'profile:indexData', requestId: msg1.requestId, index: index1 },
        })
      );
    }

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(index1);
    expect(r2).toEqual(index2);
  });
});
