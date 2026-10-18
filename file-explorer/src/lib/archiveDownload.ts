import JSZip from 'jszip';
import type { WorkspaceFileEntry } from './FileExplorerHost';

/** Archive selected paths once, retaining their workspace-relative hierarchy. */
export async function archiveDownload(
  files: readonly WorkspaceFileEntry[], paths: readonly string[], read: (path: string) => Promise<string | null>,
): Promise<{ bytes: Uint8Array; name: string }> {
  const roots = paths.filter(path => !paths.some(other => other !== path && path.startsWith(`${other}/`)));
  const zip = new JSZip();
  for (const file of files.filter(file => roots.some(root => file.path === root || file.path.startsWith(`${root}/`)))) {
    const name = file.path.slice(1);
    if (file.directory) {
      zip.folder(name);
      continue;
    }
    const contents = await read(file.path);
    if (contents === null) {
      throw new Error(`File no longer exists: ${file.path}`);
    }
    if (file.asset) {
      const comma = contents.indexOf(',');
      const body = contents.slice(comma + 1);
      const binary = contents.slice(0, comma).endsWith(';base64');
      zip.file(name, binary ? body : decodeURIComponent(body), { base64: binary });
    } else {
      zip.file(name, contents);
    }
  }
  const name = roots.length === 1 ? `${roots[0].split('/').pop()}.zip` : 'files.zip';
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), name };
}
