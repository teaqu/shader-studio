import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShaderPipeline } from "../ShaderPipeline";
import type { ShaderCompiler } from "../ShaderCompiler";
import type { ResourceManager } from "../ResourceManager";
import type { PiRenderer, PiShader } from "../types/piRenderer";
import type { BufferManager } from "../BufferManager";
import type { TimeManager } from "../util/TimeManager";

const createMockCanvas = () => ({
    width: 800,
    height: 600,
    getContext: vi.fn(),
}) as unknown as HTMLCanvasElement;

const createMockShaderCompiler = () => ({
    compileShader: vi.fn(),
    wrapShaderToyCode: vi.fn().mockReturnValue({ headerLineCount: 0 }),
});

const createMockResourceManager = () => ({
    cleanup: vi.fn(),
    loadImageTexture: vi.fn(),
    loadVideoTexture: vi.fn().mockResolvedValue({ texture: null, warning: undefined }),
});

const createMockRenderer = () => ({
    DestroyShader: vi.fn(),
});

const createMockBufferManager = () => ({
    getPassBuffers: vi.fn().mockReturnValue({}),
    setPassBuffers: vi.fn(),
    dispose: vi.fn(),
    cleanupBuffers: vi.fn(),
    createPingPongBuffers: vi.fn(),
});

const createMockTimeManager = () => ({
    cleanup: vi.fn(),
    reset: vi.fn(),
    getTime: vi.fn(),
    getDeltaTime: vi.fn(),
});

const createMockShader = () => ({
    mResult: true,
    mInfo: "",
}) as unknown as PiShader;

