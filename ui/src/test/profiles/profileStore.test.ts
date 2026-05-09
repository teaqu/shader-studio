import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileProfileAdapter } from '../../lib/profiles/FileProfileAdapter';
import type { ProfileIndex, ProfileData } from '@shader-studio/types';

const defaultData: ProfileData = {
  theme: 'dark', layout: null,
  configPanel: { isVisible: false },
  debugPanel: { isVisible: false, isVariableInspectorEnabled: false,
    isInlineRenderingEnabled: true, isPixelInspectorEnabled: true },
  performancePanel: { isVisible: false },
};

const defaultIndex: ProfileIndex = {
  active: 'default',
  order: [{ id: 'default', name: 'Default' }],
};

function makeAdapter(overrides: Partial<Record<keyof FileProfileAdapter, unknown>> = {}): FileProfileAdapter {
  return {
    readIndex: vi.fn().mockResolvedValue(defaultIndex),
    readProfile: vi.fn().mockResolvedValue(defaultData),
    writeProfile: vi.fn().mockResolvedValue(undefined),
    writeIndex: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as FileProfileAdapter;
}

describe('profileStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('init loads index and active profile', async () => {
    const adapter = makeAdapter();
    const { init, getActiveProfile, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    expect(adapter.readIndex).toHaveBeenCalled();
    expect(adapter.readProfile).toHaveBeenCalledWith('default');
    expect(getActiveProfile()).toBe('default');
    expect(getProfileList()).toEqual(defaultIndex.order);
  });

  it('init creates default profile when index is null (first run)', async () => {
    const adapter = makeAdapter({ readIndex: vi.fn().mockResolvedValue(null) });
    const { init, getActiveProfile } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    expect(adapter.writeProfile).toHaveBeenCalled();
    expect(adapter.writeIndex).toHaveBeenCalled();
    expect(getActiveProfile()).toBe('default');
  });

  it('switchTo saves current, reads new, updates activeProfile', async () => {
    const twoProfileIndex: ProfileIndex = {
      active: 'default',
      order: [
        { id: 'default', name: 'Default' },
        { id: 'wide-editor', name: 'Wide editor' },
      ],
    };
    const adapter = makeAdapter({
      readIndex: vi.fn().mockResolvedValue(twoProfileIndex),
    });
    const { init, switchTo, getActiveProfile } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    await switchTo('wide-editor');
    expect(adapter.writeProfile).toHaveBeenCalledWith('default', expect.any(Object));
    expect(adapter.readProfile).toHaveBeenCalledWith('wide-editor');
    expect(getActiveProfile()).toBe('wide-editor');
  });

  it('saveAs creates new profile, appends to list, sets active', async () => {
    const adapter = makeAdapter();
    const { init, saveAs, getProfileList, getActiveProfile } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    await saveAs('Wide editor');
    expect(adapter.writeProfile).toHaveBeenCalledWith('wide-editor', expect.any(Object));
    expect(adapter.writeIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.arrayContaining([
          expect.objectContaining({ id: 'wide-editor', name: 'Wide editor' }),
        ]),
      })
    );
    expect(getActiveProfile()).toBe('wide-editor');
  });

  it('renameProfile updates name in index', async () => {
    const adapter = makeAdapter();
    const { init, renameProfile, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    await renameProfile('default', 'My Layout');
    expect(adapter.writeIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.arrayContaining([
          expect.objectContaining({ name: 'My Layout' }),
        ]),
      })
    );
    expect(getProfileList()[0].name).toBe('My Layout');
  });

  it('deleteProfile removes profile and switches to first remaining', async () => {
    const twoProfileIndex: ProfileIndex = {
      active: 'wide-editor',
      order: [
        { id: 'default', name: 'Default' },
        { id: 'wide-editor', name: 'Wide editor' },
      ],
    };
    const adapter = makeAdapter({
      readIndex: vi.fn().mockResolvedValue(twoProfileIndex),
    });
    const { init, deleteProfile, getActiveProfile } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    await deleteProfile('wide-editor');
    expect(adapter.deleteProfile).toHaveBeenCalledWith('wide-editor');
    expect(getActiveProfile()).toBe('default');
  });

  it('deleteProfile does nothing when only one profile', async () => {
    const adapter = makeAdapter();
    const { init, deleteProfile, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    await deleteProfile('default');
    expect(adapter.deleteProfile).not.toHaveBeenCalled();
    expect(getProfileList()).toHaveLength(1);
  });

  it('scheduleProfileSave writes active profile after 500ms', async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter();
    const { init, scheduleProfileSave } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    vi.mocked(adapter.writeProfile).mockClear();
    scheduleProfileSave();
    expect(adapter.writeProfile).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(adapter.writeProfile).toHaveBeenCalledWith('default', expect.any(Object));
    vi.useRealTimers();
  });

  it('init with null readProfile does not throw and state still initialises', async () => {
    const adapter = makeAdapter({ readProfile: vi.fn().mockResolvedValue(null) });
    const { init, getActiveProfile, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    expect(getActiveProfile()).toBe('default');
    expect(getProfileList()).toEqual(defaultIndex.order);
  });

  it('switchTo with null readProfile does not call applyAll but updates activeProfile', async () => {
    const twoProfileIndex: ProfileIndex = {
      active: 'default',
      order: [
        { id: 'default', name: 'Default' },
        { id: 'wide-editor', name: 'Wide editor' },
      ],
    };
    const adapter = makeAdapter({
      readIndex: vi.fn().mockResolvedValue(twoProfileIndex),
      readProfile: vi.fn()
        .mockResolvedValueOnce(defaultData) // init call
        .mockResolvedValueOnce(null),       // switchTo call
    });
    const { init, switchTo, getActiveProfile } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    await switchTo('wide-editor');
    expect(getActiveProfile()).toBe('wide-editor');
  });

  it('deleteProfile of non-active profile removes it from list without switching', async () => {
    const twoProfileIndex: ProfileIndex = {
      active: 'default',
      order: [
        { id: 'default', name: 'Default' },
        { id: 'wide-editor', name: 'Wide editor' },
      ],
    };
    const adapter = makeAdapter({
      readIndex: vi.fn().mockResolvedValue(twoProfileIndex),
    });
    const { init, deleteProfile, getActiveProfile, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    const readCallsBefore = vi.mocked(adapter.readProfile).mock.calls.length;
    await deleteProfile('wide-editor');
    expect(adapter.deleteProfile).toHaveBeenCalledWith('wide-editor');
    expect(getActiveProfile()).toBe('default');
    expect(getProfileList()).toHaveLength(1);
    expect(getProfileList()[0].id).toBe('default');
    // readProfile should not be called again (no profile switch needed)
    expect(vi.mocked(adapter.readProfile).mock.calls.length).toBe(readCallsBefore);
    expect(adapter.writeIndex).toHaveBeenCalledWith(
      expect.objectContaining({ active: 'default', order: [{ id: 'default', name: 'Default' }] })
    );
  });
});
