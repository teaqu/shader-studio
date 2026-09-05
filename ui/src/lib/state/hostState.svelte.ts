import type { Component } from 'svelte';
import type { WorkspaceFileInfo } from '@shader-studio/types';
import type { Transport } from '../transport/MessageTransport';

/**
 * Capabilities supplied by whichever shell embeds the viewer.
 *
 * The viewer itself is host-agnostic: it never asks which build it is running
 * in, only whether the surrounding host offers a given capability. The VS Code
 * and websocket hosts leave these unset; the standalone web host
 * (`@shader-studio/web-host`) fills them in before mounting.
 */
/** A panel contributed by the embedding shell. */
export interface HostPanel {
  /** Stable id, also used as the dock panel id. */
  id: string;
  /** Tab title. */
  title: string;
  /** Rendered into the panel body. */
  component: Component<any>;
  /** Where to dock it, relative to an existing panel. */
  position?: {
    referencePanel: string;
    direction: 'left' | 'right' | 'above' | 'below';
  };
  initialWidth?: number;
  maximumWidth?: number;
}

export interface HostConfig {
  /** Overrides the transport the viewer would otherwise pick for itself. */
  createTransport?: () => Transport;
  /** Rendered when the host asks the viewer to create a new shader. */
  newShaderModal?: Component<any>;
  /** Extra assets offered by the host alongside the workspace's own files. */
  defaultAssets?: WorkspaceFileInfo[];
  /** Shown as a documentation link when the host provides one. */
  docsUrl?: string;
  /** Enables the "clear workspace" action. */
  supportsClearWorkspace?: boolean;
  /**
   * Extra panels the shell contributes to the viewer's layout. The viewer
   * renders each component and hands it to the dock; what they contain and
   * how they are laid out is entirely the shell's business.
   */
  panels?: HostPanel[];
  /** Banner shown above the preview, e.g. an alpha warning from the shell. */
  notice?: string;
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

export function getHostNewShaderModal(): Component<any> | undefined {
  return host.newShaderModal;
}

export function getHostDefaultAssets(): WorkspaceFileInfo[] {
  return host.defaultAssets ?? [];
}

export function getHostDocsUrl(): string | undefined {
  return host.docsUrl;
}

export function getHostSupportsClearWorkspace(): boolean {
  return host.supportsClearWorkspace ?? false;
}

export function getHostPanels(): HostPanel[] {
  return host.panels ?? [];
}

export function getHostNotice(): string | undefined {
  return host.notice;
}
