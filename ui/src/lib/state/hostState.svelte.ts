import type { WorkspaceFileInfo } from '@shader-studio/types';
import type { Transport } from '../transport/MessageTransport';

export interface ViewerCapabilities {
  /** Compile-on-save needs a host with an explicit save step; shells that persist every edit have none. */
  compileOnSave: boolean;
}

export interface HostEditorPreferences {
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: 'off' | 'on';
  minimap: boolean;
  lineNumbers: 'on' | 'off';
  autoSuggestions?: boolean;
  desktopDescriptions?: boolean;
  mobileDescriptions?: boolean;
  mobileNavigation?: boolean;
  mobileShaderBackdrop?: boolean;
  overlayOpacity?: number;
  /** The editor selected for desktop-sized viewports by the standalone host. */
  desktopEditor?: 'monaco' | 'codemirror';
  /** The editor selected for mobile-sized viewports by the standalone host. */
  mobileEditor?: 'monaco' | 'codemirror';
}

/** Configure services before mounting the shared viewer. Shell UI lives in the host. */
export interface HostConfig {
  createTransport?: () => Transport;
  defaultAssets?: WorkspaceFileInfo[];
  capabilities?: Partial<ViewerCapabilities>;
  getEditorPreferences?: () => HostEditorPreferences;
  setEditorWordWrap?: (value: HostEditorPreferences['wordWrap']) => void;
  setEditorAutoSuggestions?: (enabled: boolean) => void;
  setEditorDescriptions?: (mobile: boolean, enabled: boolean) => void;
  setEditorMobileNavigation?: (enabled: boolean) => void;
  setEditorMobileShaderBackdrop?: (enabled: boolean) => void;
  setEditorOverlayOpacity?: (opacity: number) => void;
  getPreviewEditorEnabled?: () => boolean;
  uploadAssets?: (files: readonly File[], shaderPath: string) => Promise<WorkspaceFileInfo[]>;
}

let host = $state<HostConfig>({});

export function configureHost(config: HostConfig): void {
  host = config;
}

export function resetHost(): void {
  host = {};
}

export function getHostTransportFactory(): (() => Transport) | undefined {
  return host.createTransport;
}

export function getHostDefaultAssets(): WorkspaceFileInfo[] {
  return host.defaultAssets ?? [];
}

export function getHostAssetUploader(): HostConfig['uploadAssets'] {
  return host.uploadAssets;
}

export function getHostCapabilities(): ViewerCapabilities {
  return { compileOnSave: host.capabilities?.compileOnSave ?? true };
}

/** Optional so VS Code keeps the established editor defaults. */
export function getHostEditorPreferences(): (() => HostEditorPreferences) | undefined {
  return host.getEditorPreferences;
}

/** A wrap shortcut is available when the shell can persist editor preferences. */
export function getHostEditorWordWrap(): HostEditorPreferences['wordWrap'] | undefined {
  return host.setEditorWordWrap ? host.getEditorPreferences?.().wordWrap : undefined;
}

export function toggleHostEditorWordWrap(): void {
  const current = getHostEditorWordWrap();
  if (current !== undefined) {
    host.setEditorWordWrap?.(current === 'on' ? 'off' : 'on');
  }
}

/** Auto-suggestions can be changed when the host owns a writable preference. */
export function getHostEditorAutoSuggestions(): boolean | undefined {
  const preferences = host.getEditorPreferences?.();
  return host.setEditorAutoSuggestions && preferences ? preferences.autoSuggestions ?? true : undefined;
}

export function toggleHostEditorAutoSuggestions(): void {
  const current = getHostEditorAutoSuggestions();
  if (current !== undefined) {
    host.setEditorAutoSuggestions?.(!current);
  }
}

export function editorDescriptionsEnabled(preferences: HostEditorPreferences | undefined, mobile: boolean): boolean {
  return mobile ? preferences?.mobileDescriptions ?? false : preferences?.desktopDescriptions ?? true;
}

export function getHostEditorDescriptions(mobile: boolean): boolean | undefined {
  const preferences = host.getEditorPreferences?.();
  return host.setEditorDescriptions && preferences ? editorDescriptionsEnabled(preferences, mobile) : undefined;
}

export function toggleHostEditorDescriptions(mobile: boolean): void {
  const current = getHostEditorDescriptions(mobile);
  if (current !== undefined) {
    host.setEditorDescriptions?.(mobile, !current);
  }
}

export function getHostEditorMobileNavigation(): boolean | undefined {
  const preferences = host.getEditorPreferences?.();
  return host.setEditorMobileNavigation && preferences ? preferences.mobileNavigation ?? true : undefined;
}

export function toggleHostEditorMobileNavigation(): void {
  const current = getHostEditorMobileNavigation();
  if (current !== undefined) {
    host.setEditorMobileNavigation?.(!current);
  }
}

export function getHostEditorMobileShaderBackdrop(): boolean | undefined {
  const preferences = host.getEditorPreferences?.();
  return host.setEditorMobileShaderBackdrop && preferences ? preferences.mobileShaderBackdrop ?? false : undefined;
}

export function toggleHostEditorMobileShaderBackdrop(): void {
  const current = getHostEditorMobileShaderBackdrop();
  if (current !== undefined) host.setEditorMobileShaderBackdrop?.(!current);
}

export function isHostPreviewEditorEnabled(): boolean {
  return host.getPreviewEditorEnabled?.() ?? true;
}

export function getHostEditorOverlayOpacity(): number | undefined {
  const preferences = host.getEditorPreferences?.();
  return host.setEditorOverlayOpacity && preferences ? preferences.overlayOpacity ?? 75 : undefined;
}

export function setHostEditorOverlayOpacity(opacity: number): void {
  if (getHostEditorOverlayOpacity() !== undefined && Number.isFinite(opacity)) {
    host.setEditorOverlayOpacity?.(Math.max(0, Math.min(100, Math.round(opacity))));
  }
}
