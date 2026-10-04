import type { BufferPass } from '@shader-studio/types';
import type { ConfigManager } from '../ConfigManager';

export function addRenderPass(manager: ConfigManager | undefined, authoringMode: 'hooks' | 'native'): string | null {
  const name = manager?.addBuffer();
  if (!name || !manager) {
    return null;
  }
  const pass = manager.getConfig()?.passes[name] as BufferPass | undefined;
  if (authoringMode === 'native' && pass) {
    manager.updateBuffer(name, { ...pass, entryPoints: {} });
  }
  return name;
}
