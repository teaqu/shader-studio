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
            width: 320,
            height: 180
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

  test('accepts image aspect ratio resolution when fixed dimensions are absent', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: {
          inputs: {},
          resolution: {
            scale: 2,
            aspectRatio: '16:9'
          }
        }
      }
    });
  });

  test('reserves vertex as an explicit source-only pass for GLSL and Slang files', () => {
    const vertexSchema = schema.definitions.ShaderPasses.properties.vertex;
    assert.deepStrictEqual(vertexSchema, { $ref: '#/definitions/VertexPass' });
    assert.ok(
      Object.keys(schema.definitions.ShaderPasses.patternProperties)
        .every((pattern) => !new RegExp(pattern).test('vertex')),
      'vertex must not be matched as a generic render-buffer name',
    );

    for (const vertexPath of ['shader.vertex.glsl', 'shader.vertex.slang']) {
      assertValid({
        version: '1.0',
        passes: {
          Image: {},
          vertex: { path: vertexPath },
        },
      });
    }

    for (const unsupportedProperty of [
      { inputs: {} },
      { resolution: { scale: 0.5 } },
    ]) {
      assertInvalid({
        version: '1.0',
        passes: {
          Image: {},
          vertex: {
            path: 'shader.vertex.slang',
            ...unsupportedProperty,
          },
        },
      }, 'should NOT have additional properties');
    }

    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: 'buffer', source: 'vertex' },
          },
        },
        vertex: { path: 'shader.vertex.slang' },
      },
    }, 'should match pattern');
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
            iChannel1: { type: 'video', path: 'video.mp4', filter: 'linear', wrap: 'clamp', vflip: false, muted: true },
            iChannel2: { type: 'cubemap', path: 'skybox.png', filter: 'nearest', wrap: 'repeat', vflip: true },
            iChannel3: { type: 'audio', path: 'music.mp3', startTime: 1, endTime: 4, muted: false },
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

  test('rejects non-boolean muted on media inputs', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: 'video', path: 'video.mp4', muted: 'yes' }
          }
        }
      }
    }, 'should be boolean');
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

  test('rejects legacy image custom dimension names', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          resolution: {
            customWidth: 320,
            customHeight: 180
          }
        }
      }
    }, 'should NOT have additional properties');
  });

  test('rejects string image and buffer dimensions', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          resolution: {
            width: '320px',
            height: 180
          }
        },
        BufferA: {
          path: 'buffer-a.glsl',
          resolution: {
            width: 512,
            height: '256'
          }
        }
      }
    }, 'should be number');
  });

  test('rejects image aspect ratio when fixed dimensions are set', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          resolution: {
            width: 320,
            height: 180,
            aspectRatio: '16:9'
          }
        }
      }
    }, 'should NOT have additional properties');
  });

  test('rejects unpaired image dimensions and mixed buffer resolution modes', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          resolution: {
            width: 320
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
    }, "should have required property 'height'");
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
