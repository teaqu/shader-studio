import { describe, expect, it, vi } from 'vitest';

import { createRetryableLoader } from '../lib/retryableLoader';

describe('createRetryableLoader', () => {
  it('shares an in-flight load and retries after rejection', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('WASM unavailable'))
      .mockResolvedValueOnce('module');
    const loader = createRetryableLoader(load);

    const first = loader();
    const shared = loader();
    await expect(first).rejects.toThrow('WASM unavailable');
    await expect(shared).rejects.toThrow('WASM unavailable');
    await expect(loader()).resolves.toBe('module');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
