import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveAudioInputs from '../../../lib/components/config/LiveAudioInputs.svelte';

const props = () => ({ getWebviewUri: vi.fn(), onSelect: vi.fn() });
beforeEach(() => vi.stubGlobal('acquireVsCodeApi', undefined));
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
});

describe('live audio inputs', () => {
  it.each([['Mic', 'microphone'], ['Shared Audio', 'system-audio']] as const)('selects %s with its existing saved type', async (label, type) => {
    const api = props();
    const view = render(LiveAudioInputs, api);
    await fireEvent.click(view.getByRole('button', { name: label }));
    expect(api.onSelect).toHaveBeenCalledWith({ type });
  });

  it.each([['Mic', 'microphone'], ['Shared Audio', 'system-audio']] as const)('disables %s in VS Code with browser guidance', async (label, type) => {
    vi.stubGlobal('acquireVsCodeApi', vi.fn());
    const api = props();
    const view = render(LiveAudioInputs, { ...api, input: { type } });
    const option = view.getByRole('button', { name: label });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.getAttribute('data-tooltip')).toContain('Open Shader Studio in a browser');
    await fireEvent.mouseEnter(option);
    await waitFor(() => expect(view.getByRole('tooltip').textContent).toContain('Open Shader Studio in a browser'));
    await fireEvent.click(option);
    expect(api.onSelect).not.toHaveBeenCalled();
    expect(view.queryByRole('button', { name: 'Open Capture Preview' })).toBeNull();
    expect(view.queryByRole('button', { name: /Start mic|Start sharing|Refresh devices/ })).toBeNull();
  });

  it('shows browser guidance on keyboard focus in VS Code', async () => {
    vi.stubGlobal('acquireVsCodeApi', vi.fn());
    const api = props();
    const view = render(LiveAudioInputs, api);
    const option = view.getByRole('button', { name: 'Mic' });
    await fireEvent.focus(option);
    await waitFor(() => expect(view.getByRole('tooltip').textContent).toContain('Open Shader Studio in a browser'));
  });
});