describe("ShaderPipeline", () => {
    let shaderPipeline: ShaderPipeline;
    let mockCanvas: HTMLCanvasElement;
    let mockShaderCompiler: ReturnType<typeof createMockShaderCompiler>;
    let mockResourceManager: ReturnType<typeof createMockResourceManager>;
    let mockRenderer: ReturnType<typeof createMockRenderer>;
    let mockBufferManager: ReturnType<typeof createMockBufferManager>;
    let mockTimeManager: ReturnType<typeof createMockTimeManager>;

    beforeEach(() => {
        mockCanvas = createMockCanvas();
        mockShaderCompiler = createMockShaderCompiler();
        mockResourceManager = createMockResourceManager();
        mockRenderer = createMockRenderer();
        mockBufferManager = createMockBufferManager();
        mockTimeManager = createMockTimeManager();

        shaderPipeline = new ShaderPipeline(
            mockCanvas,
            mockShaderCompiler as unknown as ShaderCompiler,
            mockResourceManager as unknown as ResourceManager,
            mockRenderer as unknown as PiRenderer,
            mockBufferManager as unknown as BufferManager,
            mockTimeManager as unknown as TimeManager,
        );

        mockShaderCompiler.compileShader.mockReturnValue(createMockShader());
        vi.spyOn(console, "log").mockImplementation(() => { });
        vi.spyOn(console, "error").mockImplementation(() => { });
    });

    describe("when compiling shader pipeline with different shader files", () => {
        it("should cleanup when shader path changes", async () => {
            const firstShaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const firstShaderPath = "shader1.glsl";

            await shaderPipeline.compileShaderPipeline(
                firstShaderCode,
                null,
                firstShaderPath,
                {}
            );

            expect(shaderPipeline.getShaderPath()).toBe(firstShaderPath);
            expect(mockResourceManager.cleanup).not.toHaveBeenCalled();
            expect(mockTimeManager.cleanup).not.toHaveBeenCalled();

            mockResourceManager.cleanup.mockClear();
            mockTimeManager.cleanup.mockClear();
            mockBufferManager.dispose.mockClear();

            const secondShaderCode = "void mainImage() { gl_FragColor = vec4(0.5); }";
            const secondShaderPath = "shader2.glsl";

            await shaderPipeline.compileShaderPipeline(
                secondShaderCode,
                null,
                secondShaderPath,
                {}
            );

            expect(mockResourceManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockTimeManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockBufferManager.dispose).toHaveBeenCalledTimes(1);
            expect(shaderPipeline.getShaderPath()).toBe(secondShaderPath);
        });

        it("should not cleanup when shader code changes but path stays same", async () => {
            const shaderPath = "shader.glsl";
            const firstShaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";

            await shaderPipeline.compileShaderPipeline(
                firstShaderCode,
                null,
                shaderPath,
                {}
            );

            mockResourceManager.cleanup.mockClear();
            mockTimeManager.cleanup.mockClear();
            mockBufferManager.dispose.mockClear();

            const modifiedShaderCode = "void mainImage() { gl_FragColor = vec4(0.5); }";

            await shaderPipeline.compileShaderPipeline(
                modifiedShaderCode,
                null,
                shaderPath,
                {}
            );

            expect(mockResourceManager.cleanup).not.toHaveBeenCalled();
            expect(mockTimeManager.cleanup).not.toHaveBeenCalled();
            expect(mockBufferManager.dispose).not.toHaveBeenCalled();
            expect(shaderPipeline.getShaderPath()).toBe(shaderPath);
        });

        it("should not cleanup when same shader is processed again", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const shaderPath = "shader.glsl";

            await shaderPipeline.compileShaderPipeline(
                shaderCode,
                null,
                shaderPath,
                {}
            );

            mockResourceManager.cleanup.mockClear();
            mockTimeManager.cleanup.mockClear();
            mockBufferManager.dispose.mockClear();

            await shaderPipeline.compileShaderPipeline(
                shaderCode,
                null,
                shaderPath,
                {}
            );

            expect(mockResourceManager.cleanup).not.toHaveBeenCalled();
            expect(mockTimeManager.cleanup).not.toHaveBeenCalled();
            expect(mockBufferManager.dispose).not.toHaveBeenCalled();
            expect(shaderPipeline.getShaderPath()).toBe(shaderPath);
        });

        it("should not cleanup on first shader load", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const shaderPath = "shader.glsl";

            expect(shaderPipeline.getShaderPath()).toBe("");

            await shaderPipeline.compileShaderPipeline(
                shaderCode,
                null,
                shaderPath,
                {}
            );

            expect(mockResourceManager.cleanup).not.toHaveBeenCalled();
            expect(mockTimeManager.cleanup).not.toHaveBeenCalled();
            expect(mockBufferManager.dispose).not.toHaveBeenCalled();
            expect(shaderPipeline.getShaderPath()).toBe(shaderPath);
        });

        it("should handle compilation errors without affecting path change logic", async () => {
            const firstShaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const firstShaderPath = "working_shader.glsl";

            await shaderPipeline.compileShaderPipeline(
                firstShaderCode,
                null,
                firstShaderPath,
                {}
            );

            expect(shaderPipeline.getShaderPath()).toBe(firstShaderPath);

            mockResourceManager.cleanup.mockClear();
            mockTimeManager.cleanup.mockClear();
            mockBufferManager.dispose.mockClear();

            mockShaderCompiler.compileShader.mockReturnValueOnce(null);

            const failingShaderCode = "void mainImage() { SYNTAX_ERROR; }";
            const secondShaderPath = "broken_shader.glsl";

            const result = await shaderPipeline.compileShaderPipeline(
                failingShaderCode,
                null,
                secondShaderPath,
                {}
            );

            // Cleanup should happen even when compilation fails, if path changed
            expect(mockResourceManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockTimeManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockBufferManager.dispose).toHaveBeenCalledTimes(1);

            expect(shaderPipeline.getShaderPath()).toBe(secondShaderPath);
            expect(result.success).toBe(false);
        });
    });

    describe("getCurrentShaderRenderID", () => {
        it("should increment render ID on each compilation", async () => {
            const initialRenderID = shaderPipeline.getCurrentShaderRenderID();

            await shaderPipeline.compileShaderPipeline(
                "void mainImage() { gl_FragColor = vec4(1.0); }",
                null,
                "shader1.glsl",
                {}
            );

            const firstRenderID = shaderPipeline.getCurrentShaderRenderID();
            expect(firstRenderID).toBe(initialRenderID + 1);

            await shaderPipeline.compileShaderPipeline(
                "void mainImage() { gl_FragColor = vec4(0.5); }",
                null,
                "shader2.glsl",
                {}
            );

            const secondRenderID = shaderPipeline.getCurrentShaderRenderID();
            expect(secondRenderID).toBe(firstRenderID + 1);
        });
    });

    describe("buildPasses", () => {
        it("should create Image pass when no config is provided", () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            
            // Access private method for testing
            const buildPasses = (shaderPipeline as any).buildPasses.bind(shaderPipeline);
            buildPasses(shaderCode, null, {});
            
            expect(shaderPipeline.getPasses()).toHaveLength(1);
            expect(shaderPipeline.getPasses()[0]).toEqual({
                name: "Image",
                shaderSrc: shaderCode,
                inputs: {},
                path: undefined,
            });
        });

        it("should create passes from config", () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    BufferA: { inputs: {} },
                    BufferB: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
                }
            };
            const buffers = {
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
                BufferB: "void main() { gl_FragColor = vec4(0.3); }",
            };
            
            const buildPasses = (shaderPipeline as any).buildPasses.bind(shaderPipeline);
            buildPasses(shaderCode, config, buffers);
            
            const passes = shaderPipeline.getPasses();
            expect(passes).toHaveLength(2);
            expect(passes[0]).toEqual({
                name: "BufferA",
                shaderSrc: buffers.BufferA,
                inputs: {},
                path: undefined,
            });
            expect(passes[1]).toEqual({
                name: "BufferB",
                shaderSrc: buffers.BufferB,
                inputs: { iChannel0: { type: "buffer", source: "BufferA" } },
                path: undefined,
            });
        });

        it("should include Image pass with main shader code when in config", () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferA: { inputs: {} },
                }
            };
            const buffers = {
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
            };
            
            const buildPasses = (shaderPipeline as any).buildPasses.bind(shaderPipeline);
            buildPasses(shaderCode, config, buffers);
            
            const passes = shaderPipeline.getPasses();
            expect(passes).toHaveLength(2);
            expect(passes[0]).toEqual({
                name: "Image",
                shaderSrc: shaderCode,
                inputs: {},
                path: undefined,
            });
            expect(passes[1]).toEqual({
                name: "BufferA",
                shaderSrc: buffers.BufferA,
                inputs: {},
                path: undefined,
            });
        });

        it("should skip common buffer when it has no meaningful content", () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    common: { inputs: {} },
                    BufferA: { inputs: {} },
                }
            };
            const buffers = {
                common: "/* Just a comment */\n// Another comment\n   \n",
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
            };
            
            const buildPasses = (shaderPipeline as any).buildPasses.bind(shaderPipeline);
            buildPasses(shaderCode, config, buffers);
            
            const passes = shaderPipeline.getPasses();
            expect(passes).toHaveLength(1);
            expect(passes[0].name).toBe("BufferA");
        });

        it("should include common buffer when it has meaningful content", () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    common: { inputs: {} },
                    BufferA: { inputs: {} },
                }
            };
            const buffers = {
                common: "vec4 commonFunction(vec4 color) { return color * 0.5; }",
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
            };
            
            const buildPasses = (shaderPipeline as any).buildPasses.bind(shaderPipeline);
            buildPasses(shaderCode, config, buffers);
            
            const passes = shaderPipeline.getPasses();
            expect(passes).toHaveLength(2);
            expect(passes[0].name).toBe("common");
            expect(passes[0].shaderSrc).toBe(buffers.common);
            expect(passes[1].name).toBe("BufferA");
        });

        it("should handle common buffer with mixed content (comments + code)", () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    common: { inputs: {} },
                }
            };
            const buffers = {
                common: `
                    /* This is a common utility function */
                    vec4 commonUtility(vec4 color) {
                        return color * 0.8;
                    }
                    // Another comment
                `,
            };
            
            const buildPasses = (shaderPipeline as any).buildPasses.bind(shaderPipeline);
            buildPasses(shaderCode, config, buffers);
            
            const passes = shaderPipeline.getPasses();
            expect(passes).toHaveLength(1);
            expect(passes[0].name).toBe("common");
            expect(passes[0].shaderSrc).toBe(buffers.common);
        });

        it("should use empty string for missing buffer code (except Image)", () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    BufferA: { inputs: {} },
                    BufferB: { inputs: {} },
                    common: { inputs: {} },
                }
            };
            const buffers = {
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
                // BufferB and common are missing
            };
            
            const buildPasses = (shaderPipeline as any).buildPasses.bind(shaderPipeline);
            buildPasses(shaderCode, config, buffers);
            
            const passes = shaderPipeline.getPasses();
            expect(passes).toHaveLength(2); // BufferA and BufferB (common is filtered out due to empty content)
            
            const bufferAPass = passes.find(p => p.name === "BufferA");
            const bufferBPass = passes.find(p => p.name === "BufferB");
            
            expect(bufferAPass?.shaderSrc).toBe("void main() { gl_FragColor = vec4(0.5); }");
            expect(bufferBPass?.shaderSrc).toBe(""); // Missing buffer gets empty string
        });

        it("should preserve buffer inputs from config", () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    BufferA: { 
                        inputs: { 
                            iChannel0: { type: "texture", path: "texture.jpg" },
                            iChannel1: { type: "keyboard" }
                        } 
                    },
                }
            };
            const buffers = {
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
            };
            
            const buildPasses = (shaderPipeline as any).buildPasses.bind(shaderPipeline);
            buildPasses(shaderCode, config, buffers);
            
            const passes = shaderPipeline.getPasses();
            expect(passes).toHaveLength(1);
            expect(passes[0].inputs).toEqual({
                iChannel0: { type: "texture", path: "texture.jpg" },
                iChannel1: { type: "keyboard" }
            });
        });

        it("should compile shaders with common buffer code included", async () => {
            const shaderCode = `
                void mainImage(out vec4 fragColor, in vec2 fragCoord) {
                    vec2 uv = fragCoord.xy / iResolution.xy;
                    vec3 col = commonFunction(vec4(uv, 0.5, 1.0)).rgb;
                    fragColor = vec4(col, 1.0);
                }
            `;
            const config = {
                version: "1.0",
                passes: {
                    common: { inputs: {} },
                    Image: { inputs: {} },
                }
            } as any;
            const buffers = {
                common: `
                    vec4 commonFunction(vec4 color) {
                        return color * 0.8;
                    }
                `,
            };
            
            const result = await shaderPipeline.compileShaderPipeline(shaderCode, config, "test.glsl", buffers);
            
            expect(result.success).toBe(true);
            expect(mockShaderCompiler.compileShader).toHaveBeenCalledWith(
                expect.stringContaining("void mainImage(out vec4 fragColor, in vec2 fragCoord)"),
                expect.stringContaining("commonFunction")
            );
        });
    });

    describe("error handling for missing buffer files", () => {
        it("should return error when buffer pass has empty shader source", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferA: { path: "buffer-a.glsl", inputs: {} }
                }
            };
            const buffers = {
                BufferA: "" // Empty buffer content
            };

            const result = await shaderPipeline.compileShaderPipeline(
                shaderCode,
                config as any,
                "shader.glsl",
                buffers
            );

            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors![0]).toContain("BufferA");
            expect(result.errors![0]).toContain("not found or is empty");
            expect(result.errors![0]).toContain("buffer-a.glsl");
        });

        it("should return error when buffer pass has only whitespace", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferB: { path: "buffer-b.glsl", inputs: {} }
                }
            };
            const buffers = {
                BufferB: "   \n\t  " // Only whitespace
            };

            const result = await shaderPipeline.compileShaderPipeline(
                shaderCode,
                config as any,
                "shader.glsl",
                buffers
            );

            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors![0]).toContain("BufferB");
            expect(result.errors![0]).toContain("not found or is empty");
            expect(result.errors![0]).toContain("buffer-b.glsl");
        });

        it("should return error when buffer is missing from buffers object", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferA: { path: "buffer-a.glsl", inputs: {} }
                }
            };
            const buffers = {
                // BufferA is missing
            };

            const result = await shaderPipeline.compileShaderPipeline(
                shaderCode,
                config as any,
                "shader.glsl",
                buffers
            );

            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors![0]).toContain("BufferA");
            expect(result.errors![0]).toContain("not found or is empty");
        });

        it("should succeed when all buffers have valid content", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferA: { path: "buffer-a.glsl", inputs: {} }
                }
            };
            const buffers = {
                BufferA: "void main() { gl_FragColor = vec4(0.5); }"
            };

            const result = await shaderPipeline.compileShaderPipeline(
                shaderCode,
                config as any,
                "shader.glsl",
                buffers
            );

            expect(result.success).toBe(true);
        });

        it("should include path in error message when buffer is empty", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferC: { path: "path/to/buffer-c.glsl", inputs: {} }
                }
            };
            const buffers = {
                BufferC: ""
            };

            const result = await shaderPipeline.compileShaderPipeline(
                shaderCode,
                config as any,
                "shader.glsl",
                buffers
            );

            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors![0]).toContain("path/to/buffer-c.glsl");
            expect(result.errors![0]).toContain("Please check that the file exists");
        });

        it("should handle multiple missing buffers by reporting the first one", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferA: { path: "buffer-a.glsl", inputs: {} },
                    BufferB: { path: "buffer-b.glsl", inputs: {} }
                }
            };
            const buffers = {
                BufferA: "", // Empty
                BufferB: "" // Also empty
            };

            const result = await shaderPipeline.compileShaderPipeline(
                shaderCode,
                config as any,
                "shader.glsl",
                buffers
            );

            expect(result.success).toBe(false);
            // Should fail on first buffer encountered
            expect(result.errors).toBeDefined();
            expect(result.errors![0]).toContain("Buffer");
            expect(result.errors![0]).toContain("not found or is empty");
        });

        it("should not error on empty Image pass (uses main code)", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} }
                }
            };

            const result = await shaderPipeline.compileShaderPipeline(
                shaderCode,
                config as any,
                "shader.glsl",
                {}
            );

            expect(result.success).toBe(true);
        });

        it("should not validate common buffer as it can be empty", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    common: { inputs: {} }
                }
            };
            const buffers = {
                common: "" // Common can be empty
            };

            const result = await shaderPipeline.compileShaderPipeline(
                shaderCode,
                config as any,
                "shader.glsl",
                buffers
            );

            // Should succeed because common buffer is filtered out when empty
            expect(result.success).toBe(true);
        });
    });

    describe("cleanup", () => {
        it("should call cleanup on all managed components", () => {
            shaderPipeline.cleanup();

            expect(mockResourceManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockTimeManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockBufferManager.dispose).toHaveBeenCalledTimes(1);
        });
    });

    describe("video input handling", () => {
        it("should load video texture when pass has video input", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "video", path: "video.mp4" }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "video.mp4",
                { filter: undefined, wrap: undefined, vflip: undefined }
            );
        });

        it("should load video texture with filter options", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { 
                                type: "video", 
                                path: "video.mp4",
                                filter: "linear"
                            }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "video.mp4",
                { filter: "linear", wrap: undefined, vflip: undefined }
            );
        });

        it("should load video texture with wrap options", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { 
                                type: "video", 
                                path: "video.mp4",
                                wrap: "clamp"
                            }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "video.mp4",
                { filter: undefined, wrap: "clamp", vflip: undefined }
            );
        });

        it("should load video texture with vflip option", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { 
                                type: "video", 
                                path: "video.mp4",
                                vflip: false
                            }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "video.mp4",
                { filter: undefined, wrap: undefined, vflip: false }
            );
        });

        it("should load video texture with all options", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { 
                                type: "video", 
                                path: "video.mp4",
                                filter: "nearest",
                                wrap: "repeat",
                                vflip: true
                            }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "video.mp4",
                { filter: "nearest", wrap: "repeat", vflip: true }
            );
        });

        it("should load multiple video textures from different channels", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "video", path: "video1.mp4" },
                            iChannel1: { type: "video", path: "video2.mp4" }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledTimes(2);
            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "video1.mp4",
                expect.any(Object)
            );
            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "video2.mp4",
                expect.any(Object)
            );
        });

        it("should load video textures from buffer passes", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferA: {
                        path: "buffer-a.glsl",
                        inputs: {
                            iChannel0: { type: "video", path: "buffer-video.mp4" }
                        }
                    }
                }
            };
            const buffers = {
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", buffers);

            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "buffer-video.mp4",
                expect.any(Object)
            );
        });

        it("should handle mixed texture and video inputs", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "image.jpg" },
                            iChannel1: { type: "video", path: "video.mp4" },
                            iChannel2: { type: "keyboard" }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image.jpg",
                expect.any(Object)
            );
            expect(mockResourceManager.loadVideoTexture).toHaveBeenCalledWith(
                "video.mp4",
                expect.any(Object)
            );
        });

        it("should not load video texture when path is missing", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "video" } // No path
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadVideoTexture).not.toHaveBeenCalled();
        });

        it("should return warnings from video loading failures", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "video", path: "video.mp4" }
                        }
                    }
                }
            };

            // Mock video loading to return a warning
            mockResourceManager.loadVideoTexture.mockResolvedValue({
                texture: null,
                warning: "Video is not loading: video.mp4. If using in a VS Code panel, try opening Shader Studio in its own window or browser."
            });

            const result = await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(result.success).toBe(true);
            expect(result.warnings).toBeDefined();
            expect(result.warnings).toHaveLength(1);
            expect(result.warnings![0]).toContain("Video is not loading");
        });

        it("should return multiple warnings from multiple video loading failures", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "video", path: "video1.mp4" },
                            iChannel1: { type: "video", path: "video2.mp4" }
                        }
                    }
                }
            };

            // Mock video loading to return warnings for both
            mockResourceManager.loadVideoTexture
                .mockResolvedValueOnce({
                    texture: null,
                    warning: "Video is not loading: video1.mp4."
                })
                .mockResolvedValueOnce({
                    texture: null,
                    warning: "Video is not loading: video2.mp4."
                });

            const result = await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(result.success).toBe(true);
            expect(result.warnings).toBeDefined();
            expect(result.warnings).toHaveLength(2);
            expect(result.warnings![0]).toContain("video1.mp4");
            expect(result.warnings![1]).toContain("video2.mp4");
        });

        it("should not include warnings when video loads successfully", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "video", path: "video.mp4" }
                        }
                    }
                }
            };

            // Mock successful video loading (no warning)
            mockResourceManager.loadVideoTexture.mockResolvedValue({
                texture: {},
                warning: undefined
            });

            const result = await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(result.success).toBe(true);
            expect(result.warnings).toBeUndefined();
        });
    });

    describe("texture input handling", () => {
        it("should load texture with default options when none specified", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "image.jpg" }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image.jpg",
                { filter: undefined, wrap: undefined, vflip: undefined, grayscale: undefined }
            );
        });

        it("should load texture with filter option", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "image.jpg", filter: "linear" }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image.jpg",
                { filter: "linear", wrap: undefined, vflip: undefined, grayscale: undefined }
            );
        });

        it("should load texture with wrap option", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "image.jpg", wrap: "clamp" }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image.jpg",
                { filter: undefined, wrap: "clamp", vflip: undefined, grayscale: undefined }
            );
        });

        it("should load texture with vflip option", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "image.jpg", vflip: false }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image.jpg",
                { filter: undefined, wrap: undefined, vflip: false, grayscale: undefined }
            );
        });

        it("should load texture with grayscale option true", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "image.jpg", grayscale: true }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image.jpg",
                { filter: undefined, wrap: undefined, vflip: undefined, grayscale: true }
            );
        });

        it("should load texture with grayscale option false", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "image.jpg", grayscale: false }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image.jpg",
                { filter: undefined, wrap: undefined, vflip: undefined, grayscale: false }
            );
        });

        it("should load texture with all options including grayscale", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { 
                                type: "texture", 
                                path: "image.jpg",
                                filter: "nearest",
                                wrap: "repeat",
                                vflip: true,
                                grayscale: true
                            }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image.jpg",
                { filter: "nearest", wrap: "repeat", vflip: true, grayscale: true }
            );
        });

        it("should load multiple textures with different grayscale options", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "color.jpg", grayscale: false },
                            iChannel1: { type: "texture", path: "gray.jpg", grayscale: true }
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledTimes(2);
            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "color.jpg",
                expect.objectContaining({ grayscale: false })
            );
            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "gray.jpg",
                expect.objectContaining({ grayscale: true })
            );
        });

        it("should load texture from buffer pass with grayscale option", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: { inputs: {} },
                    BufferA: {
                        path: "buffer-a.glsl",
                        inputs: {
                            iChannel0: { type: "texture", path: "buffer-texture.jpg", grayscale: true }
                        }
                    }
                }
            };
            const buffers = {
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", buffers);

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "buffer-texture.jpg",
                expect.objectContaining({ grayscale: true })
            );
        });

        it("should not load texture when path is missing", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", grayscale: true } // No path
                        }
                    }
                }
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", {});

            expect(mockResourceManager.loadImageTexture).not.toHaveBeenCalled();
        });

        it("should handle mixed grayscale and non-grayscale textures across multiple passes", async () => {
            const shaderCode = "void mainImage() { gl_FragColor = vec4(1.0); }";
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: "texture", path: "image-color.jpg", grayscale: false }
                        }
                    },
                    BufferA: {
                        inputs: {
                            iChannel0: { type: "texture", path: "buffer-gray.jpg", grayscale: true },
                            iChannel1: { type: "texture", path: "buffer-color.jpg" } // undefined grayscale
                        }
                    }
                }
            };
            const buffers = {
                BufferA: "void main() { gl_FragColor = vec4(0.5); }",
            };

            await shaderPipeline.compileShaderPipeline(shaderCode, config as any, "shader.glsl", buffers);

            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledTimes(3);
            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "image-color.jpg",
                expect.objectContaining({ grayscale: false })
            );
            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "buffer-gray.jpg",
                expect.objectContaining({ grayscale: true })
            );
            expect(mockResourceManager.loadImageTexture).toHaveBeenCalledWith(
                "buffer-color.jpg",
                expect.objectContaining({ grayscale: undefined })
            );
        });
    });
});
