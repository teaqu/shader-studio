import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import Ajv = require('ajv');
import {
  BLEND_MODES,
  CULL_MODES,
  DEFAULT_BLEND_MODE,
  DEFAULT_CLEAR_COLOR,
  DEFAULT_CULL_MODE,
  DEFAULT_DEPTH_COMPARE,
  DEFAULT_INSTANCE_COUNT,
  DEFAULT_MESH_TOPOLOGY,
  DEFAULT_SAMPLE_COUNT,
  DEFAULT_VERTEX_COUNT,
  DEFAULT_VERTEX_SPACE,
  DEFAULT_VERTEX_TOPOLOGY,
  DEPTH_COMPARE_FUNCTIONS,
  GEOMETRY_TYPES,
  MAX_INSTANCE_COUNT,
  MESH_TOPOLOGIES,
  SAMPLE_COUNTS,
  MAX_VERTEX_COUNT,
  VERTEX_SPACES,
  VERTEX_TOPOLOGIES,
} from '@shader-studio/types';

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

  test('accepts native stages and a creation preference without changing compute selections', () => {
    for (const entryPoints of [{}, { vertex: 'vertices', fragment: 'image' }, { fragment: 'image' }]) {
      assertValid({ version: '1.0', webgpu: { defaultRenderAuthoring: 'native' }, passes: {
        Image: { entryPoints }, BufferA: { path: 'scene.wgsl', entryPoints },
        Simulation: { type: 'compute', path: 'scene.wgsl', entryPoints: { compute: 'simulate' } }
      } });
    }
    assertValid({ version: '1.0', webgpu: { defaultRenderAuthoring: 'hooks' }, passes: { Image: {} } });
  });

  test('rejects malformed stage selections, conflicting vertex files and unknown authoring settings', () => {
    const cases: Array<[unknown, string]> = [
      [{ Image: { entryPoints: null } }, 'should be object'],
      [{ Image: { entryPoints: { fragment: 'bad name' } } }, 'should match pattern'],
      [{ Image: { entryPoints: { compute: 'simulate' } } }, 'should NOT have additional properties'],
      [{ Image: { entryPoints: {}, vertex: 'other.wgsl' } }, 'should NOT be valid'],
      [{ Image: {}, common: { path: 'common.wgsl', entryPoints: {} } }, 'should NOT have additional properties'],
      [{ Image: {}, Simulation: { type: 'compute', path: 'scene.wgsl', entryPoints: { fragment: 'image' } } }, 'should NOT have additional properties']
    ];
    for (const [passes, message] of cases) {
      assertInvalid({ version: '1.0', passes }, message);
    }
    assertInvalid({ version: '1.0', webgpu: { defaultRenderAuthoring: 'invalid' }, passes: { Image: {} } }, 'should be equal to one of the allowed values');
    assertInvalid({ version: '1.0', webgpu: { unknown: true }, passes: { Image: {} } }, 'should NOT have additional properties');
  });

  test('accepts every supported image and buffer geometry type plus omission', () => {
    for (const type of ['fullscreen', 'vertices', 'plane', 'cube', 'sphere']) {
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

  test('accepts a model path and optional mesh selection', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: { geometry: { type: 'model', path: './cat.glb', mesh: 'CatBody' } },
        BufferA: { path: 'head.glsl', geometry: { type: 'model', path: './cat.glb', mesh: 'CatHead' } },
      },
    });
    assertInvalid({ version: '1.0', passes: { Image: { geometry: { type: 'model' } } } }, "should have required property 'path'");
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

  test('accepts vertexCount, topology and space on vertices geometry', () => {
    for (const topology of VERTEX_TOPOLOGIES) {
      for (const space of VERTEX_SPACES) {
        assertValid({
          version: '1.0',
          passes: {
            Image: { geometry: { type: 'vertices', vertexCount: 6, topology, space } },
            BufferA: { path: 'buffer-a.glsl', geometry: { type: 'vertices', topology } },
          },
        });
      }
    }
    for (const vertexCount of [1, 3, 2147483647]) {
      assertValid({ version: '1.0', passes: { Image: { geometry: { type: 'vertices', vertexCount } } } });
    }
  });

  test('keeps geometry and vertices fields in sync with the shared config types', () => {
    const branches: Array<{ properties: Record<string, { const?: string; enum?: string[]; default?: unknown; maximum?: number }> }> =
      schema.definitions.GeometryConfig.oneOf;
    const types = branches.flatMap((branch) => branch.properties.type.const ?? branch.properties.type.enum ?? []);
    assert.deepStrictEqual([...types].sort(), [...GEOMETRY_TYPES].sort());
    const vertices = branches.find((branch) => branch.properties.type.const === 'vertices')!;
    assert.deepStrictEqual(vertices.properties.topology.enum, [...VERTEX_TOPOLOGIES]);
    assert.strictEqual(vertices.properties.topology.default, DEFAULT_VERTEX_TOPOLOGY);
    assert.deepStrictEqual(vertices.properties.space.enum, [...VERTEX_SPACES]);
    assert.strictEqual(vertices.properties.space.default, DEFAULT_VERTEX_SPACE);
    assert.strictEqual(vertices.properties.vertexCount.maximum, MAX_VERTEX_COUNT);
    assert.strictEqual(vertices.properties.vertexCount.default, DEFAULT_VERTEX_COUNT);
  });

  test('keeps blend, clear, depth and cull values in sync with the shared config types', () => {
    const { BlendMode, ClearColor, DepthSettings, CullMode } = schema.definitions;
    assert.deepStrictEqual(BlendMode.enum, [...BLEND_MODES]);
    assert.strictEqual(BlendMode.default, DEFAULT_BLEND_MODE);
    assert.deepStrictEqual(ClearColor.default, [...DEFAULT_CLEAR_COLOR]);
    assert.deepStrictEqual(DepthSettings.properties.compare.enum, [...DEPTH_COMPARE_FUNCTIONS]);
    assert.strictEqual(DepthSettings.properties.compare.default, DEFAULT_DEPTH_COMPARE);
    assert.deepStrictEqual(CullMode.enum, [...CULL_MODES]);
    assert.strictEqual(CullMode.default, DEFAULT_CULL_MODE);
  });

  test('rejects out-of-range and non-integer vertex counts', () => {
    const cases: Array<[unknown, string]> = [
      [0, 'should be >= 1'],
      [-3, 'should be >= 1'],
      [2147483648, 'should be <= 2147483647'],
      [1.5, 'should be integer'],
      ['6', 'should be integer'],
    ];
    for (const [vertexCount, expectedMessage] of cases) {
      assertInvalid({
        version: '1.0',
        passes: { Image: { geometry: { type: 'vertices', vertexCount } } },
      }, expectedMessage);
    }
  });

  test('rejects unknown topologies, including fan and loop, and unknown spaces', () => {
    for (const topology of ['triangle-fan', 'line-loop', 'points', '']) {
      assertInvalid({
        version: '1.0',
        passes: { Image: { geometry: { type: 'vertices', topology } } },
      }, 'should be equal to one of the allowed values');
    }
    for (const space of ['screen', 'object', '']) {
      assertInvalid({
        version: '1.0',
        passes: { Image: { geometry: { type: 'vertices', space } } },
      }, 'should be equal to one of the allowed values');
    }
  });

  test('rejects vertexCount and space on fullscreen, mesh and model geometry, and topology on fullscreen', () => {
    assertInvalid({
      version: '1.0',
      passes: { Image: { geometry: { type: 'fullscreen', topology: 'triangle-list' } } },
    }, 'should NOT have additional properties');
    const others = [{ type: 'fullscreen' }, { type: 'plane' }, { type: 'cube' }, { type: 'sphere' }, { type: 'model', path: './cat.glb' }];
    for (const geometry of others) {
      for (const extra of [{ vertexCount: 6 }, { space: 'clip' }]) {
        assertInvalid({
          version: '1.0',
          passes: { Image: {}, BufferA: { path: 'buffer-a.glsl', geometry: { ...geometry, ...extra } } },
        }, 'should NOT have additional properties');
      }
    }
  });

  test('accepts the mesh topologies on plane, cube, sphere and model geometry', () => {
    const meshes = [{ type: 'plane' }, { type: 'cube' }, { type: 'sphere' }, { type: 'model', path: './cat.glb' }];
    for (const geometry of meshes) {
      for (const topology of MESH_TOPOLOGIES) {
        assertValid({ version: '1.0', passes: { Image: {}, BufferA: { path: 'buffer-a.glsl', geometry: { ...geometry, topology } } } });
      }
    }
  });

  test('rejects strip and unknown topologies on mesh geometry', () => {
    for (const topology of ['triangle-strip', 'line-strip', 'triangle-fan', '']) {
      assertInvalid({
        version: '1.0',
        passes: { Image: { geometry: { type: 'sphere', topology } } },
      }, 'should be equal to one of the allowed values');
    }
  });

  test('keeps the mesh topologies in sync with the shared config types', () => {
    assert.deepStrictEqual(schema.definitions.MeshTopology.enum, [...MESH_TOPOLOGIES]);
    assert.strictEqual(schema.definitions.MeshTopology.default, DEFAULT_MESH_TOPOLOGY);
  });

  test('accepts instanceCount on every geometry except fullscreen', () => {
    const geometries = [
      { type: 'vertices', vertexCount: 6, topology: 'line-list', space: 'clip' },
      { type: 'plane' },
      { type: 'cube' },
      { type: 'sphere' },
      { type: 'model', path: './cat.glb', mesh: 'Body' },
    ];
    for (const geometry of geometries) {
      for (const instanceCount of [1, 64, 2147483647]) {
        assertValid({ version: '1.0', passes: { Image: { geometry: { ...geometry, instanceCount } } } });
        assertValid({ version: '1.0', passes: { Image: {}, BufferA: { path: 'buffer-a.glsl', geometry: { ...geometry, instanceCount } } } });
      }
    }
  });

  test('rejects instanceCount on fullscreen geometry', () => {
    assertInvalid({
      version: '1.0',
      passes: { Image: { geometry: { type: 'fullscreen', instanceCount: 2 } } },
    }, 'should NOT have additional properties');
  });

  test('rejects out-of-range and non-integer instance counts', () => {
    const cases: Array<[unknown, string]> = [
      [0, 'should be >= 1'],
      [2147483648, 'should be <= 2147483647'],
      [2.5, 'should be integer'],
      ['4', 'should be integer'],
    ];
    for (const [instanceCount, expectedMessage] of cases) {
      assertInvalid({
        version: '1.0',
        passes: { Image: { geometry: { type: 'cube', instanceCount } } },
      }, expectedMessage);
    }
  });

  test('keeps instanceCount in sync with the shared config types', () => {
    assert.strictEqual(schema.definitions.InstanceCount.maximum, MAX_INSTANCE_COUNT);
    assert.strictEqual(schema.definitions.InstanceCount.default, DEFAULT_INSTANCE_COUNT);
  });

  test('accepts every blend mode on Image and buffer passes of any geometry', () => {
    for (const blend of BLEND_MODES) {
      for (const type of GEOMETRY_TYPES) {
        const geometry = type === 'model' ? { type, path: './cat.glb' } : { type };
        assertValid({
          version: '1.0',
          passes: { Image: { geometry, blend }, BufferA: { path: 'a.glsl', geometry, blend } },
        });
      }
    }
  });

  test('accepts clear colours on Image and buffer passes of any geometry', () => {
    for (const type of GEOMETRY_TYPES) {
      const geometry = type === 'model' ? { type, path: './cat.glb' } : { type };
      assertValid({ version: '1.0', passes: { Image: { geometry, clear: [0, 0.25, 0.5, 1] }, BufferA: { path: 'a.glsl', geometry, clear: [1, 0, 0, 0] } } });
    }
  });

  test('rejects malformed and out-of-range clear colours', () => {
    for (const clear of [false, [0, 0, 0], [0, 0, 0, 1, 1], [-0.1, 0, 0, 1], [0, 0, 0, 1.1], [0, 0, '0', 1]]) {
      assertInvalid({ version: '1.0', passes: { Image: { clear } } }, 'data.passes.Image.clear');
    }
  });

  test('accepts depth and cull on every geometry except fullscreen', () => {
    for (const type of GEOMETRY_TYPES.filter((candidate) => candidate !== 'fullscreen')) {
      const geometry = type === 'model' ? { type, path: './cat.glb' } : { type };
      for (const compare of DEPTH_COMPARE_FUNCTIONS) {
        assertValid({
          version: '1.0',
          passes: {
            Image: { geometry, depth: { test: false, write: false, compare } },
            BufferA: { path: 'a.glsl', geometry, depth: {} },
          },
        });
      }
      for (const cull of CULL_MODES) {
        assertValid({ version: '1.0', passes: { Image: { geometry, cull }, BufferA: { path: 'a.glsl', geometry, cull } } });
      }
      for (const samples of SAMPLE_COUNTS) {
        assertValid({ version: '1.0', passes: { Image: { geometry, samples }, BufferA: { path: 'a.glsl', geometry, samples } } });
      }
    }
  });

  test('rejects sample counts other than 1 and 4', () => {
    for (const samples of [0, 2, 8, '4', 4.5]) {
      assertInvalid({ version: '1.0', passes: { Image: { geometry: { type: 'cube' }, samples } } }, 'should be equal to one of the allowed values');
    }
  });

  test('keeps the sample counts in sync with the shared config types', () => {
    assert.deepStrictEqual(schema.definitions.SampleCount.enum, [...SAMPLE_COUNTS]);
    assert.strictEqual(schema.definitions.SampleCount.default, DEFAULT_SAMPLE_COUNT);
  });

  test('rejects depth and cull on fullscreen geometry, including when geometry is omitted', () => {
    for (const pass of [{ geometry: { type: 'fullscreen' } }, {}]) {
      for (const setting of [{ depth: { test: true } }, { depth: {} }, { cull: 'back' }, { cull: 'none' }, { samples: 4 }, { samples: 1 }]) {
        assertInvalid({ version: '1.0', passes: { Image: { ...pass, ...setting } } }, 'should match "then" schema');
        assertInvalid({ version: '1.0', passes: { Image: {}, BufferA: { path: 'a.glsl', ...pass, ...setting } } }, 'should match "then" schema');
      }
    }
  });

  test('rejects unknown blend, compare and cull values and non-boolean depth flags', () => {
    const geometry = { type: 'cube' };
    const cases: unknown[] = [
      { blend: 'multiply' },
      { blend: true },
      { cull: 'both' },
      { cull: 'cw' },
      { depth: { compare: 'lequal' } },
      { depth: { test: 'yes' } },
      { depth: { write: 1 } },
    ];
    for (const setting of cases) {
      assertInvalid({ version: '1.0', passes: { Image: { geometry, ...(setting as object) } } }, 'data.passes.Image');
    }
    assertInvalid({ version: '1.0', passes: { Image: { geometry, depth: { test: true, stencil: true } } } }, 'should NOT have additional properties');
  });

  test('rejects blend, clear, depth and cull on compute and Common passes', () => {
    for (const setting of [{ blend: 'additive' }, { clear: [0, 0, 0, 1] }, { depth: { test: false } }, { cull: 'back' }, { samples: 4 }]) {
      assertInvalid({
        version: '1.0',
        passes: { Image: {}, Sim: { type: 'compute', path: 'sim.slang', ...setting } },
      }, 'should NOT have additional properties');
      assertInvalid({
        version: '1.0',
        passes: { Image: {}, common: { path: 'common.glsl', ...setting } },
      }, 'data.passes.common should NOT have additional properties');
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
    // Common is its own definition with no geometry and no additional
    // properties, so the rejection names the offending pass rather than
    // reporting a failed branch of a union.
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {},
        common: { path: 'common.glsl', geometry: { type: 'cube' } }
      }
    }, 'data.passes.common should NOT have additional properties');
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
            previousFrame: { type: 'buffer', source: 'BufferA', filter: 'nearest', wrap: 'repeat' }
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

  test('rejects unsupported buffer sampling values', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {
          inputs: {
            state: { type: 'buffer', source: 'BufferA', filter: 'cubic' }
          }
        }
      }
    }, 'should NOT have additional properties');
  });

  test('accepts storage and all compute pass configuration fields', () => {
    assertValid({
      version: '1.0',
      storage: {
        particles: { count: 4096, elementType: 'ParticleData' },
        counters: { count: 4, elementType: 'Atomic<uint>' }
      },
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: 'buffer', source: 'ComputeSim', layer: 2 }
          }
        },
        ComputeInit: { type: 'compute',
          path: 'init.slang',
          dispatch: { count: 4096 },
          dispatchOnce: true
        },
        ComputeSim: { type: 'compute',
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
        ComputePresent: { type: 'compute',
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

  test('accepts producer output formats but rejects them on Image', () => {
    for (const outputFormat of ['auto', 'rgba16float', 'rgba32float']) {
      assertValid({
        version: '1.0',
        passes: {
          Image: {},
          BufferA: { path: 'a.wgsl', outputFormat },
          Compute: { type: 'compute', path: 'c.wgsl', outputFormat },
        },
      });
    }
    assertInvalid({ version: '1.0', passes: { Image: { outputFormat: 'rgba32float' } } }, 'should NOT have additional properties');
    assertInvalid({ version: '1.0', passes: { Image: {}, BufferA: { path: 'a.wgsl', outputFormat: 'rgba8unorm' } } }, 'should be equal to one of the allowed values');
  });

  test('accepts bounded named render outputs and render-output channel selection', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: { inputs: { iChannel0: { type: 'buffer', source: 'Scene', output: 1 } } },
        Scene: { path: 'scene.wgsl', outputs: [{ name: 'Colour' }, { name: 'Normals + depth' }] },
      },
    });
    assertValid({ version: '1.0', passes: { Image: {}, Scene: { path: 'scene.wgsl', outputs: [{}] } } });
  });

  test('rejects malformed render outputs and output selection outside buffer inputs', () => {
    const base = { version: '1.0', passes: { Image: {}, Scene: { path: 'scene.wgsl' } } };
    assertInvalid({ ...base, passes: { ...base.passes, Scene: { path: 'scene.wgsl', outputs: [] } } }, 'should NOT have fewer than 1 items');
    assertInvalid({ ...base, passes: { ...base.passes, Scene: { path: 'scene.wgsl', outputs: Array.from({ length: 9 }, () => ({})) } } }, 'should NOT have more than 8 items');
    assertInvalid({ ...base, passes: { ...base.passes, Scene: { path: 'scene.wgsl', outputs: [{ name: '' }] } } }, 'should NOT be shorter than 1 characters');
    assertInvalid({ version: '1.0', passes: { Image: { outputs: [{}] } } }, 'should NOT have additional properties');
    assertInvalid({ version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'texture', path: 'x.png', output: 1 } } } } }, 'should NOT have additional properties');
  });

  test('accepts storage without stride', () => {
    assertValid({
      version: '1.0',
      storage: { particles: { count: 4096, elementType: 'float4' } },
      passes: { Image: {} }
    });

    const particlesPath = path.resolve(__dirname, '../../../../tests/fixtures/shader-corpus/slang/particles.sha.json');
    assertValid(JSON.parse(fs.readFileSync(particlesPath, 'utf8')));
  });

  test('accepts a compute pass with an arbitrary name when type is compute', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: {},
        CompA: { type: 'compute', path: 'sim.slang', dispatch: { count: 64 } },
      },
    });
  });

  test('accepts dispatchOnce with dispatchCount greater than one for graph validation', () => {
    assertValid({
      version: '1.0',
      passes: {
        Image: {},
        ComputeInit: { type: 'compute',
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
        ComputeSim: { type: 'compute',
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
          ComputeSim: { type: 'compute', path: 'sim.slang', outputLayers }
        }
      }, outputLayers === 0 ? 'should be >= 1' : 'should be <= 8');
    }
  });

  test('rejects deprecated compute workgroupSize', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {},
        ComputeSim: { type: 'compute', path: 'sim.slang', workgroupSize: [8, 8, 1] }
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
          ComputeSim: { type: 'compute', path: 'sim.slang', dispatch }
        }
      }, 'should');
    }
  });

  test('rejects missing compute paths and invalid dispatch counts', () => {
    assertInvalid({
      version: '1.0',
      passes: {
        Image: {},
        CompA: { path: 'sim.slang', dispatch: { count: 1 } },
      },
    }, 'should match exactly one schema in oneOf');

    assertInvalid({
      version: '1.0',
      passes: {
        Image: {},
        ComputeSim: { type: 'compute', dispatch: { count: 1 } }
      }
    }, "should have required property 'path'");

    for (const dispatchCount of [0, 1.5, 1025]) {
      assertInvalid({
        version: '1.0',
        passes: {
          Image: {},
          ComputeSim: { type: 'compute', path: 'sim.slang', dispatchCount }
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
        ComputeSim: { type: 'compute', path: 'sim.slang', unexpected: true }
      }
    }, 'should NOT have additional properties');
  });

  test('wraps described references so draft-07 retains field descriptions', () => {
    const describedReferences = [
      [schema.definitions.ComputePass.properties.dispatchCount, '#/definitions/DispatchCount'],
      [schema.definitions.StorageBuffer.properties.count, '#/definitions/PositiveInteger']
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
      { elementType: 'float4' },
      { count: 4 },
      { count: 0, elementType: 'float4' },
      { count: 1.5, elementType: 'float4' },
      { count: 4, elementType: '' },
      { count: 4, elementType: '   ' },
      { count: 4, elementType: 'float4', extra: true },
      // stride was removed from the schema: runtime always auto-infers it,
      // so a config that still sets it is rejected as an unknown property.
      { count: 4, elementType: 'float4', stride: 16 }
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
        ComputeSim: { type: 'compute', path: 'sim.slang' }
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
