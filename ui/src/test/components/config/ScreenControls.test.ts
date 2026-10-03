import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScreenControls from '../../../lib/components/config/ScreenControls.svelte';
import type { AudioVideoController } from '../../../lib/AudioVideoController';

afterEach(cleanup);

describe('Screen capture errors', () => {
  it.each(['warning', 'exception'])('announces a capture %s prominently and clears it after retry', async mode => {
    const controlScreen = vi.fn().mockResolvedValue(undefined);
    if (mode === 'warning') {
      controlScreen.mockResolvedValueOnce('Screen sharing permission was denied.');
    } else {
      controlScreen.mockRejectedValueOnce(new Error('denied'));
    }
    const controller = { controlScreen, getLiveInputPreview: () => ({ ready: true }) } as unknown as AudioVideoController;
    const view = render(ScreenControls, { audioVideoController: controller });
    await fireEvent.click(view.getByRole('button', { name: 'Start screen sharing' }));
    const error = view.getByRole('alert');
    expect(error.textContent).toContain('Screen sharing failed');
    expect(error.textContent).toMatch(/permission/i);
    await fireEvent.click(view.getByRole('button', { name: 'Start screen sharing' }));
    expect(view.queryByRole('alert')).toBeNull();
  });
});
