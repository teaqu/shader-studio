import { addShaderFiles, readWorkspaceFiles } from './workspace-store.mjs';
import { expect } from '@playwright/test';

/** Add `/shaders/<name>` files when `entries` is given, and return the whole
 * workspace as a path → contents map either way. */
export async function workspace(page, entries) {
  const files = entries ? await addShaderFiles(page, entries) : await readWorkspaceFiles(page);
  return Object.fromEntries(files.map(file => [file.path, file.contents]));
}

/** Wait for the editor's current document and workspace context to reach its language service. */
export async function waitForLanguageService(editor) {
  await expect(editor.locator('.editor-wrapper')).toHaveAttribute('data-language-service-status', 'ready', { timeout: 20_000 });
}
