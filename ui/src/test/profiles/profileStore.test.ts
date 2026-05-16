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

  it('init with no index writes nothing and uses in-memory defaults', async () => {
    const adapter = makeAdapter({ readIndex: vi.fn().mockResolvedValue(null) });
    const { init, getActiveProfile, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    expect(adapter.writeProfile).not.toHaveBeenCalled();
    expect(adapter.writeIndex).not.toHaveBeenCalled();
    expect(getActiveProfile()).toBe('default');
    expect(getProfileList()).toEqual([{ id: 'default', name: 'Default' }]);
  });

  it('switchTo reads new profile and updates activeProfile without saving current', async () => {
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
    vi.mocked(adapter.writeProfile).mockClear();
    await switchTo('wide-editor');
    expect(adapter.writeProfile).not.toHaveBeenCalled();
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

  it('saveProfile writes profile and index immediately', async () => {
    const adapter = makeAdapter();
    const { init, saveProfile } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    vi.mocked(adapter.writeProfile).mockClear();
    vi.mocked(adapter.writeIndex).mockClear();
    await saveProfile();
    expect(adapter.writeProfile).toHaveBeenCalledWith('default', expect.any(Object));
    expect(adapter.writeIndex).toHaveBeenCalledWith({ active: 'default', order: expect.any(Array) });
  });

  it('saveProfile does nothing before init', async () => {
    const adapter = makeAdapter();
    const { saveProfile } = await import('../../lib/state/profileStore.svelte');
    await saveProfile();
    expect(adapter.writeProfile).not.toHaveBeenCalled();
  });

  it('switchTo does not write current profile before switching', async () => {
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
    const { init, switchTo } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    vi.mocked(adapter.writeProfile).mockClear();
    await switchTo('wide-editor');
    expect(adapter.writeProfile).not.toHaveBeenCalled();
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

  it('reorderProfiles updates list and writes index', async () => {
    const twoProfileIndex: ProfileIndex = {
      active: 'default',
      order: [
        { id: 'default', name: 'Default' },
        { id: 'wide-editor', name: 'Wide editor' },
      ],
    };
    const adapter = makeAdapter({ readIndex: vi.fn().mockResolvedValue(twoProfileIndex) });
    const { init, reorderProfiles, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    const newOrder = [{ id: 'wide-editor', name: 'Wide editor' }, { id: 'default', name: 'Default' }];
    await reorderProfiles(newOrder);
    expect(getProfileList()).toEqual(newOrder);
    expect(adapter.writeIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: 'default', order: newOrder })
    );
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

  it('init calls requestRestore when profile data has a non-null layout', async () => {
    const { getPendingRestore, clearPendingRestore } = await import('../../lib/state/layoutState.svelte');
    const layoutData = { panels: { preview: { id: 'preview' } } } as any;
    const dataWithLayout: ProfileData = { ...defaultData, layout: layoutData };
    const adapter = makeAdapter({ readProfile: vi.fn().mockResolvedValue(dataWithLayout) });
    const { init } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    expect(getPendingRestore()).toEqual(layoutData);
    clearPendingRestore();
  });

  it('uniqueSlug appends counter when base slug already exists', async () => {
    const adapter = makeAdapter({
      readIndex: vi.fn().mockResolvedValue({
        active: 'default',
        order: [{ id: 'default', name: 'Default' }],
      }),
    });
    const { init, saveAs, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    // 'default' slug already taken — saveAs should use 'default-2'
    await saveAs('Default');
    const ids = getProfileList().map((p) => p.id);
    expect(ids).toContain('default-2');
    expect(adapter.writeProfile).toHaveBeenCalledWith('default-2', expect.any(Object));
  });

  it('saveAs does nothing when adapter is null (called before init)', async () => {
    const { saveAs, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await saveAs('New Profile');
    // No adapter set — list should be empty (uninitialised default)
    expect(getProfileList()).toHaveLength(0);
  });

  it('renameProfile does nothing when adapter is null (called before init)', async () => {
    const { renameProfile, getProfileList } = await import('../../lib/state/profileStore.svelte');
    await renameProfile('default', 'Renamed');
    expect(getProfileList()).toHaveLength(0);
  });

  it('switchTo does nothing when called with the already-active profile id', async () => {
    const adapter = makeAdapter();
    const { init, switchTo, getActiveProfile } = await import('../../lib/state/profileStore.svelte');
    await init(adapter);
    vi.mocked(adapter.readProfile).mockClear();
    await switchTo('default');
    expect(adapter.readProfile).not.toHaveBeenCalled();
    expect(getActiveProfile()).toBe('default');
  });
});
