import { describe, it, expect, vi } from 'vitest';
import { BufferConfig } from '../lib/BufferConfig';

describe('BufferConfig', () => {
  describe('video input handling', () => {
    it('should add video input channel', () => {
      const config = new BufferConfig('Image', { inputs: {} });
      
      config.addInputChannel('iChannel0', {
        type: 'video',
        path: './video.mp4'
      });
      
      const input = config.getInputChannel('iChannel0');
      expect(input).toEqual({
        type: 'video',
        path: './video.mp4'
      });
    });

    it('should update video input channel', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { type: 'video', path: './old.mp4' }
        }
      });
      
      config.updateInputChannel('iChannel0', {
        type: 'video',
        path: './new.mp4',
        filter: 'linear'
      });
      
      const input = config.getInputChannel('iChannel0');
      expect(input).toEqual({
        type: 'video',
        path: './new.mp4',
        filter: 'linear'
      });
    });

    it('should update video input channel with partial data', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { type: 'video', path: './video.mp4', filter: 'nearest' }
        }
      });
      
      config.updateInputChannelPartial('iChannel0', {
        type: 'video',
        wrap: 'clamp'
      });
      
      const input = config.getInputChannel('iChannel0');
      expect(input?.type).toBe('video');
      expect((input as any).path).toBe('./video.mp4');
      expect((input as any).wrap).toBe('clamp');
    });

    it('should preserve existing video properties when updating partially', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { 
            type: 'video', 
            path: './video.mp4', 
            filter: 'linear',
            wrap: 'repeat',
            vflip: true
          }
        }
      });
      
      config.updateInputChannelPartial('iChannel0', {
        filter: 'nearest'
      } as any);
      
      const input = config.getInputChannel('iChannel0') as any;
      expect(input.type).toBe('video');
      expect(input.path).toBe('./video.mp4');
      expect(input.filter).toBe('nearest');
      expect(input.wrap).toBe('repeat');
      expect(input.vflip).toBe(true);
    });

    it('should remove video input channel', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { type: 'video', path: './video.mp4' }
        }
      });
      
      config.removeInputChannel('iChannel0');
      
      expect(config.getInputChannel('iChannel0')).toBeUndefined();
    });

    it('should validate video input with valid path', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { type: 'video', path: './video.mp4' }
        }
      });
      
      const result = config.validate();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should invalidate video input without path', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { type: 'video' } as any
        }
      });
      
      const result = config.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should invalidate video input with invalid filter', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { type: 'video', path: './video.mp4', filter: 'invalid' } as any
        }
      });
      
      const result = config.validate();
      expect(result.isValid).toBe(false);
    });

    it('should invalidate video input with invalid wrap', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { type: 'video', path: './video.mp4', wrap: 'invalid' } as any
        }
      });
      
      const result = config.validate();
      expect(result.isValid).toBe(false);
    });

    it('should validate video input with all valid options', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { 
            type: 'video', 
            path: './video.mp4',
            filter: 'linear',
            wrap: 'clamp',
            vflip: true
          }
        }
      });
      
      const result = config.validate();
      expect(result.isValid).toBe(true);
    });

    it('should handle mixed texture and video inputs', () => {
      const config = new BufferConfig('Image', {
        inputs: {
          iChannel0: { type: 'texture', path: './texture.png' },
          iChannel1: { type: 'video', path: './video.mp4' }
        }
      });
      
      const result = config.validate();
      expect(result.isValid).toBe(true);
      
      const textureInput = config.getInputChannel('iChannel0');
      const videoInput = config.getInputChannel('iChannel1');
      
      expect(textureInput?.type).toBe('texture');
      expect(videoInput?.type).toBe('video');
    });

    it('should notify on video input update', () => {
      const onUpdate = vi.fn();
      const config = new BufferConfig('Image', { inputs: {} }, onUpdate);
      
      config.addInputChannel('iChannel0', {
        type: 'video',
        path: './video.mp4'
      });
      
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith('Image', expect.objectContaining({
        inputs: {
          iChannel0: { type: 'video', path: './video.mp4' }
        }
      }));
    });

    it('should handle video in buffer passes', () => {
      const config = new BufferConfig('BufferA', {
        path: './buffer.glsl',
        inputs: {
          iChannel0: { type: 'video', path: './video.mp4' }
        }
      });
      
      const result = config.validate();
      expect(result.isValid).toBe(true);
      
      const input = config.getInputChannel('iChannel0');
      expect(input?.type).toBe('video');
    });
  });
});
