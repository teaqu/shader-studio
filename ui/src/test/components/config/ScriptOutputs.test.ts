import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import { tick } from 'svelte';
import ScriptInfo from '../../../lib/components/config/ScriptInfo.svelte';
import { setScriptStreams } from '../../../lib/state/scriptStreams.svelte';
afterEach(() => {
  cleanup();
  setScriptStreams([]);
});
describe('Script outputs UI', () => {
  it('shows exact integers and expands fixed arrays into indexed values', async () => {
    const view = render(ScriptInfo, { filename: 'demo.js', uniforms: [{ name: 'counter', type: 'uint' }, { name: 'ids', type: 'uint[2]' }], uniformValues: { counter: 4294967295, ids: [123, 4294967295] } });
    expect(view.getByText('4294967295')).toBeTruthy();
    expect(view.queryByText('[0] 123')).toBeNull();
    const toggle = view.getByRole('button', { name: /2 elements/ });
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(view.getByText('[1] 4294967295')).toBeTruthy();
    await fireEvent.click(toggle);
    expect(view.queryByText('[1] 4294967295')).toBeNull();
  });
  it('reacts to shared stream queue status and clears stale streams', async () => {
    const view = render(ScriptInfo, { filename: 'demo.js' });
    expect(view.queryByRole('region', { name: 'Script streams' })).toBeNull();
    setScriptStreams([{ name: 'net', maxPerFrame: 4096, maxQueued: 65536, queued: 2048, lastFrame: 4096 }]);
    await tick();
    expect(view.getByRole('region', { name: 'Script streams' })).toBeTruthy();
    expect(view.getByText('2,048 words queued')).toBeTruthy();
    expect(view.getByText('Last frame: 4,096 words')).toBeTruthy();
    setScriptStreams([]);
    await tick();
    expect(view.queryByRole('region', { name: 'Script streams' })).toBeNull();
  });
});
