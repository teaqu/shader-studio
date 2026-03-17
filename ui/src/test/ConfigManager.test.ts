import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigManager } from '../lib/ConfigManager';
import type { ShaderConfig, BufferPass, ImagePass } from '@shader-studio/types';
import type { Transport } from '../lib/transport/MessageTransport';

function createMockTransport(): Transport {
  return {
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: () => 'vscode' as const,
    isConnected: () => true,
  };
}

function createTestConfig(): ShaderConfig {
  return {
    version: '1.0',
    passes: {
      Image: {
        inputs: {
          iChannel0: { type: 'texture', path: 'test.png' }
        }
      }
    }
  };
}

describe('ConfigManager', () => {
  let transport: Transport;
  let onConfigChange: ReturnType<typeof vi.fn>;
  let configManager: ConfigManager;

  beforeEach(() => {
    transport = createMockTransport();
    onConfigChange = vi.fn();
    configManager = new ConfigManager(transport, onConfigChange);
  });

  describe('Default Config', () => {
    it('should use version 1.0 in default config', () => {
      configManager.addSpecificBuffer('BufferA');

      const config = configManager.getConfig();
      expect(config).not.toBeNull();
      expect(config!.version).toBe('1.0');
    });

    it('should create default config with Image pass and no path', () => {
      configManager.addSpecificBuffer('BufferA');

      const config = configManager.getConfig();
      expect(config).not.toBeNull();
      expect(config!.passes.Image).toBeDefined();
      expect(config!.passes.Image.inputs).toEqual({});
      expect((config!.passes.Image as any).path).toBeUndefined();
    });
  });

  describe('updateImagePass', () => {
    it('should create config and update Image pass when no config exists', () => {
      const imagePass: ImagePass = {
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.png' }
        }
      };

      const result = configManager.updateImagePass(imagePass);

      expect(result).toBe(true);
      expect(configManager.getConfig()).not.toBeNull();
      expect(configManager.getConfig()!.passes.Image).toEqual(imagePass);
    });

    it('should send updateConfig message via transport when no config exists', () => {
      const imagePass: ImagePass = {
        inputs: { iChannel0: { type: 'keyboard' } }
      };

      configManager.updateImagePass(imagePass);

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: expect.objectContaining({
          config: expect.objectContaining({
            version: '1.0',
            passes: expect.objectContaining({
              Image: imagePass
            })
          })
        })
      });
    });

    it('should update existing config Image pass', () => {
      configManager.setConfig(createTestConfig());

      const newImagePass: ImagePass = {
        inputs: {
          iChannel0: { type: 'buffer', source: 'BufferA' }
        }
      };

      configManager.updateImagePass(newImagePass);

      expect(configManager.getConfig()!.passes.Image).toEqual(newImagePass);
    });

    it('should call onConfigChange callback', () => {
      configManager.updateImagePass({ inputs: {} });

      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({ version: '1.0' })
      );
    });
  });

  describe('updateBuffer', () => {
    it('should create config and add buffer when no config exists', () => {
      const bufferConfig: BufferPass = {
        path: 'buffer.glsl',
        inputs: {}
      };

      const result = configManager.updateBuffer('BufferA', bufferConfig);

      expect(result).toBe(true);
      const config = configManager.getConfig();
      expect(config).not.toBeNull();
      expect(config!.version).toBe('1.0');
      expect(config!.passes.BufferA).toEqual(bufferConfig);
    });

    it('should send updateConfig message via transport when no config exists', () => {
      const bufferConfig: BufferPass = {
        path: 'buffera.glsl',
        inputs: { iChannel0: { type: 'texture', path: 'noise.png' } }
      };

      configManager.updateBuffer('BufferA', bufferConfig);

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: expect.objectContaining({
          config: expect.objectContaining({
            version: '1.0',
            passes: expect.objectContaining({
              BufferA: bufferConfig
            })
          })
        })
      });
    });

    it('should update existing buffer in config', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'old.glsl', inputs: {} };
      configManager.setConfig(config);

      const newBufferConfig: BufferPass = {
        path: 'new.glsl',
        inputs: { iChannel0: { type: 'keyboard' } }
      };

      configManager.updateBuffer('BufferA', newBufferConfig);

      expect(configManager.getConfig()!.passes.BufferA).toEqual(newBufferConfig);
    });
  });

  describe('addBuffer', () => {
    it('should add a buffer with empty path', () => {
      configManager.setConfig(createTestConfig());
      const name = configManager.addBuffer();

      expect(name).toBe('BufferA');
      const config = configManager.getConfig();
      expect(config!.passes.BufferA).toEqual({ path: '', inputs: {} });
    });

    it('should create default config and add buffer when config is null', () => {
      // No setConfig call — config is null
      const name = configManager.addBuffer();

      expect(name).toBe('BufferA');
      const config = configManager.getConfig();
      expect(config).not.toBeNull();
      expect(config!.version).toBe('1.0');
      expect(config!.passes.Image).toBeDefined();
      expect(config!.passes.BufferA).toEqual({ path: '', inputs: {} });
    });

    it('should send updateConfig message when creating buffer from null config', () => {
      const name = configManager.addBuffer();

      expect(name).toBe('BufferA');
      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateConfig',
          payload: expect.objectContaining({
            config: expect.objectContaining({
              passes: expect.objectContaining({
                Image: expect.any(Object),
                BufferA: { path: '', inputs: {} }
              })
            })
          })
        })
      );
    });

    it('should auto-name sequentially', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      configManager.setConfig(config);

      const name = configManager.addBuffer();
      expect(name).toBe('BufferB');
      expect(configManager.getConfig()!.passes.BufferB).toEqual({ path: '', inputs: {} });
    });
  });

  describe('addSpecificBuffer', () => {
    it('should create config when adding buffer with no existing config', () => {
      const result = configManager.addSpecificBuffer('BufferA');

      expect(result).toBe(true);
      const config = configManager.getConfig();
      expect(config!.version).toBe('1.0');
      expect(config!.passes.BufferA).toEqual({ path: '', inputs: {} });
    });

    it('should not add duplicate buffer', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'existing.glsl', inputs: {} };
      configManager.setConfig(config);

      const result = configManager.addSpecificBuffer('BufferA');
      expect(result).toBe(false);
    });
  });

  describe('addCommonBuffer', () => {
    it('should create config when adding common buffer with no existing config', () => {
      const result = configManager.addCommonBuffer();

      expect(result).toBe(true);
      const config = configManager.getConfig();
      expect(config!.version).toBe('1.0');
      expect(config!.passes.common).toEqual({ path: '' });
    });

    it('should not add duplicate common buffer', () => {
      configManager.addCommonBuffer();
      const result = configManager.addCommonBuffer();
      expect(result).toBe(false);
    });
  });

  describe('renameBuffer', () => {
    it('should rename a buffer pass', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      configManager.setConfig(config);

      const result = configManager.renameBuffer('BufferA', 'BlurPass');
      expect(result).toBe(true);
      const updated = configManager.getConfig();
      expect(updated!.passes.BlurPass).toEqual({ path: 'a.glsl', inputs: {} });
      expect(updated!.passes.BufferA).toBeUndefined();
    });

    it('should reject renaming to same name', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      configManager.setConfig(config);

      expect(configManager.renameBuffer('BufferA', 'BufferA')).toBe(false);
    });

    it('should reject renaming Image or common', () => {
      configManager.setConfig(createTestConfig());
      expect(configManager.renameBuffer('Image', 'Foo')).toBe(false);
      expect(configManager.renameBuffer('BufferA', 'Image')).toBe(false);
      expect(configManager.renameBuffer('BufferA', 'common')).toBe(false);
    });

    it('should reject invalid GLSL identifiers', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      configManager.setConfig(config);

      expect(configManager.renameBuffer('BufferA', '0invalid')).toBe(false);
      expect(configManager.renameBuffer('BufferA', 'has space')).toBe(false);
    });

    it('should reject renaming to existing name', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      config.passes.BufferB = { path: 'b.glsl', inputs: {} };
      configManager.setConfig(config);

      expect(configManager.renameBuffer('BufferA', 'BufferB')).toBe(false);
    });

    it('should preserve key order', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      config.passes.BufferB = { path: 'b.glsl', inputs: {} };
      configManager.setConfig(config);

      configManager.renameBuffer('BufferA', 'BlurPass');
      const keys = Object.keys(configManager.getConfig()!.passes);
      expect(keys).toEqual(['Image', 'BlurPass', 'BufferB']);
    });
  });

  describe('Transport - resolved_path stripping', () => {
    it('should strip resolved_path from config text sent via transport', () => {
      const imagePass: ImagePass = {
        inputs: {
          iChannel0: {
            type: 'texture',
            path: 'texture.png',
            resolved_path: 'https://webview-uri/texture.png'
          } as any
        }
      };

      configManager.setConfig(createTestConfig());
      configManager.updateImagePass(imagePass);

      const call = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const text = call.payload.text;

      expect(text).not.toContain('resolved_path');
      expect(text).toContain('texture.png');

      // Config object should still have it (for UI use)
      expect(call.payload.config.passes.Image.inputs.iChannel0.resolved_path).toBe('https://webview-uri/texture.png');
    });
  });

  describe('removeBuffer', () => {
    it('should return false when no config exists', () => {
      expect(configManager.removeBuffer('BufferA')).toBe(false);
    });

    it('should remove a buffer from config', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'buffer.glsl', inputs: {} };
      configManager.setConfig(config);

      const result = configManager.removeBuffer('BufferA');

      expect(result).toBe(true);
      expect(configManager.getConfig()!.passes.BufferA).toBeUndefined();
    });
  });

  describe('getBufferList', () => {
    it('should return empty array when no config exists', () => {
      expect(configManager.getBufferList()).toEqual([]);
    });

    it('should return list of existing buffers', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      config.passes.BufferC = { path: 'c.glsl', inputs: {} };
      configManager.setConfig(config);

      const buffers = configManager.getBufferList();
      expect(buffers).toEqual(['BufferA', 'BufferC']);
    });

    it('should include common buffer when present', () => {
      const config = createTestConfig();
      config.passes.common = { path: 'common.glsl' };
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      configManager.setConfig(config);

      const buffers = configManager.getBufferList();
      expect(buffers).toEqual(['common', 'BufferA']);
    });
  });

  describe('generateBufferPath', () => {
    it('should return empty string when no shader path set', () => {
      expect(configManager.generateBufferPath('BufferA')).toBe('');
    });

    it('should generate buffer path from shader name', () => {
      configManager.setShaderPath('/path/to/myshader.glsl');
      expect(configManager.generateBufferPath('BufferA')).toBe('myshader.buffera.glsl');
    });

    it('should generate common buffer path from shader name', () => {
      configManager.setShaderPath('/path/to/myshader.glsl');
      expect(configManager.generateBufferPath('common')).toBe('myshader.common.glsl');
    });

    it('should handle shader paths with backslashes', () => {
      configManager.setShaderPath('C:\\Users\\dev\\myshader.glsl');
      expect(configManager.generateBufferPath('BufferB')).toBe('myshader.bufferb.glsl');
    });

    it('should handle shader name without .glsl extension', () => {
      configManager.setShaderPath('/path/to/shader');
      expect(configManager.generateBufferPath('BufferA')).toBe('shader.buffera.glsl');
    });
  });

  describe('createBufferFile', () => {
    it('should send createBufferFile message via transport', () => {
      configManager.createBufferFile('BufferA', 'myshader.buffera.glsl');

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'createBufferFile',
        payload: {
          bufferName: 'BufferA',
          filePath: 'myshader.buffera.glsl'
        }
      });
    });
  });

  describe('setShaderPath', () => {
    it('should store and return the shader path', () => {
      configManager.setShaderPath('/path/to/shader.glsl');
      expect(configManager.getShaderPath()).toBe('/path/to/shader.glsl');
    });

    it('should include shaderPath in updateConfig messages', () => {
      configManager.setShaderPath('/path/to/shader.glsl');
      configManager.updateImagePass({ inputs: {} });

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: expect.objectContaining({
          shaderPath: '/path/to/shader.glsl'
        })
      });
    });

    it('should include empty shaderPath when not set', () => {
      configManager.updateImagePass({ inputs: {} });

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: expect.objectContaining({
          shaderPath: ''
        })
      });
    });
  });

  describe('updateBufferPath', () => {
    it('should return false when no config exists', () => {
      expect(configManager.updateBufferPath('BufferA', 'new.glsl')).toBe(false);
    });

    it('should return false when buffer does not exist', () => {
      configManager.setConfig(createTestConfig());
      expect(configManager.updateBufferPath('BufferA', 'new.glsl')).toBe(false);
    });

    it('should update the path of an existing buffer', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'old.glsl', inputs: {} };
      configManager.setConfig(config);

      const result = configManager.updateBufferPath('BufferA', 'new.glsl');
      expect(result).toBe(true);
      expect((configManager.getConfig()!.passes.BufferA as BufferPass).path).toBe('new.glsl');
    });
  });

  describe('getBuffer', () => {
    it('should return null when no config exists', () => {
      expect(configManager.getBuffer('BufferA')).toBeNull();
    });

    it('should return null for non-existent buffer', () => {
      configManager.setConfig(createTestConfig());
      expect(configManager.getBuffer('BufferX')).toBeNull();
    });

    it('should return the buffer config for existing buffer', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      configManager.setConfig(config);

      const buffer = configManager.getBuffer('BufferA');
      expect(buffer).toEqual({ path: 'a.glsl', inputs: {} });
    });

    it('should return the Image pass', () => {
      configManager.setConfig(createTestConfig());
      const image = configManager.getBuffer('Image');
      expect(image).not.toBeNull();
      expect(image!.inputs).toBeDefined();
    });
  });

  describe('setPathMap and getWebviewUri', () => {
    it('should return undefined for unknown path', () => {
      expect(configManager.getWebviewUri('unknown.png')).toBeUndefined();
    });

    it('should return mapped URI for known path', () => {
      configManager.setPathMap({ 'texture.png': 'https://webview/texture.png' });
      expect(configManager.getWebviewUri('texture.png')).toBe('https://webview/texture.png');
    });
  });

  describe('renameBuffer - additional edge cases', () => {
    it('should return false when config is null', () => {
      expect(configManager.renameBuffer('BufferA', 'NewName')).toBe(false);
    });

    it('should reject renaming common as source', () => {
      const config = createTestConfig();
      config.passes.common = { path: 'common.glsl' };
      configManager.setConfig(config);
      expect(configManager.renameBuffer('common', 'NewCommon')).toBe(false);
    });

    it('should return false when old buffer does not exist', () => {
      configManager.setConfig(createTestConfig());
      expect(configManager.renameBuffer('NonExistent', 'NewName')).toBe(false);
    });
  });

  describe('updateBufferResolution - edge cases', () => {
    it('should do nothing when no config exists', () => {
      configManager.updateBufferResolution('BufferA', { width: 256, height: 256 });
      expect(transport.postMessage).not.toHaveBeenCalled();
    });

    it('should do nothing when buffer does not exist', () => {
      configManager.setConfig(createTestConfig());
      configManager.updateBufferResolution('NonExistent', { width: 256, height: 256 });
      expect(transport.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('updateResolution - details', () => {
    it('should delete resolution when passed undefined', () => {
      const config = createTestConfig();
      (config.passes.Image as any).resolution = { scale: 2 };
      configManager.setConfig(config);

      configManager.updateResolution(undefined);

      const updated = configManager.getConfig()!;
      expect((updated.passes.Image as any).resolution).toBeUndefined();
    });

    it('should merge with existing resolution settings', () => {
      const config = createTestConfig();
      (config.passes.Image as any).resolution = { scale: 2 };
      configManager.setConfig(config);

      configManager.updateResolution({ aspectRatio: '4:3' } as any);

      const updated = configManager.getConfig()!;
      expect((updated.passes.Image as any).resolution).toEqual({
        scale: 2,
        aspectRatio: '4:3',
      });
    });
  });

  describe('createBufferFile - no transport', () => {
    it('should not throw when transport is null', () => {
      // Create a manager and null out its transport
      const mgr = new ConfigManager(null as any);
      // The method checks this.transport before calling postMessage
      expect(() => mgr.createBufferFile('BufferA', 'file.glsl')).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should not throw', () => {
      expect(() => configManager.dispose()).not.toThrow();
    });
  });

  describe('Resolution updates should not restart shader', () => {
    it('updateResolution should send skipRefresh: true', () => {
      configManager.setConfig(createTestConfig());
      configManager.updateResolution({ scale: 2 });

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: expect.objectContaining({
          skipRefresh: true,
        })
      });
    });

    it('updateResolution with undefined should send skipRefresh: true', () => {
      configManager.setConfig(createTestConfig());
      configManager.updateResolution(undefined);

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: expect.objectContaining({
          skipRefresh: true,
        })
      });
    });

    it('updateBufferResolution should send skipRefresh: true', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'buf.glsl', inputs: {} };
      configManager.setConfig(config);
      configManager.updateBufferResolution('BufferA', { width: 256, height: 256 });

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: expect.objectContaining({
          skipRefresh: true,
        })
      });
    });

    it('updateBufferResolution clearing should send skipRefresh: true', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'buf.glsl', inputs: {}, resolution: { width: 256, height: 256 } } as BufferPass;
      configManager.setConfig(config);
      configManager.updateBufferResolution('BufferA', undefined);

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: expect.objectContaining({
          skipRefresh: true,
        })
      });
    });

    it('updateResolution should still save config to file (config in payload)', () => {
      configManager.setConfig(createTestConfig());
      configManager.updateResolution({ scale: 4, aspectRatio: '16:9' });

      const call = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.type).toBe('updateConfig');
      expect(call.payload.config.passes.Image.resolution).toEqual({
        scale: 4,
        aspectRatio: '16:9',
      });
    });

    it('non-resolution updates should NOT send skipRefresh', () => {
      configManager.setConfig(createTestConfig());
      configManager.addBuffer();

      const call = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.skipRefresh).toBeUndefined();
    });

    it('updateImagePass should NOT send skipRefresh', () => {
      configManager.setConfig(createTestConfig());
      configManager.updateImagePass({ inputs: { iChannel0: { type: 'keyboard' } } });

      const call = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.skipRefresh).toBeUndefined();
    });

    it('updateBuffer should NOT send skipRefresh', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'buf.glsl', inputs: {} };
      configManager.setConfig(config);
      configManager.updateBuffer('BufferA', { path: 'new.glsl', inputs: {} });

      const call = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.skipRefresh).toBeUndefined();
    });

    it('removeBuffer should NOT send skipRefresh', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'buf.glsl', inputs: {} };
      configManager.setConfig(config);
      configManager.removeBuffer('BufferA');

      const call = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.skipRefresh).toBeUndefined();
    });
  });

  describe('Script management', () => {
    it('setScript should add script field to config', () => {
      configManager.setConfig(createTestConfig());
      configManager.setScript('./uniforms.ts');

      const config = configManager.getConfig();
      expect(config?.script).toBe('./uniforms.ts');
    });

    it('setScript should create default config if none exists', () => {
      configManager.setScript('./uniforms.ts');

      const config = configManager.getConfig();
      expect(config).not.toBeNull();
      expect(config?.script).toBe('./uniforms.ts');
      expect(config?.passes.Image).toBeDefined();
    });

    it('setScript should send updateConfig via transport', () => {
      configManager.setConfig(createTestConfig());
      configManager.setScript('./uniforms.ts');

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateConfig',
          payload: expect.objectContaining({
            config: expect.objectContaining({ script: './uniforms.ts' }),
          }),
        })
      );
    });

    it('removeScript should remove script field from config', () => {
      const config = createTestConfig();
      config.script = './uniforms.ts';
      configManager.setConfig(config);

      configManager.removeScript();

      const updated = configManager.getConfig();
      expect(updated?.script).toBeUndefined();
    });

    it('removeScript should preserve other config fields', () => {
      const config = createTestConfig();
      config.script = './uniforms.ts';
      configManager.setConfig(config);

      configManager.removeScript();

      const updated = configManager.getConfig();
      expect(updated?.version).toBe('1.0');
      expect(updated?.passes.Image).toBeDefined();
    });

    it('removeScript should be a no-op when config is null', () => {
      configManager.removeScript();
      expect(transport.postMessage).not.toHaveBeenCalled();
    });

    it('generateScriptPath should generate path based on shader name', () => {
      configManager.setShaderPath('/path/to/myshader.glsl');
      expect(configManager.generateScriptPath()).toBe('./myshader.uniforms.ts');
    });

    it('generateScriptPath should return empty string when no shader path', () => {
      expect(configManager.generateScriptPath()).toBe('');
    });

    it('generateScriptPath should handle shader path with backslashes', () => {
      configManager.setShaderPath('C:\\shaders\\cool.glsl');
      expect(configManager.generateScriptPath()).toBe('./cool.uniforms.ts');
    });
  });
});
