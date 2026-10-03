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
  return { controlAudioInput: vi.fn().mockResolvedValue(undefined), controlSystemAudio: vi.fn().mockResolvedValue(undefined), getLiveInputPreview: vi.fn().mockReturnValue({ ready: true } as { ready: boolean; deviceId?: string; frequency?: Uint8Array }) };
}

function devices() {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn().mockResolvedValue([{ kind: 'audioinput', deviceId: 'loopback', label: 'Loopback Audio' }]) } });
}

describe('system audio controls', () => {
  it('starts browser sharing without offering audio input devices', async () => {
    devices();
    const api = controller();
    const { getByRole, queryByLabelText } = render(SystemAudioControls, { audioVideoController: api as unknown as AudioVideoController });
    expect(queryByLabelText('Audio device')).toBeNull();
    expect(api.controlSystemAudio).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Start sharing' }));
    expect(api.controlSystemAudio).toHaveBeenCalledWith('start');
    expect(api.controlAudioInput).not.toHaveBeenCalled();
  });

  it('offers microphones and loopback devices under Audio without browser sharing', async () => {
    devices();
    const api = controller();
    const { getByRole, getByLabelText, queryByRole, findByRole } = render(SystemAudioControls, { type: 'microphone', audioVideoController: api as unknown as AudioVideoController });
    await findByRole('option', { name: 'Loopback Audio' });
    expect(queryByRole('option', { name: /Browser/ })).toBeNull();
    await fireEvent.change(getByLabelText('Audio device'), { target: { value: 'loopback' } });
    await fireEvent.click(getByRole('button', { name: 'Start audio' }));
    expect(api.controlAudioInput).toHaveBeenCalledWith('start', 'loopback');
    expect(api.controlSystemAudio).not.toHaveBeenCalled();
  });

  it('shows the current device when reopening Audio and does not auto-start capture', async () => {
    devices();
    const api = controller();
    api.getLiveInputPreview.mockReturnValue({ ready: true, deviceId: 'loopback' });
    const { findByRole, getByLabelText } = render(SystemAudioControls, { type: 'microphone', audioVideoController: api as unknown as AudioVideoController });
    await findByRole('option', { name: 'Loopback Audio' });
    expect((getByLabelText('Audio device') as HTMLSelectElement).value).toBe('loopback');
    expect(api.controlAudioInput).not.toHaveBeenCalled();
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
