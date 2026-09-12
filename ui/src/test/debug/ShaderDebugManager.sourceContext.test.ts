import { describe, expect, it, vi } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';

const sources = {
  glsl: 'float helper() {\n  float shade = 0.375;\n  return shade;\n}',
  slang: 'float helper() {\n  float shade = 0.375;\n  return shade;\n}',
  wgsl: 'fn helper() -> f32 {\n  let shade = 0.375;\n  return shade;\n}',
};

describe('debug function context follows source arrival', () => {
  it.each(['glsl', 'slang', 'wgsl'] as const)('%s refreshes ownership without another cursor event', language => {
    const manager = new ShaderDebugManager();
    manager.setLanguage(language);
    manager.setShaderContext(null, `/image.${language}`, {});
    manager.toggleEnabled();
    manager.updateDebugLine(1, sources[language].split('\n')[1], `/image.${language}`);
    expect(manager.getState().functionContext).toBeNull();
    manager.setImageShaderCode(sources[language]);
    expect(manager.getState().functionContext).toMatchObject({ functionName: 'helper' });
    // The selected statement has not changed, but its enclosing function has.
    manager.setImageShaderCode(sources[language].replace('helper', 'renamed'));
    expect(manager.getState().functionContext).toMatchObject({ functionName: 'renamed' });
    manager.setImageShaderCode('');
    expect(manager.getState().functionContext).toBeNull();
  });

  it('does not notify or clear parameter overrides for an unchanged source', () => {
    const manager = new ShaderDebugManager();
    manager.setLanguage('slang');
    const source = 'float helper(float p) {\n  return p;\n}';
    manager.setImageShaderCode(source);
    manager.updateDebugLine(1, '  return p;', '/image.slang');
    manager.setCustomParameter(0, '0.75');
    const notify = vi.fn();
    manager.setStateCallback(notify);
    manager.setImageShaderCode(source);
    expect(notify).not.toHaveBeenCalled();
    expect(manager.getState().functionContext?.parameters[0].expression).toBe('0.75');
  });
});
