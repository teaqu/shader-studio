import { describe, it, expect, vi } from 'vitest';
import { BufferConfig } from '../lib/BufferConfig';
import type { BufferPass, ImagePass } from '@shader-studio/types';

describe('BufferConfig', () => {
  describe('validate', () => {
    it('should accept buffer paths with .glsl extension', () => {
      const config: BufferPass = { path: 'shader.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept buffer paths without .glsl extension', () => {
      const config: BufferPass = { path: 'shader.frag', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept buffer paths with no extension', () => {
      const config: BufferPass = { path: 'myshader', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept empty buffer path', () => {
      const config: BufferPass = { path: '', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept image pass without path', () => {
      const config: ImagePass = { inputs: {} };
      const bufferConfig = new BufferConfig('Image', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid buffer input', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'buffer', source: '0invalid' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('invalid input configuration');
    });

    it('should accept valid buffer input', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'buffer', source: 'BufferA' }
        }
      };
      const bufferConfig = new BufferConfig('BufferB', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept buffer input with custom source name', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'buffer', source: 'BlurPass' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject buffer input with Image as source', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'buffer', source: 'Image' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(false);
    });

    it('should reject buffer input with common as source', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'buffer', source: 'common' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(false);
    });

    it('should reject buffer input with empty source', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'buffer', source: '' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(false);
    });

    it('should accept valid texture input', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid video input', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'video', path: 'video.mp4' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid keyboard input', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('updatePath', () => {
    it('should update path for BufferPass', () => {
      const config: BufferPass = { path: 'old.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updatePath('new.glsl');

      expect(bufferConfig.getConfig().path).toBe('new.glsl');
    });

    it('should not update path for ImagePass', () => {
      const config: ImagePass = { inputs: {} };
      const bufferConfig = new BufferConfig('Image', config);

      bufferConfig.updatePath('should-not-update.glsl');

      expect('path' in bufferConfig.getConfig()).toBe(false);
    });
  });

  describe('input channel management', () => {
    it('should add input channel', () => {
      const config: BufferPass = { path: 'shader.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.addInputChannel('iChannel0', { type: 'texture', path: 'texture.jpg' });

      const channels = bufferConfig.getInputChannels();
      expect(channels).toHaveLength(1);
      expect(channels[0][0]).toBe('iChannel0');
      expect(channels[0][1]).toEqual({ type: 'texture', path: 'texture.jpg' });
    });

    it('should remove input channel', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.removeInputChannel('iChannel0');

      const channels = bufferConfig.getInputChannels();
      expect(channels).toHaveLength(0);
    });

    it('should update input channel', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'old.jpg' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannel('iChannel0', { type: 'texture', path: 'new.jpg' });

      const channel = bufferConfig.getInputChannel('iChannel0');
      expect(channel).toEqual({ type: 'texture', path: 'new.jpg' });
    });

    it('should get next channel name', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      expect(bufferConfig.getNextChannelName()).toBe('iChannel1');
      expect(bufferConfig.canAddChannel()).toBe(true);
    });

    it('should rename input channel', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const onUpdate = vi.fn();
      const bufferConfig = new BufferConfig('BufferA', config, onUpdate);

      bufferConfig.renameInputChannel('iChannel0', 'noiseMap');
      const updated = bufferConfig.getConfig();

      expect(updated.inputs?.['noiseMap' as keyof typeof updated.inputs]).toEqual({ type: 'texture', path: 'texture.jpg' });
      expect(updated.inputs?.['iChannel0' as keyof typeof updated.inputs]).toBeUndefined();
      expect(onUpdate).toHaveBeenCalled();
    });

    it('should preserve key order when renaming', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'a.jpg' },
          iChannel1: { type: 'texture', path: 'b.jpg' },
          iChannel2: { type: 'texture', path: 'c.jpg' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.renameInputChannel('iChannel1', 'normalMap');
      const keys = Object.keys(bufferConfig.getConfig().inputs || {});

      expect(keys).toEqual(['iChannel0', 'normalMap', 'iChannel2']);
    });

    it('should not rename to invalid GLSL identifier', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const onUpdate = vi.fn();
      const bufferConfig = new BufferConfig('BufferA', config, onUpdate);

      bufferConfig.renameInputChannel('iChannel0', '0invalid');
      expect(Object.keys(bufferConfig.getConfig().inputs || {})).toContain('iChannel0');
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('should not rename to a name already in use', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'a.jpg' },
          noiseMap: { type: 'texture', path: 'b.jpg' }
        }
      };
      const onUpdate = vi.fn();
      const bufferConfig = new BufferConfig('BufferA', config, onUpdate);

      bufferConfig.renameInputChannel('iChannel0', 'noiseMap');
      expect(Object.keys(bufferConfig.getConfig().inputs || {})).toContain('iChannel0');
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('should not rename to the same name', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const onUpdate = vi.fn();
      const bufferConfig = new BufferConfig('BufferA', config, onUpdate);

      bufferConfig.renameInputChannel('iChannel0', 'iChannel0');
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('should not rename to empty string', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const onUpdate = vi.fn();
      const bufferConfig = new BufferConfig('BufferA', config, onUpdate);

      bufferConfig.renameInputChannel('iChannel0', '');
      expect(Object.keys(bufferConfig.getConfig().inputs || {})).toContain('iChannel0');
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('should return false for canAddChannel at 16 channels', () => {
      const inputs: Record<string, any> = {};
      for (let i = 0; i < 16; i++) {
        inputs[`ch${i}`] = { type: 'keyboard' };
      }
      const config: BufferPass = { path: 'shader.glsl', inputs };
      const bufferConfig = new BufferConfig('BufferA', config);

      expect(bufferConfig.canAddChannel()).toBe(false);
    });

    it('should return true for canAddChannel under 16 channels', () => {
      const inputs: Record<string, any> = {};
      for (let i = 0; i < 15; i++) {
        inputs[`ch${i}`] = { type: 'keyboard' };
      }
      const config: BufferPass = { path: 'shader.glsl', inputs };
      const bufferConfig = new BufferConfig('BufferA', config);

      expect(bufferConfig.canAddChannel()).toBe(true);
    });

    it('should find next iChannel name skipping used ones', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' },
          iChannel2: { type: 'keyboard' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      expect(bufferConfig.getNextChannelName()).toBe('iChannel1');
    });

    it('should default buffer source to empty string when creating new buffer input', () => {
      const config: BufferPass = { path: 'shader.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'buffer' });

      const channel = bufferConfig.getInputChannel('iChannel0');
      expect(channel).toEqual({ type: 'buffer', source: '' });
    });

    it('should preserve existing buffer source when updating without source', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'buffer', source: 'BlurPass' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'buffer' });

      const channel = bufferConfig.getInputChannel('iChannel0');
      expect(channel).toEqual({ type: 'buffer', source: 'BlurPass' });
    });

    it('should find next iChannel name when custom names occupy slots', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          noiseMap: { type: 'texture', path: 'a.jpg' },
          iChannel0: { type: 'keyboard' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      // noiseMap is not an iChannel name, so iChannel1 should be next
      expect(bufferConfig.getNextChannelName()).toBe('iChannel1');
    });
  });
});
