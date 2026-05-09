import type { FileProfileAdapter } from '../profiles/FileProfileAdapter';
import { slugify, defaultProfileData } from '@shader-studio/types';
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
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

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

function migrateFromLocalStorage(): ProfileData {
  if (typeof localStorage === 'undefined') {
    return defaultProfileData();
  }
  const candidates = ['electron', 'vscode', 'vscode:1', 'web:1'];
  for (const slot of candidates) {
    try {
      const raw = localStorage.getItem(`shader-studio-dockview-layout:${slot}`);
      if (!raw) {
        continue;
      }
      const saved = JSON.parse(raw);
      const layout = saved?.activeLayout ?? null;
      const data = defaultProfileData();
      data.layout = layout;
      const configRaw = localStorage.getItem(`shader-studio-config-panel-state:${slot}`);
      if (configRaw) {
        const c = JSON.parse(configRaw);
        data.configPanel.isVisible = c?.isVisible ?? false;
      }
      const debugRaw = localStorage.getItem(`shader-studio-debug-panel-state:${slot}`);
      if (debugRaw) {
        const d = JSON.parse(debugRaw);
        data.debugPanel = { ...data.debugPanel, ...d };
      }
      const perfRaw = localStorage.getItem(`shader-studio-performance-panel-state:${slot}`);
      if (perfRaw) {
        const p = JSON.parse(perfRaw);
        data.performancePanel.isVisible = p?.isVisible ?? false;
      }
      const themeRaw = localStorage.getItem('shader-studio-theme');
      if (themeRaw === 'light' || themeRaw === 'dark') {
        data.theme = themeRaw;
      }
      return data;
    } catch {
      continue;
    }
  }
  return defaultProfileData();
}

export async function init(adapter: FileProfileAdapter): Promise<void> {
  _adapter = adapter;
  let index: ProfileIndex | null = await adapter.readIndex();

  if (!index) {
    const data = migrateFromLocalStorage();
    await adapter.writeProfile('default', data);
    index = { active: 'default', order: [{ id: 'default', name: 'Default' }] };
    await adapter.writeIndex(index);
  }

  _profileList = index.order;
  _activeProfile = index.active;

  const data = await adapter.readProfile(index.active);
  if (data) {
    applyAll(data);
  }
  _initialized = true;
}

export async function switchTo(id: string): Promise<void> {
  if (!_adapter || id === _activeProfile) {
    return;
  }
  await _adapter.writeProfile(_activeProfile, snapshotAll());
  const data = await _adapter.readProfile(id);
  if (data) {
    applyAll(data);
  }
  _activeProfile = id;
  await _adapter.writeIndex({ active: id, order: _profileList });
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

export function scheduleProfileSave(): void {
  if (!_initialized || !_adapter) {
    return;
  }
  if (_saveTimer) {
    clearTimeout(_saveTimer);
  }
  _saveTimer = setTimeout(async () => {
    _saveTimer = null;
    if (_adapter && _activeProfile) {
      await _adapter.writeProfile(_activeProfile, snapshotAll());
    }
  }, 500);
}
