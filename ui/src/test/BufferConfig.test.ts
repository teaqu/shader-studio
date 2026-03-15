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
    it('should accept valid audio input with path', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject audio input without path', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

  });

  describe('updatePath', () => {
    it('should update path for BufferPass', () => {
      const config: BufferPass = { path: 'old.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updatePath('new.glsl');

      expect((bufferConfig.getConfig() as BufferPass).path).toBe('new.glsl');
    });

    it('should not update path for ImagePass', () => {
      const config: ImagePass = { inputs: {} };
      const bufferConfig = new BufferConfig('Image', config);

      bufferConfig.updatePath('should-not-update.glsl');

      expect('path' in bufferConfig.getConfig()).toBe(false);
    });
  });

  describe('input channel management', () => {
    it('should remove input channel', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.removeInputChannel('iChannel0');

      expect(bufferConfig.getInputChannel('iChannel0')).toBeUndefined();
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

  });

  describe('validate - edge cases', () => {
    it('should reject input with unknown type', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'webcam' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      const result = bufferConfig.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should reject input with no type', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { path: 'texture.jpg' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      const result = bufferConfig.validate();
      expect(result.isValid).toBe(false);
    });

    it('should reject null input', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: null as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      const result = bufferConfig.validate();
      expect(result.isValid).toBe(false);
    });

    it('should reject texture input with invalid filter', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'tex.jpg', filter: 'bilinear' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(false);
    });

    it('should reject texture input with invalid wrap', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'tex.jpg', wrap: 'mirror' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(false);
    });

    it('should reject texture input with non-boolean vflip', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'tex.jpg', vflip: 'yes' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(false);
    });

    it('should reject texture input without path', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(false);
    });

    it('should reject video input with invalid filter', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'video', path: 'vid.mp4', filter: 'bilinear' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(false);
    });

    it('should reject video input with invalid wrap', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'video', path: 'vid.mp4', wrap: 'mirror' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(false);
    });

    it('should reject video input with non-boolean vflip', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'video', path: 'vid.mp4', vflip: 1 } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(false);
    });

    it('should reject video input without path', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'video' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(false);
    });

    it('should accept texture with valid filter, wrap, and vflip', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'tex.jpg', filter: 'mipmap', wrap: 'repeat', vflip: true }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(true);
    });

    it('should accept video with valid filter and wrap', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'video', path: 'vid.mp4', filter: 'nearest', wrap: 'clamp', vflip: false }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(true);
    });

    it('should validate config with no inputs defined', () => {
      const config: BufferPass = { path: 'shader.glsl' } as any;
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.validate().isValid).toBe(true);
    });
  });

  describe('audio validation edge cases', () => {
    it('should accept audio input with startTime only', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3', startTime: 10.0 } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept audio input with endTime only', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3', endTime: 60.0 } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject audio input with empty string path', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: '' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should accept audio with startTime=0', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3', startTime: 0 } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const result = bufferConfig.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('removeInputChannel edge cases', () => {
    it('should do nothing when config has no inputs', () => {
      const config: BufferPass = { path: 'shader.glsl' } as any;
      const onUpdate = vi.fn();
      const bufferConfig = new BufferConfig('BufferA', config, onUpdate);

      bufferConfig.removeInputChannel('iChannel0');

      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe('getInputChannel', () => {
    it('should return undefined for missing channel', () => {
      const config: BufferPass = { path: 'shader.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.getInputChannel('iChannel5')).toBeUndefined();
    });

    it('should return undefined when no inputs', () => {
      const config: BufferPass = { path: 'shader.glsl' } as any;
      const bufferConfig = new BufferConfig('BufferA', config);
      expect(bufferConfig.getInputChannel('iChannel0')).toBeUndefined();
    });
  });

  describe('renameInputChannel - non-existent source', () => {
    it('should not rename when old name does not exist', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };
      const onUpdate = vi.fn();
      const bufferConfig = new BufferConfig('BufferA', config, onUpdate);

      bufferConfig.renameInputChannel('nonExistent', 'newName');
      expect(onUpdate).not.toHaveBeenCalled();
      expect(Object.keys(bufferConfig.getConfig().inputs || {})).toEqual(['iChannel0']);
    });
  });

});
