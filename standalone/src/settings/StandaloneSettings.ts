export const SETTINGS_STORAGE_KEY = 'shader-studio.standalone.settings';
export const CAMERA_STORAGE_KEY = 'shader-studio.webgpu.useViewerCamera';

export const DEFAULT_SETTINGS = Object.freeze({
  'webgpu.useViewerCamera': true,
  'languageServers.glsl.enabled': true,
  'languageServers.slang.enabled': true,
  'languageServers.wgsl.enabled': true,
  'editor.colorDecorators': true,
  'navigateOnBufferSwitch': true,
  'editor.fontSize': 14,
  'editor.tabSize': 4,
  'editor.insertSpaces': true,
  'editor.wordWrap': 'off' as 'off' | 'on',
  'editor.minimap.enabled': false,
  'editor.lineNumbers': 'on' as 'off' | 'on',
});
export type StandaloneSettingsValues = { -readonly [K in keyof typeof DEFAULT_SETTINGS]: typeof DEFAULT_SETTINGS[K] extends boolean ? boolean : typeof DEFAULT_SETTINGS[K] extends number ? number : typeof DEFAULT_SETTINGS[K] };
export type StandaloneSettingKey = keyof StandaloneSettingsValues;
type StorageBackend = Pick<Storage, 'getItem' | 'setItem'>;

function availableStorage(): StorageBackend | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function valid(key: StandaloneSettingKey, value: unknown): boolean {
  if (key === 'editor.fontSize' || key === 'editor.tabSize') {
    return typeof value === 'number' && Number.isInteger(value)
      && value >= (key === 'editor.fontSize' ? 8 : 1) && value <= (key === 'editor.fontSize' ? 40 : 8);
  }
  if (key === 'editor.wordWrap' || key === 'editor.lineNumbers') {
    return value === 'off' || value === 'on';
  }
  return typeof value === 'boolean';
}

/** Browser-wide preferences, independent of workspace files and shader overrides. */
export class StandaloneSettings {
  private values: Readonly<StandaloneSettingsValues>;
  private readonly listeners = new Set<(values: Readonly<StandaloneSettingsValues>) => void>();

  constructor(private readonly storage: StorageBackend | undefined = availableStorage()) {
    const values: StandaloneSettingsValues = { ...DEFAULT_SETTINGS };
    try {
      values['webgpu.useViewerCamera'] = storage?.getItem(CAMERA_STORAGE_KEY) !== 'false';
      const saved: unknown = JSON.parse(storage?.getItem(SETTINGS_STORAGE_KEY) ?? 'null');
      if (saved && typeof saved === 'object' && 'version' in saved && saved.version === 1
        && 'values' in saved && saved.values && typeof saved.values === 'object') {
        for (const key of Object.keys(DEFAULT_SETTINGS) as StandaloneSettingKey[]) {
          const value: unknown = Reflect.get(saved.values, key);
          if (valid(key, value)) {
            Object.assign(values, { [key]: value });
          }
        }
      }
    } catch { /* Invalid or inaccessible storage uses defaults for this session. */ }
    this.values = Object.freeze(values);
  }

  get snapshot(): Readonly<StandaloneSettingsValues> {
    return this.values;
  }

  update(key: StandaloneSettingKey, value: unknown): boolean {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key) || !valid(key, value)) {
      return false;
    }
    if (this.values[key] !== value) {
      this.publish({ ...this.values, [key]: value });
    }
    return true;
  }

  reloadFromStorage(): void {
    this.publish({ ...new StandaloneSettings(this.storage).snapshot }, false);
  }

  reset(): void {
    this.publish({ ...DEFAULT_SETTINGS });
  }

  subscribe(listener: (values: Readonly<StandaloneSettingsValues>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(values: StandaloneSettingsValues, persist = true): void {
    this.values = Object.freeze(values);
    try {
      if (persist) {
        this.storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values }));
        this.storage?.setItem(CAMERA_STORAGE_KEY, String(values['webgpu.useViewerCamera']));
      }
    } catch { /* Preferences still apply when browser storage is unavailable. */ }
    for (const listener of this.listeners) {
      listener(this.values);
    }
  }
}
