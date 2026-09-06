import type { WorkspaceFileInfo } from '@shader-studio/types';
import type { Transport } from '../transport/MessageTransport';

export interface ViewerCapabilities {
  /** Compile-on-save needs a host with an explicit save step; shells that persist every edit have none. */
  compileOnSave: boolean;
}

/** Configure services before mounting the shared viewer. Shell UI lives in the host. */
export interface HostConfig {
  createTransport?: () => Transport;
  defaultAssets?: WorkspaceFileInfo[];
  capabilities?: Partial<ViewerCapabilities>;
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

export function getHostCapabilities(): ViewerCapabilities {
  return { compileOnSave: host.capabilities?.compileOnSave ?? true };
}
