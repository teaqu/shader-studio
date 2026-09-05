/**
 * Library surface for shells that embed the shader viewer.
 *
 * The viewer is also built as a webview entry (`ui/index.html`) for the VS
 * Code extension's `ui-dist`; this entry is what an external shell such as
 * `@shader-studio/standalone` imports instead.
 */
export { default as ShaderStudioApp } from './App.svelte';
export { configureHost, resetHost } from './lib/state/hostState.svelte';
export type { HostConfig, ViewerCapabilities } from './lib/state/hostState.svelte';
export type {
  ShaderExplorerHostApi,
  Transport,
  TransportMessage,
} from './lib/transport/MessageTransport';

export { getViewerSession } from './lib/state/viewerSession.svelte';
export type { ViewerSession } from './lib/state/viewerSession.svelte';
export { default as ShaderEditor } from './lib/components/ShaderEditor.svelte';
export { getSlangAssetUrls } from './lib/slangAssets';
