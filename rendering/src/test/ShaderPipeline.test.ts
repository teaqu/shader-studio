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
            };
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

    describe("cleanup", () => {
        it("should call cleanup on all managed components", () => {
            shaderPipeline.cleanup();

            expect(mockResourceManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockTimeManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockBufferManager.dispose).toHaveBeenCalledTimes(1);
        });
    });
});
