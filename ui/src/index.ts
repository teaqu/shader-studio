/**
 * Library surface for shells that embed the shader viewer.
 *
 * The viewer is also built as a standalone app (`ui/index.html`) for the VS
 * Code extension's `ui-dist`; this entry is what an external shell such as
 * `@shader-studio/web-host` imports instead.
 */
export { default as ShaderStudioApp } from './App.svelte';
export { configureHost, resetHost } from './lib/state/hostState.svelte';
export type { HostConfig } from './lib/state/hostState.svelte';
export type {
  ShaderExplorerHostApi,
  Transport,
  TransportMessage,
} from './lib/transport/MessageTransport';
