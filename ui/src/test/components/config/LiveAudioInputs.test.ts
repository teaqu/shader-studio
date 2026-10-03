import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LiveAudioInputs from '../../../lib/components/config/LiveAudioInputs.svelte';

const props = () => ({ getWebviewUri: vi.fn(), onSelect: vi.fn(), postMessage: vi.fn() });
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
});

describe('live audio inputs', () => {
  it.each([['Mic', 'microphone'], ['Browser Audio', 'system-audio']] as const)('selects %s with its existing saved type', async (label, type) => {
    const api = props();
    const view = render(LiveAudioInputs, api);
    await fireEvent.click(view.getByRole('button', { name: label }));
    expect(api.onSelect).toHaveBeenCalledWith({ type });
  });

  it.each(['microphone', 'system-audio'] as const)('opens the VS Code capture preview for %s', async type => {
    vi.stubGlobal('acquireVsCodeApi', vi.fn());
    const api = props();
    const view = render(LiveAudioInputs, { ...api, input: { type } });
    await fireEvent.click(view.getByRole('button', { name: 'Open Capture Preview' }));
    expect(api.postMessage).toHaveBeenCalledWith({ type: 'extensionCommand', payload: { command: 'openCapturePreview' } });
  });
});
