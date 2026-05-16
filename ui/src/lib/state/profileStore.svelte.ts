import type { FileProfileAdapter } from '../profiles/FileProfileAdapter';
import { slugify } from '@shader-studio/types';
import type { ProfileIndex, ProfileData } from '@shader-studio/types';
import { snapshotConfigPanel, applyConfigPanelProfile } from '../stores/configPanelStore';
import { snapshotDebugPanel, applyDebugPanelProfile } from '../stores/debugPanelStore';
import { snapshotPerformancePanel, applyPerformancePanelProfile } from '../stores/performancePanelStore';
import { snapshotTheme, applyThemeProfile } from '../stores/themeStore';
import { getCurrentLayout, requestRestore } from './layoutState.svelte';
import { isVSCodeEnvironment } from '../transport/TransportFactory';

let _activeProfile = $state<string>('default');
let _profileList = $state<Array<{ id: string; name: string }>>([]);
let _adapter: FileProfileAdapter | null = null;
let _initialized = false;

export function getActiveProfile(): string {
  return _activeProfile; 
}
export function getProfileList(): Array<{ id: string; name: string }> {
  return _profileList; 
}

function snapshotAll(): ProfileData {
  return {
    theme: snapshotTheme(),
    layout: getCurrentLayout(),
    configPanel: snapshotConfigPanel(),
    debugPanel: snapshotDebugPanel(),
    performancePanel: snapshotPerformancePanel(),
  };
}

function applyAll(data: ProfileData): void {
  if (!isVSCodeEnvironment()) {
    applyThemeProfile(data.theme);
  }
  applyConfigPanelProfile(data.configPanel);
  applyDebugPanelProfile(data.debugPanel);
  applyPerformancePanelProfile(data.performancePanel);
  if (data.layout) {
    requestRestore(data.layout);
  }
}

function uniqueSlug(base: string, existingIds: string[]): string {
  let slug = slugify(base);
  let counter = 2;
  while (existingIds.includes(slug)) {
    slug = `${slugify(base)}-${counter++}`;
  }
  return slug;
}


export async function init(adapter: FileProfileAdapter): Promise<void> {
  _adapter = adapter;
  const index: ProfileIndex | null = await adapter.readIndex();

  if (index) {
    _profileList = index.order;
    _activeProfile = index.active;
    const data = await adapter.readProfile(index.active);
    if (data) {
      applyAll(data);
    }
  } else {
    _profileList = [{ id: 'default', name: 'Default' }];
    _activeProfile = 'default';
  }

  _initialized = true;
}

export async function switchTo(id: string): Promise<void> {
  if (!_adapter || id === _activeProfile) {
    return;
  }
  const data = await _adapter.readProfile(id);
  if (data) {
    applyAll(data);
  }
  _activeProfile = id;
  await _adapter.writeIndex({ active: id, order: _profileList });
}

export async function saveProfile(): Promise<void> {
  if (!_adapter || !_initialized) {
    return;
  }
  await _adapter.writeProfile(_activeProfile, snapshotAll());
  await _adapter.writeIndex({ active: _activeProfile, order: _profileList });
}

export async function saveAs(name: string): Promise<void> {
  if (!_adapter) {
    return;
  }
  const id = uniqueSlug(name, _profileList.map(p => p.id));
  const data = snapshotAll();
  await _adapter.writeProfile(id, data);
  const newOrder = [..._profileList, { id, name }];
  _profileList = newOrder;
  _activeProfile = id;
  await _adapter.writeIndex({ active: id, order: newOrder });
}

export async function renameProfile(id: string, newName: string): Promise<void> {
  if (!_adapter) {
    return;
  }
  const newOrder = _profileList.map(p => p.id === id ? { ...p, name: newName } : p);
  _profileList = newOrder;
  await _adapter.writeIndex({ active: _activeProfile, order: newOrder });
}

export async function reorderProfiles(newOrder: Array<{ id: string; name: string }>): Promise<void> {
  if (!_adapter) return;
  _profileList = newOrder;
  await _adapter.writeIndex({ active: _activeProfile, order: newOrder });
}

export async function deleteProfile(id: string): Promise<void> {
  if (!_adapter || _profileList.length <= 1) {
    return;
  }
  await _adapter.deleteProfile(id);
  const newOrder = _profileList.filter(p => p.id !== id);
  _profileList = newOrder;
  if (_activeProfile === id) {
    const data = await _adapter.readProfile(newOrder[0].id);
    if (data) {
      applyAll(data);
    }
    _activeProfile = newOrder[0].id;
    await _adapter.writeIndex({ active: newOrder[0].id, order: newOrder });
  } else {
    await _adapter.writeIndex({ active: _activeProfile, order: newOrder });
  }
}

