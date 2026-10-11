import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigInput } from '@shader-studio/types';
import ChannelListItem from '../../../lib/components/config/ChannelListItem.svelte';
import ChannelPreview from '../../../lib/components/config/ChannelPreview.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('volume channel previews', () => {
  it('labels volume channels in the list', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

    render(ChannelListItem, {
      channelName: 'iChannel3',
      channelInput: { type: 'volume', path: 'density.ktx2' } as ConfigInput,
      getWebviewUri: () => undefined,
      onEdit: vi.fn(),
      onRemove: vi.fn(),
    });

    expect(screen.getByText('Volume')).toBeInTheDocument();
  });

  it.each([
    { resolved_path: 'webview://resolved/density.ktx2', mappedPath: 'webview://mapped/density.ktx2', expected: 'webview://resolved/density.ktx2' },
    { resolved_path: undefined, mappedPath: 'webview://mapped/density.ktx2', expected: 'webview://mapped/density.ktx2' },
    { resolved_path: undefined, mappedPath: undefined, expected: 'density.ktx2' },
  ])('uses $expected for a volume preview', async ({ resolved_path, mappedPath, expected }) => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404 }));
    const getWebviewUri = vi.fn(() => mappedPath);
    vi.stubGlobal('fetch', fetcher);

    render(ChannelPreview, {
      channelInput: { type: 'volume', path: 'density.ktx2', resolved_path } as ConfigInput,
      getWebviewUri,
    });

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    if (resolved_path) {
      expect(getWebviewUri).not.toHaveBeenCalled();
    } else {
      expect(getWebviewUri).toHaveBeenCalledWith('density.ktx2');
    }
  });
});
