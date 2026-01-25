import { describe, expect, it } from "vitest";
import { ConfigValidator } from "../../util/ConfigValidator";
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
      it("should validate BufferA pass without path", () => {
        const config: ShaderConfig = {
          version: "1.0",
          passes: {
            Image: {},
            BufferA: {} as any
          }
        };

        const result = ConfigValidator.validateConfig(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('BufferA pass must have a valid path string');
      });

      it("should validate BufferA pass with non-string path", () => {
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
        expect(result.errors).toContain('BufferA pass must have a valid path string');
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
    });

    describe("input validation", () => {
      it("should reject invalid channel names", () => {
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
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Image pass has invalid input channel: iChannel5');
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

        it("should reject buffer input with invalid source", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'buffer',
                    source: 'BufferZ'
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

      describe("invalid input type", () => {
        it("should reject input with invalid type", () => {
          const config = {
            version: "1.0",
            passes: {
              Image: {
                inputs: {
                  iChannel0: {
                    type: 'invalid'
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
        expect(result.errors).toHaveLength(5);
        expect(result.errors).toContain('Config must have a valid version string');
        expect(result.errors).toContain('Image pass has invalid input configuration for iChannel0');
        expect(result.errors).toContain('Image pass has invalid input channel: iChannel5');
        expect(result.errors).toContain('BufferA pass must have a valid path string');
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
        // Test all valid enum values from the schema
        const validSources = ['BufferA', 'BufferB', 'BufferC', 'BufferD'] as const;
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
