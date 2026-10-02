import { describe, expect, it } from "vitest";
import { ConfigValidator, validatePassGeometry, validatePassRenderSettings } from "../../util/ConfigValidator";
import type { ShaderConfig } from "@shader-studio/types";

describe("ConfigValidator", () => {
  describe("validateConfig", () => {
    it("should return valid for null config", () => {
      const result = ConfigValidator.validateConfig(null);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid for minimal valid config", () => {
      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      const result = ConfigValidator.validateConfig(config);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    describe("geometry validation", () => {
      it("should accept every supported geometry type on image and buffer passes", () => {
        const geometryTypes = ["fullscreen", "vertices", "plane", "cube", "sphere"] as const;

        for (const type of geometryTypes) {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: { geometry: { type } },
              BufferA: { path: "buffer-a.glsl", geometry: { type } }
            }
          };

          expect(ConfigValidator.validateConfig(config)).toEqual({
            isValid: true,
            errors: []
          });
        }
      });

      it("accepts a model only when it supplies a GLB path", () => {
        expect(ConfigValidator.validateConfig({ version: "1.0", passes: { Image: { geometry: { type: "model", path: "robot.glb", mesh: "Body" } } } })).toEqual({ isValid: true, errors: [] });
        expect(ConfigValidator.validateConfig({ version: "1.0", passes: { Image: { geometry: { type: "model" } } } } as never).isValid).toBe(false);
      });

      it("should keep omitted geometry valid without materializing a default", () => {
        const config: ShaderConfig = {
          version: "1.0",
          passes: { Image: {} }
        };

        expect(ConfigValidator.validateConfig(config)).toEqual({
          isValid: true,
          errors: []
        });
        expect(config.passes.Image).toEqual({});
      });

      it.each([
        null,
        "sphere",
        [],
        {},
        { type: null },
        { type: "sphere", extra: true }
      ])("should reject malformed image geometry %#", (geometry) => {
        const config = {
          version: "1.0",
          passes: { Image: { geometry } }
        };

        expect(ConfigValidator.validateConfig(config as never).isValid).toBe(false);
      });

      it.each([
        null,
        "cube",
        [],
        {},
        { type: null },
        { type: "cube", extra: true }
      ])("should reject malformed buffer geometry %#", (geometry) => {
        const config = {
          version: "1.0",
          passes: {
            Image: {},
            BufferA: { path: "buffer-a.glsl", geometry }
          }
        };

        expect(ConfigValidator.validateConfig(config as never).isValid).toBe(false);
      });

      describe("vertices geometry fields", () => {
        const imageGeometry = (geometry: unknown) =>
          ConfigValidator.validateConfig({ version: "1.0", passes: { Image: { geometry } } } as never);
        const bufferGeometry = (geometry: unknown) =>
          ConfigValidator.validateConfig({ version: "1.0", passes: { Image: {}, BufferA: { path: "a.glsl", geometry } } } as never);
        const countError = (pass: string) => `${pass} pass geometry vertexCount must be an integer from 1 to 2147483647`;
        const topologyError = (pass: string) =>
          `${pass} pass geometry topology must be one of: triangle-list, triangle-strip, line-list, line-strip, point-list`;
        const spaceError = (pass: string) => `${pass} pass geometry space must be one of: world, clip`;
        const typeError = "Image pass geometry type must be one of: fullscreen, vertices, plane, cube, sphere, model";

        it("accepts every topology and space on vertices image and buffer passes", () => {
          for (const topology of ["triangle-list", "triangle-strip", "line-list", "line-strip", "point-list"]) {
            for (const space of ["world", "clip"]) {
              expect(imageGeometry({ type: "vertices", vertexCount: 6, topology, space })).toEqual({ isValid: true, errors: [] });
              expect(bufferGeometry({ type: "vertices", vertexCount: 6, topology, space })).toEqual({ isValid: true, errors: [] });
            }
          }
        });

        it("accepts each field alone and none at all", () => {
          expect(imageGeometry({ type: "vertices" })).toEqual({ isValid: true, errors: [] });
          expect(imageGeometry({ type: "vertices", vertexCount: 12 })).toEqual({ isValid: true, errors: [] });
          expect(imageGeometry({ type: "vertices", topology: "point-list" })).toEqual({ isValid: true, errors: [] });
          expect(imageGeometry({ type: "vertices", space: "clip" })).toEqual({ isValid: true, errors: [] });
        });

        it.each([1, 2, 3, 2147483647])("accepts the boundary vertexCount %d", (vertexCount) => {
          expect(imageGeometry({ type: "vertices", vertexCount })).toEqual({ isValid: true, errors: [] });
        });

        it.each([0, -1, 2147483648, Number.MAX_SAFE_INTEGER, 1.5, 2.000001, Number.NaN, Number.POSITIVE_INFINITY, "6", null, true, [6], {}])(
          "rejects vertexCount %s without clamping",
          (vertexCount) => {
            expect(imageGeometry({ type: "vertices", vertexCount })).toEqual({ isValid: false, errors: [countError("Image")] });
            expect(bufferGeometry({ type: "vertices", vertexCount })).toEqual({ isValid: false, errors: [countError("BufferA")] });
          },
        );

        it.each(["triangle-fan", "line-loop", "points", "TRIANGLE-LIST", "", null, 3, ["line-list"]])("rejects topology %s", (topology) => {
          expect(imageGeometry({ type: "vertices", topology })).toEqual({ isValid: false, errors: [topologyError("Image")] });
          expect(bufferGeometry({ type: "vertices", topology })).toEqual({ isValid: false, errors: [topologyError("BufferA")] });
        });

        it.each(["screen", "object", "WORLD", "", null, 0, ["clip"]])("rejects space %s", (space) => {
          expect(imageGeometry({ type: "vertices", space })).toEqual({ isValid: false, errors: [spaceError("Image")] });
          expect(bufferGeometry({ type: "vertices", space })).toEqual({ isValid: false, errors: [spaceError("BufferA")] });
        });

        it("reports every bad field together", () => {
          expect(imageGeometry({ type: "vertices", vertexCount: 0, topology: "triangle-fan", space: "screen" }).errors)
            .toEqual([countError("Image"), topologyError("Image"), spaceError("Image")]);
        });

        it.each([
          { type: "fullscreen" },
          { type: "plane" },
          { type: "cube" },
          { type: "sphere" },
          { type: "model", path: "robot.glb" },
        ])("rejects vertexCount, topology and space on $type geometry", (geometry) => {
          const type = geometry.type;
          const fieldError = (pass: string, field: string) => `${pass} pass geometry ${field} is only supported for vertices geometry, not ${type}`;
          expect(imageGeometry({ ...geometry, vertexCount: 3 })).toEqual({ isValid: false, errors: [fieldError("Image", "vertexCount")] });
          expect(bufferGeometry({ ...geometry, topology: "triangle-list" })).toEqual({ isValid: false, errors: [fieldError("BufferA", "topology")] });
          expect(bufferGeometry({ ...geometry, space: "world" })).toEqual({ isValid: false, errors: [fieldError("BufferA", "space")] });
          expect(imageGeometry({ ...geometry, vertexCount: 6, topology: "line-list", space: "clip" }).errors).toEqual([
            fieldError("Image", "vertexCount"),
            fieldError("Image", "topology"),
            fieldError("Image", "space"),
          ]);
        });

        it("still rejects unrelated extra properties on vertices geometry", () => {
          expect(imageGeometry({ type: "vertices", vertexCount: 3, extra: true }).errors).toEqual([typeError]);
        });

        it("exposes the same geometry checks as validatePassGeometry for the config panel", () => {
          expect(validatePassGeometry(undefined, "Image")).toEqual([]);
          expect(validatePassGeometry({ type: "vertices", vertexCount: 6, topology: "line-list", space: "clip" }, "BufferA")).toEqual([]);
          expect(validatePassGeometry({ type: "vertices", vertexCount: 0 }, "BufferA")).toEqual([countError("BufferA")]);
          expect(validatePassGeometry({ type: "torus" }, "Image")).toEqual([typeError]);
        });

        it("reports only the type error for vertex fields on unknown geometry", () => {
          expect(imageGeometry({ type: "torus", vertexCount: 3, space: "clip" }).errors).toEqual([typeError]);
        });
      });

      describe("blend, clear, depth and cull", () => {
        const image = (pass: Record<string, unknown>) =>
          ConfigValidator.validateConfig({ version: "1.0", passes: { Image: pass } } as never);
        const buffer = (pass: Record<string, unknown>) =>
          ConfigValidator.validateConfig({ version: "1.0", passes: { Image: {}, BufferA: { path: "a.glsl", ...pass } } } as never);
        const valid = { isValid: true, errors: [] };
        const nonFullscreen = [
          { type: "vertices" },
          { type: "vertices", space: "clip" },
          { type: "plane" },
          { type: "cube" },
          { type: "sphere" },
          { type: "model", path: "robot.glb" },
        ];
        const compareList = "never, less, equal, less-equal, greater, not-equal, greater-equal, always";

        it.each(["none", "alpha", "premultiplied", "additive"])("accepts blend %s on every geometry, including fullscreen and omitted", (blend) => {
          expect(image({ blend })).toEqual(valid);
          expect(buffer({ blend, geometry: { type: "fullscreen" } })).toEqual(valid);
          for (const geometry of nonFullscreen) {
            expect(image({ blend, geometry })).toEqual(valid);
            expect(buffer({ blend, geometry })).toEqual(valid);
          }
        });

        it.each(["multiply", "Additive", "", null, true, 1, ["alpha"], { mode: "alpha" }])("rejects blend %s", (blend) => {
          expect(image({ blend })).toEqual({ isValid: false, errors: ["Image pass blend must be one of: none, alpha, premultiplied, additive"] });
          expect(buffer({ blend })).toEqual({ isValid: false, errors: ["BufferA pass blend must be one of: none, alpha, premultiplied, additive"] });
        });

        it("accepts an RGBA clear colour on every render geometry", () => {
          expect(image({ clear: [0, 0.25, 0.5, 1] })).toEqual(valid);
          for (const geometry of nonFullscreen) {
            expect(buffer({ geometry, clear: [1, 0, 0.5, 0] })).toEqual(valid);
          }
        });

        it.each([false, null, [0, 0, 0], [0, 0, 0, 1, 1], [-0.1, 0, 0, 1], [0, 0, 0, 1.1], [0, 0, "0", 1]])("rejects clear %j", (clear) => {
          expect(image({ clear }).errors).toEqual(["Image pass clear must be four numbers from 0 to 1"]);
        });

        it("accepts every depth combination on non-fullscreen geometry", () => {
          for (const geometry of nonFullscreen) {
            for (const compare of compareList.split(", ")) {
              for (const test of [true, false]) {
                for (const write of [true, false]) {
                  expect(image({ geometry, depth: { test, write, compare } })).toEqual(valid);
                  expect(buffer({ geometry, depth: { test, write, compare } })).toEqual(valid);
                }
              }
            }
            expect(image({ geometry, depth: {} })).toEqual(valid);
          }
        });

        it.each(["lequal", "LESS", "", null, 1, true])("rejects depth compare %s", (compare) => {
          expect(image({ geometry: { type: "cube" }, depth: { compare } }).errors).toEqual([`Image pass depth compare must be one of: ${compareList}`]);
          expect(buffer({ geometry: { type: "vertices" }, depth: { compare } }).errors).toEqual([`BufferA pass depth compare must be one of: ${compareList}`]);
        });

        it.each(["test", "write"])("rejects non-boolean depth %s", (flag) => {
          for (const value of ["true", 1, 0, null, [], {}]) {
            expect(image({ geometry: { type: "cube" }, depth: { [flag]: value } }).errors).toEqual([`Image pass depth ${flag} must be true or false`]);
          }
        });

        it.each([null, true, "less", 1, [true]])("rejects non-object depth %s", (depth) => {
          expect(image({ geometry: { type: "cube" }, depth }).errors).toEqual(["Image pass depth must be an object with test, write and compare"]);
        });

        it("rejects unknown depth fields and reports every bad field together", () => {
          expect(image({ geometry: { type: "cube" }, depth: { stencil: true, test: "on", write: 1, compare: "lequal" } }).errors).toEqual([
            "Image pass depth stencil is not a depth setting; use test, write or compare",
            "Image pass depth test must be true or false",
            "Image pass depth write must be true or false",
            `Image pass depth compare must be one of: ${compareList}`,
          ]);
        });

        it.each(["none", "back", "front"])("accepts cull %s on non-fullscreen geometry", (cull) => {
          for (const geometry of nonFullscreen) {
            expect(image({ geometry, cull })).toEqual(valid);
            expect(buffer({ geometry, cull })).toEqual(valid);
          }
        });

        it.each(["both", "cw", "BACK", "", null, true, 0])("rejects cull %s", (cull) => {
          expect(image({ geometry: { type: "cube" }, cull }).errors).toEqual(["Image pass cull must be one of: none, back, front"]);
        });

        it.each([undefined, { type: "fullscreen" }])("rejects depth and cull on fullscreen geometry (%s)", (geometry) => {
          const pass = geometry ? { geometry } : {};
          expect(image({ ...pass, depth: { test: true } }).errors).toEqual(["Image pass depth is not supported for fullscreen geometry, which has no depth buffer"]);
          expect(buffer({ ...pass, depth: {} }).errors).toEqual(["BufferA pass depth is not supported for fullscreen geometry, which has no depth buffer"]);
          expect(image({ ...pass, cull: "none" }).errors).toEqual(["Image pass cull is not supported for fullscreen geometry"]);
          expect(buffer({ ...pass, cull: "back" }).errors).toEqual(["BufferA pass cull is not supported for fullscreen geometry"]);
        });

        it("reports a bad value and the fullscreen restriction together", () => {
          expect(image({ cull: "both", depth: { compare: "x" } }).errors).toEqual([
            `Image pass depth compare must be one of: ${compareList}`,
            "Image pass cull must be one of: none, back, front",
            "Image pass depth is not supported for fullscreen geometry, which has no depth buffer",
            "Image pass cull is not supported for fullscreen geometry",
          ]);
        });

        it("skips the fullscreen restriction when the geometry itself is invalid", () => {
          expect(image({ geometry: { type: "torus" }, cull: "back" }).errors)
            .toEqual(["Image pass geometry type must be one of: fullscreen, vertices, plane, cube, sphere, model"]);
          expect(image({ geometry: null, depth: {} }).errors)
            .toEqual(["Image pass geometry type must be one of: fullscreen, vertices, plane, cube, sphere, model"]);
        });

        it.each([["blend", "additive"], ["clear", [0, 0, 0, 0]], ["depth", { test: false }], ["cull", "back"]])("rejects %s on compute passes", (field, value) => {
          const result = ConfigValidator.validateConfig({
            version: "1.0",
            passes: { Image: {}, Sim: { type: "compute", path: "sim.slang", [field]: value } },
          } as never);
          expect(result).toEqual({ isValid: false, errors: [`Sim compute pass cannot define ${field}`] });
        });

        it.each([["blend", "none"], ["clear", [0, 0, 0, 1]], ["depth", {}], ["cull", "none"]])("rejects %s on the common pass", (field, value) => {
          const result = ConfigValidator.validateConfig({
            version: "1.0",
            passes: { Image: {}, common: { path: "common.glsl", [field]: value } },
          } as never);
          expect(result).toEqual({ isValid: false, errors: [`common pass cannot define ${field}`] });
        });

        it("exposes the same checks as validatePassRenderSettings for the config panel", () => {
          expect(validatePassRenderSettings(undefined, "Image")).toEqual([]);
          expect(validatePassRenderSettings(null, "Image")).toEqual([]);
          expect(validatePassRenderSettings({}, "Image")).toEqual([]);
          expect(validatePassRenderSettings({ geometry: { type: "cube" }, blend: "alpha", clear: [0, 0, 0, 0], depth: { write: false }, cull: "back" }, "BufferA")).toEqual([]);
          expect(validatePassRenderSettings({ cull: "back" }, "Image")).toEqual(["Image pass cull is not supported for fullscreen geometry"]);
          expect(validatePassRenderSettings({ type: "compute", path: "c.slang", blend: "alpha" }, "Sim")).toEqual(["Sim compute pass cannot define blend"]);
          expect(validatePassRenderSettings({ path: "common.glsl", cull: "back" }, "common")).toEqual(["common pass cannot define cull"]);
          expect(validatePassRenderSettings({ geometry: { type: "vertices", vertexCount: 0 } }, "Image"))
            .toEqual(["Image pass geometry vertexCount must be an integer from 1 to 2147483647"]);
        });
      });

      it("should report the supported types for unknown geometry", () => {
        const config = {
          version: "1.0",
          passes: { Image: { geometry: { type: "torus" } } }
        };

        expect(ConfigValidator.validateConfig(config as never).errors)
          .toContain("Image pass geometry type must be one of: fullscreen, vertices, plane, cube, sphere, model");
      });

      it("should reject a capitalized Common pass name", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {},
            Common: { path: "common.glsl" }
          }
        };

        const result = ConfigValidator.validateConfig(config as never);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid pass name: Common (did you mean "common"?)');
      });

      it("should reject geometry on the Common pass", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {},
            common: { path: "common.glsl", geometry: { type: "sphere" } }
          }
        };

        const result = ConfigValidator.validateConfig(config as never);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("common pass cannot define geometry");
      });

      it("should reject inputs on the Common pass without renderable-input validation", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {},
            common: {
              path: "common.glsl",
              inputs: { "invalid-channel": { type: "unknown" } }
            }
          }
        };

        expect(ConfigValidator.validateConfig(config as never).errors).toEqual([
          "common pass cannot define inputs"
        ]);
      });

      it("should reject resolution on the Common pass", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {},
            common: { path: "common.glsl", resolution: { scale: 0.5 } }
          }
        };

        expect(ConfigValidator.validateConfig(config as never).errors).toEqual([
          "common pass cannot define resolution"
        ]);
      });
    });

    describe("version validation", () => {
      it("should reject config without version", () => {
        const config = {
          passes: { Image: {} }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Config must have a valid version string');
      });

      it("should reject config with non-string version", () => {
        const config = {
          version: 1.0,
          passes: { Image: {} }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Config must have a valid version string');
      });
    });

    describe("passes validation", () => {
      it("should reject config without passes", () => {
        const config = {
          version: "1.0"
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Config must have a passes object');
      });

      it("should reject config with non-object passes", () => {
        const config = {
          version: "1.0",
          passes: "invalid"
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Config must have a passes object');
      });

      it("should reject config without Image pass", () => {
        const config = {
          version: "1.0",
          passes: {}
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Config must have an Image pass');
      });

      it("should reject config with non-object Image pass", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: "invalid"
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Config must have an Image pass');
      });
    });

    describe("buffer pass validation", () => {
      it("should accept buffer pass without path (not yet configured)", () => {
        const config: ShaderConfig = {
          version: "1.0",
          passes: {
            Image: {},
            BufferA: {} as any
          }
        };

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should accept buffer pass with empty path", () => {
        const config: ShaderConfig = {
          version: "1.0",
          passes: {
            Image: {},
            BufferA: { path: '', inputs: {} }
          }
        };

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject buffer pass with non-string path", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {},
            BufferA: {
              path: 123
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('BufferA pass path must be a string');
      });

      it("should accept valid buffer passes", () => {
        const config: ShaderConfig = {
          version: "1.0",
          passes: {
            Image: {},
            BufferA: { path: "buffer-a.glsl" },
            BufferB: { path: "buffer-b.glsl" },
            BufferC: { path: "buffer-c.glsl" },
            BufferD: { path: "buffer-d.glsl" }
          }
        };

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should accept custom-named buffer passes", () => {
        const config: ShaderConfig = {
          version: "1.0",
          passes: {
            Image: {},
            BlurPass: { path: "blur.glsl" },
            GBuffer: { path: "gbuffer.glsl" },
            depth_buffer: { path: "depth.glsl" }
          }
        };

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject invalid pass names", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {},
            "0invalid": { path: "test.glsl" }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid pass name: 0invalid');
      });
    });

    describe("input validation", () => {
      it("should reject invalid channel names", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                "0invalid": { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Image pass has invalid input channel name: 0invalid');
      });

      it("should accept iChannel names beyond 3", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                iChannel5: { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
      });

      it("should accept custom channel names", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                noiseMap: { type: 'keyboard' },
                diffuseTexture: { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
      });

      it("should accept any number of input channels", () => {
        const inputs: Record<string, any> = {};
        for (let i = 0; i < 33; i++) {
          inputs[`channel${i}`] = { type: 'keyboard' };
        }
        const config = {
          version: "1.0",
          passes: {
            Image: { inputs }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
      });

      it("should accept names with leading underscore", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                _privateChannel: { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
      });

      it("should accept UPPERCASE names", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                NOISE_MAP: { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
      });

      it("should accept names with digits after first char", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                tex2D_normal3: { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
      });

      it("should reject names with hyphens", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                "noise-map": { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Image pass has invalid input channel name: noise-map');
      });

      it("should reject names with spaces", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                "noise map": { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Image pass has invalid input channel name: noise map');
      });

      it("should reject empty string as channel name", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                "": { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
      });

      it("should report errors for invalid names but still validate valid ones", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                validName: { type: 'keyboard' },
                "0bad": { type: 'keyboard' },
                anotherValid: { type: 'keyboard' },
                "has space": { type: 'keyboard' }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Image pass has invalid input channel name: 0bad');
        expect(result.errors).toContain('Image pass has invalid input channel name: has space');
        expect(result.errors).toHaveLength(2);
      });

      it("should reject non-object inputs", () => {
        const config = {
          version: "1.0",
          passes: {
            Image: {
              inputs: "invalid"
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Image pass inputs must be an object');
      });

      describe("buffer input validation", () => {
        it("should accept valid buffer input", () => {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'buffer',
                    source: 'BufferA'
                  }
                }
              }
            }
          };

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("accepts supported buffer sampling and rejects invalid values", () => {
          const valid = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  state: { type: "buffer", source: "BufferA", filter: "nearest", wrap: "repeat" }
                }
              }
            }
          };
          expect(ConfigValidator.validateConfig(valid as never)).toEqual({ isValid: true, errors: [] });

          for (const input of [
            { type: "buffer", source: "BufferA", filter: "cubic" },
            { type: "buffer", source: "BufferA", wrap: "mirror" },
          ]) {
            const invalid = { version: "1.0", passes: { Image: { inputs: { state: input } } } };
            expect(ConfigValidator.validateConfig(invalid as never).errors)
              .toContain("Image pass has invalid input configuration for state");
          }
        });

        it("should reject buffer input without source", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'buffer'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should accept buffer input with custom source name", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'buffer',
                    source: 'BlurPass'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
        });

        it("should reject buffer input with invalid source", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'buffer',
                    source: '0invalid'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject buffer input with Image as source", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'buffer',
                    source: 'Image'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject buffer input with 'common' as source", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'buffer',
                    source: 'common'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });
      });

      describe("texture input validation", () => {
        it("should accept valid texture input", () => {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'texture',
                    path: 'texture.jpg'
                  }
                }
              }
            }
          };

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("should accept texture input with all valid options", () => {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'texture',
                    path: 'texture.jpg',
                    filter: 'linear',
                    wrap: 'repeat',
                    vflip: true
                  }
                }
              }
            }
          };

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("should reject texture input without path", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'texture'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject texture input with non-string path", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'texture',
                    path: 123
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject texture input with invalid filter", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'texture',
                    path: 'texture.jpg',
                    filter: 'invalid'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject texture input with invalid wrap", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'texture',
                    path: 'texture.jpg',
                    wrap: 'invalid'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject texture input with non-boolean vflip", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'texture',
                    path: 'texture.jpg',
                    vflip: 'true'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });
      });

      describe("keyboard input validation", () => {
        it("should accept valid keyboard input", () => {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'keyboard'
                  }
                }
              }
            }
          };

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });
      });

      describe("video input validation", () => {
        it("should accept valid video input", () => {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'video',
                    path: 'video.mp4'
                  }
                }
              }
            }
          };

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("should accept video input with all valid options", () => {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'video',
                    path: 'video.mp4',
                    filter: 'linear',
                    wrap: 'repeat',
                    vflip: true
                  }
                }
              }
            }
          };

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("should reject video input without path", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'video'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject video input with non-string path", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'video',
                    path: 123
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject video input with invalid filter", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'video',
                    path: 'video.mp4',
                    filter: 'invalid'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject video input with invalid wrap", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'video',
                    path: 'video.mp4',
                    wrap: 'invalid'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject video input with non-boolean vflip", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'video',
                    path: 'video.mp4',
                    vflip: 'true'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });
      });

      describe("cubemap input validation", () => {
        it("should accept valid cubemap input", () => {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'cubemap',
                    path: 'cubemap.png'
                  }
                }
              }
            }
          };

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("should accept cubemap input with all valid options", () => {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'cubemap',
                    path: 'cubemap.png',
                    filter: 'linear',
                    wrap: 'repeat',
                    vflip: true
                  }
                }
              }
            }
          };

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("should reject cubemap input without path", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'cubemap'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject cubemap input with non-string path", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'cubemap',
                    path: 123
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject cubemap input with invalid filter", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'cubemap',
                    path: 'cubemap.png',
                    filter: 'invalid'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject cubemap input with invalid wrap", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'cubemap',
                    path: 'cubemap.png',
                    wrap: 'invalid'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject cubemap input with non-boolean vflip", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'cubemap',
                    path: 'cubemap.png',
                    vflip: 'true'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });
      });

      describe("audio input validation", () => {
        it("should accept valid audio input with path", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: { type: 'audio', path: 'music.mp3' }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("should accept audio input with startTime and endTime", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: { type: 'audio', path: 'music.mp3', startTime: 5.0, endTime: 30.0 }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });

        it("should accept audio input with only startTime", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: { type: 'audio', path: 'music.mp3', startTime: 10.0 }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });
      });

      describe("invalid input type", () => {
        it.each(["invalid", "texture-3d"])("should reject unsupported input type %s", (type) => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject input without type", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    path: 'texture.jpg'
                  }
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });

        it("should reject non-object input", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: "invalid"
                }
              }
            }
          } as any;

          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(false);
          expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        });
      });
    });

    describe("complex configuration validation", () => {
      it("should validate complex valid configuration", () => {
        const config: ShaderConfig = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {
                iChannel0: {
                  type: 'buffer',
                  source: 'BufferA'
                },
                iChannel1: {
                  type: 'texture',
                  path: 'texture.jpg',
                  filter: 'linear',
                  wrap: 'repeat'
                },
                iChannel2: {
                  type: 'keyboard'
                }
              }
            },
            BufferA: {
              path: 'buffer-a.glsl',
              inputs: {
                iChannel0: {
                  type: 'texture',
                  path: 'noise.jpg',
                  filter: 'nearest',
                  wrap: 'clamp',
                  vflip: false
                }
              }
            },
            BufferB: {
              path: 'buffer-b.glsl',
              inputs: {
                iChannel0: {
                  type: 'buffer',
                  source: 'BufferA'
                },
                iChannel1: {
                  type: 'buffer',
                  source: 'BufferC'
                }
              }
            }
          }
        };

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should accumulate multiple errors", () => {
        const config = {
          passes: {
            Image: {
              inputs: {
                iChannel0: {
                  type: 'buffer'
                },
                iChannel5: {
                  type: 'texture',
                  path: 'texture.jpg'
                }
              }
            },
            BufferA: {
              inputs: {
                iChannel0: {
                  type: 'texture',
                  filter: 'invalid'
                }
              }
            }
          }
        } as any;

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(3);
        expect(result.errors).toContain('Config must have a valid version string');
        expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
      });
    });

    describe("schema compliance", () => {
      it("should match the JSON schema requirements", () => {
        // Test that matches the exact schema structure from shader-config.schema.json
        const schemaCompliantConfig: ShaderConfig = {
          version: "1.0", // Schema requires const "1.0"
          passes: {
            Image: {
              inputs: {
                iChannel0: {
                  type: 'buffer',
                  source: 'BufferA'
                },
                iChannel1: {
                  type: 'texture',
                  path: 'path/to/texture.jpg',
                  filter: 'linear',
                  wrap: 'repeat',
                  vflip: true
                },
                iChannel2: {
                  type: 'keyboard'
                }
              }
            },
            BufferA: {
              path: 'shaders/buffer-a.glsl',
              inputs: {
                iChannel0: {
                  type: 'texture',
                  path: 'textures/noise.png',
                  filter: 'mipmap',
                  wrap: 'clamp',
                  vflip: false
                }
              }
            },
            BufferB: {
              path: 'shaders/buffer-b.glsl'
            },
            BufferC: {
              path: 'shaders/buffer-c.glsl',
              inputs: {
                iChannel0: {
                  type: 'buffer',
                  source: 'BufferD'
                }
              }
            },
            BufferD: {
              path: 'shaders/buffer-d.glsl',
              inputs: {
                iChannel0: {
                  type: 'keyboard'
                },
                iChannel3: {
                  type: 'texture',
                  path: 'textures/pattern.jpg',
                  filter: 'nearest'
                }
              }
            }
          }
        };

        const result = ConfigValidator.validateConfig(schemaCompliantConfig);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should validate against schema enum values", () => {
        // Test valid buffer source names (any GLSL identifier except Image/common)
        const validSources = ['BufferA', 'BufferB', 'BufferC', 'BufferD', 'BlurPass', 'GBuffer'] as const;
        const validFilters = ['linear', 'nearest', 'mipmap'] as const;
        const validWraps = ['repeat', 'clamp'] as const;

        for (const source of validSources) {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: { type: 'buffer', source }
                }
              }
            }
          };
          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
        }

        for (const filter of validFilters) {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: { type: 'texture', path: 'test.jpg', filter }
                }
              }
            }
          };
          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
        }

        for (const wrap of validWraps) {
          const config: ShaderConfig = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: { type: 'texture', path: 'test.jpg', wrap }
                }
              }
            }
          };
          const result = ConfigValidator.validateConfig(config);
          expect(result.isValid).toBe(true);
        }
      });
    });
  });
});
