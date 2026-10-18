import type { VirtualWorkspace } from './VirtualWorkspace';
import { assertWorkspaceFolder, workspaceFolderExists, workspaceUserPath } from './workspaceFiles';

const textExtension = /\.(glsl|frag|vert|comp|slang|wgsl|json|js|ts|txt|csv)$/i;
const assetMimeTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
};

function readUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.onload = () => {
      const contents = String(reader.result);
      if (textExtension.test(file.name)) {
        resolve(contents);
      } else {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        const mime = assetMimeTypes[extension] ?? (file.type || 'application/octet-stream');
        resolve(contents.replace(/^data:[^;]*;/, `data:${mime};`));
      }
    };
    if (textExtension.test(file.name)) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  });
}

/** Read and validate the whole selection before adding anything. Existing
 * files keep their names and contents, so config references stay intact. */
export async function uploadWorkspaceFiles(workspace: VirtualWorkspace, files: readonly File[], directory = '/'): Promise<string[]> {
  const base = directory === '/' ? '' : workspaceUserPath(directory);
  assertWorkspaceFolder(workspace, base);
  const paths = new Set<string>();
  const uploads = await Promise.all(files.map(async file => {
    if (!file.name || /[/\\\x00-\x1f]/.test(file.name) || file.name === '.' || file.name === '..') {
      throw new Error('Choose files with valid names.');
    }
    const path = workspaceUserPath(`${base}/${file.name}`);
    if (paths.has(path) || workspace.exists(path) || workspaceFolderExists(workspace, path)) {
      throw new Error(`File already exists: ${file.name}. Rename it before uploading. No files were added.`);
    }
    paths.add(path);
    return { path, contents: await readUpload(file) };
  }));
  // Another upload can finish while these files are being read.
  if (uploads.some(file => workspace.exists(file.path) || workspaceFolderExists(workspace, file.path))) {
    throw new Error('An uploaded filename is now in use. No files were added.');
  }
  for (const file of uploads) {
    workspace.writeText(file.path, file.contents);
  }
  await workspace.flush();
  return uploads.map(file => file.path);
}
