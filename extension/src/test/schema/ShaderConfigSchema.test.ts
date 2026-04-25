import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import Ajv = require('ajv');

suite('Shader config JSON schema', () => {
  const schemaPath = path.resolve(__dirname, '../../../schemas/shader-config.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  function assertValid(config: unknown): void {
    const valid = validate(config);
    assert.strictEqual(valid, true, ajv.errorsText(validate.errors));
  }

  function assertInvalid(config: unknown, expectedMessage: string): void {
    const valid = validate(config);
    assert.strictEqual(valid, false, 'Expected config to be invalid');
    assert.ok(
      ajv.errorsText(validate.errors).includes(expectedMessage),
      `Expected "${expectedMessage}" in ${ajv.errorsText(validate.errors)}`
    );
  }

  test('accepts image and buffer resolution settings plus current polling field', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: {
          inputs: {},
          resolution: {
            scale: 2,
            aspectRatio: '16:9',
            customWidth: '320px',
            customHeight: 180
          }
        },
        BufferA: {
          path: 'buffer-a.glsl',
          inputs: {},
          resolution: {
            width: 512,
            height: 256
          }
        },
        BufferB: {
          path: 'buffer-b.glsl',
          resolution: {
            scale: 0.5
          }
        }
      },
      scriptMaxPollingFps: 30
    });
  });

  test('accepts every supported input type with persisted fields', () => {
    assertValid({
      version: '1.0',
      script: 'uniforms.ts',
      scriptMaxPollingFps: 60,
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: 'texture', path: 'texture.png', filter: 'mipmap', wrap: 'repeat', vflip: true, grayscale: true },
            iChannel1: { type: 'video', path: 'video.mp4', filter: 'linear', wrap: 'clamp', vflip: false },
            iChannel2: { type: 'cubemap', path: 'skybox.png', filter: 'nearest', wrap: 'repeat', vflip: true },
            iChannel3: { type: 'audio', path: 'music.mp3', startTime: 1, endTime: 4 },
            iKeyboard: { type: 'keyboard' },
            previousFrame: { type: 'buffer', source: 'BufferA' }
          }
        },
        BufferA: {
          path: 'buffer-a.glsl',
          inputs: {}
        },
        common: {
          path: 'common.glsl'
        }
      }
    });
  });

  test('rejects unknown top-level, pass, input, and resolution properties', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          inputs: {},
          resolution: {
            width: 100
          },
          path: 'image.glsl'
        },
        BufferA: {
          path: 'buffer-a.glsl',
          inputs: {
            iChannel0: { type: 'keyboard', path: 'keyboard.png' }
          },
          resolution: {
            customWidth: 100
          }
        }
      },
      unexpected: true
    }, 'should NOT have additional properties');
  });

  test('rejects unpaired image custom dimensions and mixed buffer resolution modes', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          resolution: {
            customWidth: 320
          }
        },
        BufferA: {
          path: 'buffer-a.glsl',
          resolution: {
            width: 512,
            height: 512,
            scale: 0.5
          }
        }
      }
    }, 'should have property customHeight');
  });

  test('rejects transient resolved paths in persisted config JSON', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          inputs: {
            iChannel0: {
              type: 'texture',
              path: 'texture.png',
              resolved_path: 'https://webview-uri/texture.png'
            }
          }
        }
      }
    }, 'should NOT have additional properties');
  });

  test('rejects invalid enum values and out-of-range polling fps', () => {
    assertInvalid({
      version: '1.0',
      scriptMaxPollingFps: 0,
      passes: {
        Image: {
          resolution: {
            aspectRatio: '21:9'
          },
          inputs: {
            iChannel0: { type: 'texture', path: 'texture.png', filter: 'trilinear', wrap: 'mirror' }
          }
        }
      }
    }, 'should be >= 1');
  });
});
