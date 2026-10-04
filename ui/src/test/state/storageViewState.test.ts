import { describe, expect, it } from 'vitest';
import { getStorageView, selectStorageBuffer, selectStorageField, selectStorageTab } from '../../lib/state/storageViewState.svelte';
describe('Storage view state', () => {
  it('remembers each buffer field and isolates shader workspaces', () => {
    expect(getStorageView('first')).toEqual({ selected: '', tab: 'settings', fields: {} });
    selectStorageBuffer('first', 'particles');
    selectStorageTab('first', 'inspect');
    selectStorageField('first', 'particles', 'velocity');
    selectStorageBuffer('first', 'counters');
    selectStorageField('first', 'counters', 'value');
    expect(getStorageView('first')).toEqual({ selected: 'counters', tab: 'inspect', fields: { particles: 'velocity', counters: 'value' } });
    expect(getStorageView('second').selected).toBe('');
    selectStorageBuffer('first', 'particles');
    expect(getStorageView('first').fields.particles).toBe('velocity');
  });
});
