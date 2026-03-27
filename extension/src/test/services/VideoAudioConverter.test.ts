import * as assert from 'assert';
import * as sinon from 'sinon';
const proxyquire = require('proxyquire');

suite('VideoAudioConverter Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let execFileStub: sinon.SinonStub;
  let fsStubs: Record<string, sinon.SinonStub>;
  let VideoAudioConverter: any;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Stub execFile via proxyquire so child_process.execFile is replaced
    execFileStub = sandbox.stub();
    fsStubs = {
      existsSync: sandbox.stub().returns(false),
      statSync: sandbox.stub(),
    };

    const mod = proxyquire('../../app/services/VideoAudioConverter', {
      'child_process': { execFile: execFileStub },
      'fs': fsStubs,
    });
    VideoAudioConverter = mod.VideoAudioConverter;
  });

  teardown(() => {
    sandbox.restore();
  });

  /**
     * Helper to make ffmpeg -version succeed (ffmpeg available)
     * and ffprobe return a specific codec.
     */
  function stubFfprobeCodec(codec: string): void {
    execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
      const cb = typeof opts === 'function' ? opts : callback;
      if (cmd === 'ffmpeg' && args[0] === '-version') {
        cb(null, { stdout: 'ffmpeg version 6.0', stderr: '' });
      } else if (cmd === 'ffprobe') {
        cb(null, { stdout: codec + '\n', stderr: '' });
      } else {
        cb(new Error(`Command not found: ${cmd}`));
      }
      return {} as any;
    });
  }

  /**
     * Helper to make all ffmpeg/ffprobe calls succeed.
     */
  function stubFfmpegAvailable(): void {
    execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
      const cb = typeof opts === 'function' ? opts : callback;
      if (cmd === 'ffmpeg') {
        cb(null, { stdout: 'ffmpeg version 6.0', stderr: '' });
      } else if (cmd === 'ffprobe') {
        cb(null, { stdout: '', stderr: '' });
      } else {
        cb(new Error(`Command not found: ${cmd}`));
      }
      return {} as any;
    });
  }

  /**
     * Helper to make ffmpeg/ffprobe unavailable.
     */
  function stubFfmpegUnavailable(): void {
    execFileStub.callsFake((cmd: string, _args: string[], opts: any, callback?: Function) => {
      const cb = typeof opts === 'function' ? opts : callback;
      cb(new Error(`Command not found: ${cmd}`));
      return {} as any;
    });
  }

  suite('getUnsupportedAudioCodec', () => {
    test('returns "aac" for AAC audio', async () => {
      const converter = new VideoAudioConverter();
      stubFfprobeCodec('aac');

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, 'aac');
    });

    test('returns null for mp3 audio (supported)', async () => {
      const converter = new VideoAudioConverter();
      stubFfprobeCodec('mp3');

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('returns null for vorbis audio (supported)', async () => {
      const converter = new VideoAudioConverter();
      stubFfprobeCodec('vorbis');

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('returns null for flac audio (supported)', async () => {
      const converter = new VideoAudioConverter();
      stubFfprobeCodec('flac');

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('returns null for pcm_s16le audio (supported wav)', async () => {
      const converter = new VideoAudioConverter();
      stubFfprobeCodec('pcm_s16le');

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('returns null for opus audio (supported)', async () => {
      const converter = new VideoAudioConverter();
      stubFfprobeCodec('opus');

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('returns null when no audio track', async () => {
      const converter = new VideoAudioConverter();
      stubFfprobeCodec('');

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('returns null when ffprobe not available', async () => {
      const converter = new VideoAudioConverter();
      stubFfmpegUnavailable();

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('returns null when ffprobe fails', async () => {
      const converter = new VideoAudioConverter();
      execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'ffmpeg' && args[0] === '-version') {
          cb(null, { stdout: 'ffmpeg version 6.0', stderr: '' });
        } else if (cmd === 'ffprobe') {
          cb(new Error('ffprobe crashed'));
        } else {
          cb(new Error(`Command not found: ${cmd}`));
        }
        return {} as any;
      });

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('returns unsupported codec name for wmav2', async () => {
      const converter = new VideoAudioConverter();
      stubFfprobeCodec('wmav2');

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, 'wmav2');
    });
  });

  suite('convertAudio', () => {
    test('creates output file with _vscode suffix next to original', async () => {
      const converter = new VideoAudioConverter();
      fsStubs.existsSync.returns(false);
      stubFfmpegAvailable();

      const result = await converter.convertAudio('/path/to/video.mp4');
      assert.strictEqual(result, '/path/to/video_vscode.mp4');
    });

    test('calls ffmpeg with correct args (-c:v copy -c:a libmp3lame)', async () => {
      const converter = new VideoAudioConverter();
      fsStubs.existsSync.returns(false);

      let capturedArgs: string[] = [];
      execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'ffmpeg' && args[0] !== '-version') {
          capturedArgs = args;
        }
        cb(null, { stdout: '', stderr: '' });
        return {} as any;
      });

      await converter.convertAudio('/path/to/video.mp4');

      assert.ok(capturedArgs.includes('-c:v'), 'Should include -c:v flag');
      assert.ok(capturedArgs.includes('copy'), 'Should include copy for video codec');
      assert.ok(capturedArgs.includes('-c:a'), 'Should include -c:a flag');
      assert.ok(capturedArgs.includes('libmp3lame'), 'Should include libmp3lame for audio codec');
      assert.ok(capturedArgs.includes('-q:a'), 'Should include -q:a flag');
      assert.ok(capturedArgs.includes('2'), 'Should include quality level 2');
      assert.ok(capturedArgs.includes('-y'), 'Should include -y flag for overwrite');
      assert.ok(capturedArgs.includes('-i'), 'Should include -i flag');
      assert.ok(capturedArgs.includes('/path/to/video.mp4'), 'Should include input path');
      assert.ok(capturedArgs.includes('/path/to/video_vscode.mp4'), 'Should include output path');
    });

    test('skips conversion if output already exists and is newer than source', async () => {
      const converter = new VideoAudioConverter();
      fsStubs.existsSync.returns(true);
      fsStubs.statSync
        .withArgs('/path/to/video.mp4').returns({ mtimeMs: 1000 } as any)
        .withArgs('/path/to/video_vscode.mp4').returns({ mtimeMs: 2000 } as any);

      let ffmpegConvertCalled = false;
      execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'ffmpeg' && args[0] !== '-version') {
          ffmpegConvertCalled = true;
        }
        cb(null, { stdout: '', stderr: '' });
        return {} as any;
      });

      const result = await converter.convertAudio('/path/to/video.mp4');
      assert.strictEqual(result, '/path/to/video_vscode.mp4');
      assert.strictEqual(ffmpegConvertCalled, false, 'Should not call ffmpeg for conversion');
    });

    test('re-converts if source is newer than existing output', async () => {
      const converter = new VideoAudioConverter();
      fsStubs.existsSync.returns(true);
      fsStubs.statSync
        .withArgs('/path/to/video.mp4').returns({ mtimeMs: 2000 } as any)
        .withArgs('/path/to/video_vscode.mp4').returns({ mtimeMs: 1000 } as any);

      let ffmpegConvertCalled = false;
      execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'ffmpeg' && args[0] !== '-version') {
          ffmpegConvertCalled = true;
        }
        cb(null, { stdout: '', stderr: '' });
        return {} as any;
      });

      const result = await converter.convertAudio('/path/to/video.mp4');
      assert.strictEqual(result, '/path/to/video_vscode.mp4');
      assert.strictEqual(ffmpegConvertCalled, true, 'Should call ffmpeg when source is newer');
    });

    test('throws on ffmpeg failure', async () => {
      const converter = new VideoAudioConverter();
      fsStubs.existsSync.returns(false);

      execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'ffmpeg' && args[0] !== '-version') {
          cb(new Error('ffmpeg conversion failed'));
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      await assert.rejects(
        () => converter.convertAudio('/path/to/video.mp4'),
        /ffmpeg conversion failed/
      );
    });

    test('handles .webm extension correctly', async () => {
      const converter = new VideoAudioConverter();
      fsStubs.existsSync.returns(false);
      stubFfmpegAvailable();

      const result = await converter.convertAudio('/path/to/video.webm');
      assert.strictEqual(result, '/path/to/video_vscode.webm');
    });
  });

  suite('ffmpeg availability', () => {
    test('checks ffmpeg once, caches result', async () => {
      const converter = new VideoAudioConverter();
      let ffmpegVersionCalls = 0;

      execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'ffmpeg' && args[0] === '-version') {
          ffmpegVersionCalls++;
          cb(null, { stdout: 'ffmpeg version 6.0', stderr: '' });
        } else if (cmd === 'ffprobe') {
          cb(null, { stdout: 'aac\n', stderr: '' });
        } else {
          cb(new Error(`Command not found: ${cmd}`));
        }
        return {} as any;
      });

      await converter.getUnsupportedAudioCodec('/path/to/video1.mp4');
      assert.strictEqual(ffmpegVersionCalls, 1, 'Should check ffmpeg once');

      await converter.getUnsupportedAudioCodec('/path/to/video2.mp4');
      assert.strictEqual(ffmpegVersionCalls, 1, 'Should not check ffmpeg again');
    });

    test('returns null from getUnsupportedAudioCodec when ffmpeg unavailable', async () => {
      const converter = new VideoAudioConverter();
      stubFfmpegUnavailable();

      const result = await converter.getUnsupportedAudioCodec('/path/to/video.mp4');
      assert.strictEqual(result, null);
    });

    test('caches unavailability — does not retry', async () => {
      const converter = new VideoAudioConverter();
      let ffmpegVersionCalls = 0;

      execFileStub.callsFake((cmd: string, args: string[], opts: any, callback?: Function) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'ffmpeg' && args[0] === '-version') {
          ffmpegVersionCalls++;
        }
        cb(new Error(`Command not found: ${cmd}`));
        return {} as any;
      });

      await converter.getUnsupportedAudioCodec('/path/to/video1.mp4');
      await converter.getUnsupportedAudioCodec('/path/to/video2.mp4');

      assert.strictEqual(ffmpegVersionCalls, 1, 'Should only check ffmpeg once even when unavailable');
    });
  });
});
