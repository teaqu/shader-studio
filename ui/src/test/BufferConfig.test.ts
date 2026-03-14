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

      expect(bufferConfig.getConfig().path).toBe('new.glsl');
    });

    it('should not update path for ImagePass', () => {
      const config: ImagePass = { inputs: {} };
      const bufferConfig = new BufferConfig('Image', config);

      bufferConfig.updatePath('should-not-update.glsl');

      expect('path' in bufferConfig.getConfig()).toBe(false);
    });
  });

  describe('updateInputChannelPartial - audio type', () => {
    it('should handle audio type updates', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'texture', path: 'old.jpg' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'music.mp3' } as any);

      const channel = bufferConfig.getInputChannel('iChannel0');
      expect(channel).toEqual({ type: 'audio', path: 'music.mp3' });
    });

    it('should preserve existing audio path when updating without type change', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3' } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { path: 'new-music.mp3' } as any);

      const channel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('new-music.mp3');
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

    it('should not include muted field in video config', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'video', path: 'video.mp4' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'video', path: 'video.mp4' } as any);

      const channel = bufferConfig.getInputChannel('iChannel0');
      expect(channel).toEqual({ type: 'video', path: 'video.mp4' });
      expect(channel).not.toHaveProperty('muted');
    });

    it('should not include muted field in audio config', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3' }
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'music.mp3' } as any);

      const channel = bufferConfig.getInputChannel('iChannel0');
      expect(channel).toEqual({ type: 'audio', path: 'music.mp3' });
      expect(channel).not.toHaveProperty('muted');
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

  describe('audio startTime and endTime properties', () => {
    it('updateInputChannelPartial with audio type should store startTime', () => {
      const config: BufferPass = { path: 'shader.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'music.mp3', startTime: 5.0 } as any);

      const channel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('music.mp3');
      expect(channel.startTime).toBe(5.0);
    });

    it('updateInputChannelPartial with audio type should store endTime', () => {
      const config: BufferPass = { path: 'shader.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'music.mp3', endTime: 30.0 } as any);

      const channel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('music.mp3');
      expect(channel.endTime).toBe(30.0);
    });

    it('updateInputChannelPartial with audio type should store both startTime and endTime', () => {
      const config: BufferPass = { path: 'shader.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'music.mp3', startTime: 2.5, endTime: 45.0 } as any);

      const channel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('music.mp3');
      expect(channel.startTime).toBe(2.5);
      expect(channel.endTime).toBe(45.0);
    });

    it('updateInputChannelPartial with audio type should handle undefined startTime/endTime', () => {
      const config: BufferPass = { path: 'shader.glsl', inputs: {} };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'music.mp3' } as any);

      const channel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('music.mp3');
      expect(channel.startTime).toBeUndefined();
      expect(channel.endTime).toBeUndefined();
    });
  });

  describe('audio time preservation', () => {
    it('updating path on existing audio should preserve existing startTime/endTime', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3', startTime: 10.0, endTime: 60.0 } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { path: 'new-music.mp3' } as any);

      const channel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('new-music.mp3');
      expect(channel.startTime).toBe(10.0);
      expect(channel.endTime).toBe(60.0);
    });

    it('updating startTime independently without changing type should work', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3', startTime: 5.0, endTime: 30.0 } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { startTime: 15.0 } as any);

      const channel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('music.mp3');
      expect(channel.startTime).toBe(15.0);
      expect(channel.endTime).toBe(30.0);
    });

    it('updating endTime independently without changing type should work', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3', startTime: 5.0, endTime: 30.0 } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { endTime: 90.0 } as any);

      const channel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('music.mp3');
      expect(channel.startTime).toBe(5.0);
      expect(channel.endTime).toBe(90.0);
    });

    it('switching from audio to another type and back should clear times', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: 'music.mp3', startTime: 5.0, endTime: 30.0 } as any
        }
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      // Switch to texture
      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'texture', path: 'texture.jpg' } as any);
      const textureChannel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(textureChannel.type).toBe('texture');
      expect(textureChannel.startTime).toBeUndefined();
      expect(textureChannel.endTime).toBeUndefined();

      // Switch back to audio
      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'new-music.mp3' } as any);
      const audioChannel = bufferConfig.getInputChannel('iChannel0') as any;
      expect(audioChannel.type).toBe('audio');
      expect(audioChannel.path).toBe('new-music.mp3');
      expect(audioChannel.startTime).toBeUndefined();
      expect(audioChannel.endTime).toBeUndefined();
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

  describe('audio config output', () => {
    it('toJSON should include startTime/endTime when set', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {}
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'music.mp3', startTime: 5.0, endTime: 30.0 } as any);

      const json = bufferConfig.toJSON();
      const channel = json.inputs?.['iChannel0'] as any;
      expect(channel.startTime).toBe(5.0);
      expect(channel.endTime).toBe(30.0);
    });

    it('toJSON should not include startTime/endTime when not set', () => {
      const config: BufferPass = {
        path: 'shader.glsl',
        inputs: {}
      };
      const bufferConfig = new BufferConfig('BufferA', config);

      bufferConfig.updateInputChannelPartial('iChannel0', { type: 'audio', path: 'music.mp3' } as any);

      const json = bufferConfig.toJSON();
      const channel = json.inputs?.['iChannel0'] as any;
      expect(channel.type).toBe('audio');
      expect(channel.path).toBe('music.mp3');
      expect(channel.startTime).toBeUndefined();
      expect(channel.endTime).toBeUndefined();
    });
  });
});
