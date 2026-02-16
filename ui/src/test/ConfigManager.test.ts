import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigManager } from '../lib/ConfigManager';
import type { ShaderConfig, BufferPass, ImagePass } from '@shader-studio/types';
import type { Transport } from '../lib/transport/MessageTransport';

function createMockTransport(): Transport {
  return {
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn()
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

  describe('getNextBufferName', () => {
    it('should return null when no config exists', () => {
      expect(configManager.getNextBufferName()).toBeNull();
    });

    it('should return BufferA when no buffers exist', () => {
      configManager.setConfig(createTestConfig());
      expect(configManager.getNextBufferName()).toBe('BufferA');
    });

    it('should skip already used buffers', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      config.passes.BufferB = { path: 'b.glsl', inputs: {} };
      configManager.setConfig(config);

      expect(configManager.getNextBufferName()).toBe('BufferC');
    });

    it('should return null when all buffers are used', () => {
      const config = createTestConfig();
      config.passes.BufferA = { path: 'a.glsl', inputs: {} };
      config.passes.BufferB = { path: 'b.glsl', inputs: {} };
      config.passes.BufferC = { path: 'c.glsl', inputs: {} };
      config.passes.BufferD = { path: 'd.glsl', inputs: {} };
      configManager.setConfig(config);

      expect(configManager.getNextBufferName()).toBeNull();
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
  });
});
