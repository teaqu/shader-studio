import type { ShaderConfig } from "@shader-studio/types";

/**
 * A config as the viewer holds it: deep reactive state, whose nested objects
 * are proxies. Structured clone - what `postMessage` runs - refuses a proxy, so
 * anything that posts a config straight from the panel has to serialise it
 * first. Passing a plain object here would hide that.
 */
export function reactiveConfig(config: ShaderConfig): ShaderConfig {
  const reactive = $state(config);
  return reactive;
}
