import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScreenControls from '../../../lib/components/config/ScreenControls.svelte';
import type { AudioVideoController } from '../../../lib/AudioVideoController';

afterEach(cleanup);

describe('Screen capture errors', () => {
  it('disables capture until a controller and ready input are available', async () => {
    const view = render(ScreenControls);
    const button = view.getByRole('button', { name: 'Start screen sharing' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(button);
    const controlScreen = vi.fn();
    const controller = { controlScreen, getLiveInputPreview: () => null } as unknown as AudioVideoController;
    await view.rerender({ audioVideoController: controller });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(controlScreen).not.toHaveBeenCalled();
  });

  it('stops an active screen and displays warnings from the stop action', async () => {
    const controlScreen = vi.fn().mockResolvedValueOnce('Sharing ended unexpectedly').mockResolvedValue(undefined);
    const controller = { controlScreen, getLiveInputPreview: () => ({ ready: true, video: document.createElement('video') }) } as unknown as AudioVideoController;
    const view = render(ScreenControls, { audioVideoController: controller });
    expect(view.getByRole('button', { name: 'Change screen' })).toBeDefined();
    await fireEvent.click(view.getByRole('button', { name: 'Stop screen sharing' }));
    expect(controlScreen).toHaveBeenCalledWith('stop');
    expect(view.getByRole('alert').textContent).toContain('Sharing ended unexpectedly');
    await fireEvent.click(view.getByRole('button', { name: 'Stop screen sharing' }));
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('keeps one permission request in flight and clears the busy state when it completes', async () => {
    let finish!: (value: undefined) => void;
    const controlScreen = vi.fn(() => new Promise<undefined>(resolve => {
      finish = resolve;
    }));
    const controller = { controlScreen, getLiveInputPreview: () => ({ ready: true }) } as unknown as AudioVideoController;
    const view = render(ScreenControls, { audioVideoController: controller });
    await fireEvent.click(view.getByRole('button', { name: 'Start screen sharing' }));
    const busy = view.getByRole('button', { name: /^Connecting/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(busy);
    expect(controlScreen).toHaveBeenCalledOnce();
    finish(undefined);
    await Promise.resolve();
    expect((await view.findByRole('button', { name: 'Start screen sharing' }) as HTMLButtonElement).disabled).toBe(false);
  });
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
