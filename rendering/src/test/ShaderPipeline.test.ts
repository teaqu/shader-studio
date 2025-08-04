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

    describe("cleanup", () => {
        it("should call cleanup on all managed components", () => {
            shaderPipeline.cleanup();

            expect(mockResourceManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockTimeManager.cleanup).toHaveBeenCalledTimes(1);
            expect(mockBufferManager.dispose).toHaveBeenCalledTimes(1);
        });
    });
});
