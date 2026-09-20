import { addShaderFiles, readWorkspaceFiles } from './workspace-store.mjs';

/** Add `/shaders/<name>` files when `entries` is given, and return the whole
 * workspace as a path → contents map either way. */
export async function workspace(page, entries) {
  const files = entries ? await addShaderFiles(page, entries) : await readWorkspaceFiles(page);
  return Object.fromEntries(files.map(file => [file.path, file.contents]));
}
