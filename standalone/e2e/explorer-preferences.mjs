/** Mirrors the standalone app's persisted Explorer preference key. */
export const EXPLORER_STATE_KEY = 'shader-studio-explorer-state';

/** Runs in the page before boot; keeps any preference the test has already saved. */
export function seedExplorerState({ key, state, storage = globalThis.localStorage }) {
  if (storage.getItem(key) === null) {
    storage.setItem(key, JSON.stringify(state));
  }
}

/**
 * Active-file tracking (the standalone default) replaces the shared editor with
 * per-file editors. Tests that edit through the shared editor opt out first.
 */
export async function useSharedShaderEditor(pageOrContext) {
  await pageOrContext.addInitScript(seedExplorerState, { key: EXPLORER_STATE_KEY, state: { keepActiveShaderFiles: false } });
}
