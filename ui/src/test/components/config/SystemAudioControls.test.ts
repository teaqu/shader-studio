import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SystemAudioControls from '../../../lib/components/config/SystemAudioControls.svelte';
import type { AudioVideoController } from '../../../lib/AudioVideoController';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function controller() {
  return { controlSystemAudio: vi.fn().mockResolvedValue(undefined), getLiveInputPreview: vi.fn().mockReturnValue({ ready: true }) };
}

function devices() {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn().mockResolvedValue([{ kind: 'audioinput', deviceId: 'loopback', label: 'Loopback Audio' }]) } });
}

describe('system audio controls', () => {
  it('starts browser sharing from a click and supports routed app audio', async () => {
    devices();
    const api = controller();
    const { getByRole, getByLabelText } = render(SystemAudioControls, { audioVideoController: api as unknown as AudioVideoController });
    await tick();
    expect(api.controlSystemAudio).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Start sharing' }));
    expect(api.controlSystemAudio).toHaveBeenCalledWith('start', undefined);
    await tick();
    await fireEvent.change(getByLabelText('Audio source'), { target: { value: 'loopback' } });
    await fireEvent.click(getByRole('button', { name: 'Start sharing' }));
    expect(api.controlSystemAudio).toHaveBeenCalledWith('start', 'loopback');
  });

  it('shows actionable capture warnings', async () => {
    devices();
    const api = controller();
    api.controlSystemAudio.mockResolvedValue('Choose Share audio');
    const { getByRole } = render(SystemAudioControls, { audioVideoController: api as unknown as AudioVideoController });
    await fireEvent.click(getByRole('button', { name: 'Start sharing' }));
    expect(getByRole('status').textContent).toContain('Choose Share audio');
  });

  it('stops active sharing and leaves reconnection manual', async () => {
    devices();
    const api = controller();
    api.getLiveInputPreview.mockReturnValue({ ready: true, frequency: new Uint8Array(512) });
    const { getByRole } = render(SystemAudioControls, { audioVideoController: api as unknown as AudioVideoController });
    await tick();
    expect(getByRole('button', { name: 'Change sharing' })).toBeTruthy();
    await fireEvent.click(getByRole('button', { name: 'Stop sharing' }));
    expect(api.controlSystemAudio).toHaveBeenCalledWith('stop');
  });
});
