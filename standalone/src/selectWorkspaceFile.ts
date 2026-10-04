import type { VirtualWorkspace } from './VirtualWorkspace';
import { AUDIO_EXTENSIONS, CUBEMAP_EXTENSIONS, SCRIPT_EXTENSIONS, TEXTURE_EXTENSIONS, VIDEO_EXTENSIONS, shaderLanguageForPath } from '@shader-studio/types';
const assetExtensions: Record<string, string[]> = { script: SCRIPT_EXTENSIONS, texture: TEXTURE_EXTENSIONS, video: VIDEO_EXTENSIONS, audio: AUDIO_EXTENSIONS, cubemap: CUBEMAP_EXTENSIONS, model: ['glb'] };
export function selectableWorkspaceFile(path: string, fileType: string): boolean {
  const extensions = assetExtensions[fileType];
  return extensions ? extensions.includes(path.split('.').pop()?.toLowerCase() ?? '') : shaderLanguageForPath(path) === fileType.split('-')[0];
}
export async function selectWorkspaceFile(workspace: VirtualWorkspace, payload: Record<string, unknown>,
  choose: (paths: string[]) => Promise<string | null>, emit: (message: { type: string; payload: Record<string, unknown> }) => void): Promise<void> {
  const fileType = typeof payload.fileType === 'string' ? payload.fileType : '';
  const paths = workspace.list().map(file => file.path).filter(path => selectableWorkspaceFile(path, fileType)).sort();
  const selected = await choose(paths);
  const path = selected && paths.includes(selected) && workspace.exists(selected) ? selected : '';
  emit({ type: 'fileSelected', payload: { path, requestId: payload.requestId } });
}
