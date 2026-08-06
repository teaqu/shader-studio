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

  test('accepts every supported image and buffer geometry type plus omission', () => {
    for (const type of ['fullscreen', 'plane', 'cube', 'sphere']) {
      assertValid({
        version: '1.0',
        passes: {
          Image: { geometry: { type } },
          BufferA: { path: 'buffer-a.glsl', geometry: { type } }
        }
      });
    }

    assertValid({
      version: '1.0',
      passes: { Image: {} }
    });
  });

  test('accepts a vertex source path on renderable passes but not Common', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: { geometry: { type: 'cube' }, vertex: 'image.vert.glsl' },
        BufferA: { path: 'buffer.glsl', vertex: 'buffer.vert.glsl' },
      },
    });
    assertInvalid({
      version: '1.0',
      passes: { Image: {}, common: { path: 'common.glsl', vertex: 'bad.vert.glsl' } },
    }, 'should NOT have additional properties');
  });

  test('rejects malformed image and buffer geometry objects', () => {
    const malformedCases: Array<[unknown, string]> = [
      [null, 'should be object'],
      ['sphere', 'should be object'],
      [[], 'should be object'],
      [{}, "should have required property 'type'"],
      [{ type: null }, 'should be equal to one of the allowed values'],
      [{ type: 'sphere', extra: true }, 'should NOT have additional properties']
    ];

    for (const [geometry, expectedMessage] of malformedCases) {
      assertInvalid({
        version: '1.0',
        passes: {
          Image: { geometry },
          BufferA: { path: 'buffer-a.glsl', geometry }
        }
      }, expectedMessage);
    }
  });

  test('rejects unknown geometry types', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: { geometry: { type: 'torus' } }
      }
    }, 'should be equal to one of the allowed values');
  });

  test('rejects geometry on the Common pass', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {},
        common: { path: 'common.glsl', geometry: { type: 'cube' } }
      }
    }, 'should NOT have additional properties');
  });

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

  test('accepts storage and all compute pass configuration fields', () => {
    assertValid({
      version: '1.0',
      storage: {
        particles: { count: 4096, stride: 64, elementType: 'ParticleData' },
        counters: { count: 4, stride: 4, elementType: 'Atomic<uint>' }
      },
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: 'buffer', source: 'ComputeSim', layer: 2 }
          }
        },
        ComputeInit: {
          path: 'init.slang',
          dispatch: { count: 4096 },
          dispatchOnce: true
        },
        ComputeSim: {
          path: 'sim.slang',
          inputs: {
            iChannel0: { type: 'texture', path: 'noise.png' }
          },
          resolution: { scale: 0.5 },
          outputLayers: 3,
          dispatch: { x: 4, y: 2, z: 1 },
          dispatchCount: 6,
          dispatchOnce: false,
          entryPoint: 'simulateKernel'
        },
        ComputePresent: {
          path: 'present.slang',
          inputs: {
            iChannel0: { type: 'buffer', source: 'ComputeSim', layer: 1 }
          },
          resolution: { width: 320, height: 180 },
          outputLayers: 1,
          dispatch: { cover: 'iChannel0' }
        }
      }
    });
  });

  test('validates every compute example config and its referenced shader files', () => {
    const examplesRoot = path.resolve(path.dirname(schemaPath), '../../examples');
    const expectedConfigs = [
      'compute-blur/blur.sha.json',
      'compute-particles/particles.sha.json',
      'compute-substeps/substeps.sha.json'
    ];
    const requiredExampleFiles = [
      'compute-particles/image.slang'
    ];

    assert.ok(fs.existsSync(examplesRoot), `Missing examples directory: ${examplesRoot}`);

    const configPaths = fs.readdirSync(examplesRoot, { recursive: true, encoding: 'utf8' })
      .filter(filePath => filePath.endsWith('.sha.json'))
      .map(filePath => filePath.split(path.sep).join('/'))
      .sort();
    assert.deepStrictEqual(configPaths, expectedConfigs);

    for (const relativeFilePath of requiredExampleFiles) {
      assert.ok(
        fs.existsSync(path.join(examplesRoot, relativeFilePath)),
        `Missing required example file: ${relativeFilePath}`
      );
    }

    for (const relativeConfigPath of configPaths) {
      const configPath = path.join(examplesRoot, relativeConfigPath);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assertValid(config);

      const configDirectory = path.dirname(configPath);
      const imagePath = configPath.replace(/\.sha\.json$/i, '.slang');
      assert.ok(fs.existsSync(imagePath), `Missing Image shader for ${relativeConfigPath}: ${imagePath}`);

      for (const [passName, passConfig] of Object.entries(config.passes as Record<string, { path?: string }>)) {
        if (!passConfig.path) {
          continue;
        }
        const passPath = path.resolve(configDirectory, passConfig.path);
        assert.ok(fs.existsSync(passPath), `Missing ${passName} shader for ${relativeConfigPath}: ${passPath}`);
      }
    }
  });

  test('accepts dispatchOnce with dispatchCount greater than one for graph validation', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: {},
        ComputeInit: {
          path: 'init.slang',
          dispatchOnce: true,
          dispatchCount: 6
        }
      }
    });
  });

  test('accepts dispatchCount at the runtime maximum', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: {},
        ComputeSim: {
          path: 'sim.slang',
          dispatchCount: 1024
        }
      }
    });
  });

  test('rejects compute output layer counts outside one through eight', () => {
    for (const outputLayers of [0, 9]) {
      assertInvalid({
        version: '1.0',
        passes: {
          Image: {},
          ComputeSim: { path: 'sim.slang', outputLayers }
        }
      }, outputLayers === 0 ? 'should be >= 1' : 'should be <= 8');
    }
  });

  test('rejects deprecated compute workgroupSize', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {},
        ComputeSim: { path: 'sim.slang', workgroupSize: [8, 8, 1] }
      }
    }, 'should NOT have additional properties');
  });

  test('rejects malformed compute dispatch variants and additional fields', () => {
    const dispatches = [
      {},
      { count: 0 },
      { count: 1.5 },
      { count: 4, cover: 'particles' },
      { x: 1, y: 1 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1.5, z: 1 },
      { x: 1, y: 1, z: 1, extra: true },
      { cover: '' },
      { cover: '   ' }
    ];

    for (const dispatch of dispatches) {
      assertInvalid({
        version: '1.0',
        passes: {
          Image: {},
          ComputeSim: { path: 'sim.slang', dispatch }
        }
      }, 'should');
    }
  });

  test('rejects missing compute paths and invalid dispatch counts', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {},
        ComputeSim: { dispatch: { count: 1 } }
      }
    }, "should have required property 'path'");

    for (const dispatchCount of [0, 1.5, 1025]) {
      assertInvalid({
        version: '1.0',
        passes: {
          Image: {},
          ComputeSim: { path: 'sim.slang', dispatchCount }
        }
      }, dispatchCount === 0
        ? 'should be >= 1'
        : dispatchCount === 1025
          ? 'should be <= 1024'
          : 'should be integer');
    }

    assertInvalid({
      version: '1.0',
      passes: {
        Image: {},
        ComputeSim: { path: 'sim.slang', unexpected: true }
      }
    }, 'should NOT have additional properties');
  });

  test('wraps described references so draft-07 retains field descriptions', () => {
    const describedReferences = [
      [schema.definitions.ComputePass.properties.dispatchCount, '#/definitions/DispatchCount'],
      [schema.definitions.StorageBuffer.properties.count, '#/definitions/PositiveInteger'],
      [schema.definitions.StorageBuffer.properties.stride, '#/definitions/PositiveInteger']
    ];

    for (const [field, expectedReference] of describedReferences) {
      assert.strictEqual(typeof field.description, 'string');
      assert.ok(field.description.length > 0);
      assert.strictEqual('$ref' in field, false);
      assert.deepStrictEqual(field.allOf, [{ $ref: expectedReference }]);
    }

    assert.deepStrictEqual(schema.definitions.DispatchCount, {
      type: 'integer',
      minimum: 1,
      maximum: 1024
    });
  });

  test('rejects missing or invalid storage fields', () => {
    const storageEntries = [
      { stride: 16, elementType: 'float4' },
      { count: 4, elementType: 'float4' },
      { count: 4, stride: 16 },
      { count: 0, stride: 16, elementType: 'float4' },
      { count: 1.5, stride: 16, elementType: 'float4' },
      { count: 4, stride: 0, elementType: 'float4' },
      { count: 4, stride: 1.5, elementType: 'float4' },
      { count: 4, stride: 16, elementType: '' },
      { count: 4, stride: 16, elementType: '   ' },
      { count: 4, stride: 16, elementType: 'float4', extra: true }
    ];

    for (const entry of storageEntries) {
      assertInvalid({
        version: '1.0',
        storage: { particles: entry },
        passes: { Image: {} }
      }, 'storage');
    }
  });

  test('rejects negative buffer input layers', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: 'buffer', source: 'ComputeSim', layer: -1 }
          }
        },
        ComputeSim: { path: 'sim.slang' }
      }
    }, 'should be >= 0');
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
