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


describe('debug dependency source arrival', () => {
  it.each(['glsl', 'slang', 'wgsl'] as const)('%s refreshes buffer ownership and capture after the cursor arrives first', language => {
    const manager = new ShaderDebugManager();
    manager.setLanguage(language);
    const path = `/buffer.${language}`;
    const config = { version: '1', passes: { Image: {}, BufferA: { path } } };
    manager.setShaderContext(config, `/image.${language}`, {});
    manager.toggleEnabled();
    manager.updateDebugLine(1, sources[language].split('\n')[1], path);
    expect(manager.getState().functionContext).toBeNull();
    const capture = vi.fn();
    manager.setCaptureStateCallback(capture);
    manager.setShaderContext(config, `/image.${language}`, { BufferA: sources[language] });
    expect(manager.getState().functionContext).toMatchObject({ functionName: 'helper' });
    expect(capture).toHaveBeenCalledOnce();
    manager.setShaderContext(config, `/image.${language}`, { BufferA: sources[language].replace('helper', 'renamed') });
    expect(manager.getState().functionContext).toMatchObject({ functionName: 'renamed' });
    expect(capture).toHaveBeenCalledTimes(2);
    manager.setShaderContext(config, `/image.${language}`, {});
    expect(manager.getState().functionContext).toBeNull();
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it('notifies for Common edits and ignores equivalent dependency context', () => {
    const manager = new ShaderDebugManager();
    manager.setLanguage('slang');
    const config = { version: '1', passes: { Image: {}, common: { path: '/common.slang' } } };
    const buffers = { common: 'float helper(float p) {\n  return p;\n}' };
    manager.setShaderContext(config, '/image.slang', buffers);
    manager.updateDebugLine(1, '  return p;', '/common.slang');
    manager.setCustomParameter(0, '0.75');
    const capture = vi.fn();
    manager.setCaptureStateCallback(capture);
    manager.setShaderContext({ ...config }, '/image.slang', { ...buffers });
    expect(capture).not.toHaveBeenCalled();
    expect(manager.getState().functionContext?.parameters[0].expression).toBe('0.75');
    manager.setShaderContext(config, '/image.slang', { common: buffers.common.replace('return p', 'return p * 2') });
    expect(capture).toHaveBeenCalledOnce();
    expect(manager.getState().functionContext?.parameters[0].expression).toBe('0.75');
  });

  it('refreshes imported Slang source and late resolved buffer paths', () => {
    const manager = new ShaderDebugManager();
    manager.setLanguage('slang');
    const config = { version: '1', passes: { Image: {}, BufferA: { path: 'buffer.slang' } } };
    const module = { moduleName: 'helper', path: '/modules/helper.slang', source: sources.slang, ownerPass: 'BufferA' };
    manager.setShaderContext(config, '/image.slang', {}, [module]);
    manager.updateDebugLine(1, '  float shade = 0.375;', module.path);
    const capture = vi.fn();
    manager.setCaptureStateCallback(capture);
    manager.setShaderContext(config, '/image.slang', {}, [{ ...module, source: module.source.replace('helper', 'renamed') }]);
    expect(manager.getState().functionContext).toMatchObject({ functionName: 'renamed' });
    expect(capture).toHaveBeenCalledOnce();
    manager.updateDebugLine(1, '  float shade = 0.375;', '/resolved/pass.slang');
    manager.setShaderContext(config, '/image.slang', { BufferA: sources.slang }, [], { BufferA: '/resolved/pass.slang' });
    expect(manager.getState()).toMatchObject({ activeBufferName: 'BufferA', functionContext: { functionName: 'helper' } });
  });

});
