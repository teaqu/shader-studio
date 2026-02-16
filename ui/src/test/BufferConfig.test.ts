import { describe, it, expect } from 'vitest';
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
          iChannel0: { type: 'buffer', source: 'InvalidBuffer' } as any
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

    it('should get available channels', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'texture.jpg' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      const available = bufferConfig.getAvailableChannels();

      expect(available).toHaveLength(3);
      expect(available).toContain('iChannel1');
      expect(available).toContain('iChannel2');
      expect(available).toContain('iChannel3');
      expect(available).not.toContain('iChannel0');
    });
  });
});
