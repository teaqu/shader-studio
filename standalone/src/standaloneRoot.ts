import type { VirtualWorkspace } from './VirtualWorkspace';

const MIGRATED = '/.shader-studio/root-layout-v1';
const PREFIX = '/shaders/';

/** Remove the legacy standalone wrapper once, without overwriting root files. */
export async function migrateStandaloneRoot(workspace: VirtualWorkspace): Promise<void> {
  if (workspace.exists(MIGRATED)) {
    return;
  }
  const files = workspace.list('/shaders');
  const conflict = files.some(file => {
    const target = file.path.slice('/shaders'.length);
    const parts = target.slice(1).split('/');
    return workspace.exists(target) || workspace.list(target).length > 0
      || parts.slice(0, -1).some((_, index) => workspace.exists(`/${parts.slice(0, index + 1).join('/')}`));
  });
  if (!conflict) {
    for (const file of files) {
      workspace.rename(file.path, file.path.slice('/shaders'.length));
    }
    for (const file of workspace.list()) {
      if (!file.contents.startsWith('data:') && !file.path.startsWith('/.shader-studio/')) {
        const contents = file.contents.replaceAll(PREFIX, '/');
        if (contents !== file.contents) {
          workspace.writeText(file.path, contents);
        }
      }
    }
    for (const file of workspace.list('/.shader-studio/folders')) {
      if (file.contents === '/shaders') {
        workspace.delete(file.path);
      } else if (file.contents.startsWith(PREFIX)) {
        const path = file.contents.slice('/shaders'.length);
        workspace.delete(file.path);
        workspace.writeText(`/.shader-studio/folders/${encodeURIComponent(path)}`, path);
      }
    }
  }
  workspace.writeText(MIGRATED, '1');
  await workspace.flush();
}
