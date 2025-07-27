import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FrameRenderer } from '../../../src/lib/rendering/FrameRenderer';
import { FPSCalculator } from '../../../src/lib/util/FPSCalculator';

// Mock dependencies
const mockTimeManager = {
    getFrame: vi.fn(),
    getCurrentTime: vi.fn(),
    getDeltaTime: vi.fn(),
    getCurrentDate: vi.fn(),
    updateFrame: vi.fn(),
    incrementFrame: vi.fn(),
    isPaused: vi.fn()
};

const mockKeyboardManager = {
    clearPressed: vi.fn()
};

const mockMouseManager = {
    getMouse: vi.fn()
};

const mockShaderPipeline = {
    getPasses: vi.fn(),
    getPassShaders: vi.fn(),
    getPassShader: vi.fn()
};

const mockBufferManager = {
    getPassBuffers: vi.fn()
};

const mockPassRenderer = {
    renderPass: vi.fn()
};

const mockCanvas = {
    width: 800,
    height: 600
} as HTMLCanvasElement;

const mockFPSCalculator = {
    reset: vi.fn(),
    updateFrame: vi.fn(),
    getFPS: vi.fn(),
    getRawFPS: vi.fn()
};

describe('FrameRenderer', () => {
    let frameRenderer: FrameRenderer;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default mock returns
        mockTimeManager.getFrame.mockReturnValue(1);
        mockTimeManager.getCurrentTime.mockReturnValue(1000);
        mockTimeManager.getDeltaTime.mockReturnValue(16.67);
        mockTimeManager.getCurrentDate.mockReturnValue(new Float32Array([2025, 1, 1, 0]));
        mockTimeManager.isPaused.mockReturnValue(false);

        mockMouseManager.getMouse.mockReturnValue(new Float32Array([0, 0, 0, 0]));

        mockShaderPipeline.getPasses.mockReturnValue([
            { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} },
            { name: 'Image', shaderSrc: 'image shader', inputs: {} }
        ]);
        mockShaderPipeline.getPassShaders.mockReturnValue({
            'Buffer A': { mProgram: {}, mResult: true },
            'Image': { mProgram: {}, mResult: true }
        });
        mockShaderPipeline.getPassShader.mockReturnValue({ mProgram: {}, mResult: true });

        mockBufferManager.getPassBuffers.mockReturnValue({
            'Buffer A': {
                front: { mTex0: {} },
                back: { mTex0: {} }
            }
        });

        mockFPSCalculator.getFPS.mockReturnValue(60);
        mockFPSCalculator.getRawFPS.mockReturnValue(59.8);

        frameRenderer = new FrameRenderer(
            mockTimeManager as any,
            mockKeyboardManager as any,
            mockMouseManager as any,
            mockShaderPipeline as any,
            mockBufferManager as any,
            mockPassRenderer as any,
            mockCanvas,
            mockFPSCalculator as any
        );
    });

    describe('initialization', () => {
        it('should initialize with correct default state', () => {
            expect(frameRenderer.isRunning()).toBe(false);
            expect(frameRenderer.getCurrentFPS()).toBe(60);
        });
    });

    describe('running state', () => {
        it('should track running state correctly', () => {
            expect(frameRenderer.isRunning()).toBe(false);

            frameRenderer.setRunning(true);
            expect(frameRenderer.isRunning()).toBe(true);

            frameRenderer.setRunning(false);
            expect(frameRenderer.isRunning()).toBe(false);
        });
    });

    describe('FPS tracking', () => {
        it('should delegate FPS tracking to FPSCalculator', () => {
            expect(frameRenderer.getCurrentFPS()).toBe(60);
            expect(mockFPSCalculator.getFPS).toHaveBeenCalled();
        });
    });

    describe('render loop', () => {
        it('should not start render loop if already running', () => {
            frameRenderer.setRunning(true);
            const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

            frameRenderer.startRenderLoop();

            expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
            requestAnimationFrameSpy.mockRestore();
        });

        it('should start render loop when not running', () => {
            const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

            frameRenderer.startRenderLoop();

            expect(frameRenderer.isRunning()).toBe(true);
            expect(requestAnimationFrameSpy).toHaveBeenCalled();
            requestAnimationFrameSpy.mockRestore();
        });

        it('should stop render loop', () => {
            frameRenderer.setRunning(true);
            frameRenderer.stopRenderLoop();

            expect(frameRenderer.isRunning()).toBe(false);
        });
    });

    describe('render method', () => {
        beforeEach(() => {
            frameRenderer.setRunning(true);
        });

        it('should not render when not running', () => {
            frameRenderer.setRunning(false);
            frameRenderer.render(1000);

            expect(mockTimeManager.updateFrame).not.toHaveBeenCalled();
        });

        it('should handle first frame correctly', () => {
            mockTimeManager.getFrame.mockReturnValue(0);

            frameRenderer.render(1000);

            expect(mockFPSCalculator.reset).toHaveBeenCalled();
            expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
        });

        it('should update FPS calculator for subsequent frames', () => {
            mockTimeManager.getFrame.mockReturnValue(5);

            frameRenderer.render(1000);

            expect(mockFPSCalculator.updateFrame).toHaveBeenCalledWith(1000);
            expect(mockTimeManager.incrementFrame).toHaveBeenCalled();
        });

        it('should not update frame when paused', () => {
            mockTimeManager.getFrame.mockReturnValue(5);
            mockTimeManager.isPaused.mockReturnValue(true);

            frameRenderer.render(1000);

            expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled();
            expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
        });

        it('should render all non-Image passes', () => {
            frameRenderer.render(1000);

            expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
                { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} },
                { mTex0: {} },
                { mProgram: {}, mResult: true },
                expect.any(Object)
            );
        });

        it('should render Image pass last with null target', () => {
            frameRenderer.render(1000);

            expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
                { name: 'Image', shaderSrc: 'image shader', inputs: {} },
                null,
                { mProgram: {}, mResult: true },
                expect.any(Object)
            );
        });

        it('should clear keyboard pressed state', () => {
            frameRenderer.render(1000);

            expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
        });

        it('should generate correct uniforms', () => {
            frameRenderer.render(1000);

            const expectedUniforms = {
                res: new Float32Array([800, 600, 800 / 600]),
                time: 1000,
                timeDelta: 16.67,
                frameRate: 59.8,
                mouse: new Float32Array([0, 0, 0, 0]),
                frame: 1,
                date: new Float32Array([2025, 1, 1, 0])
            };

            expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Object),
                expect.any(Object),
                expect.objectContaining({
                    time: expectedUniforms.time,
                    timeDelta: expectedUniforms.timeDelta,
                    frameRate: expectedUniforms.frameRate,
                    frame: expectedUniforms.frame
                })
            );
        });
    });

    describe('renderSinglePass', () => {
        it('should render a single pass with null target', () => {
            const testPass = { name: 'Test', shaderSrc: 'test shader', inputs: {} };

            frameRenderer.renderSinglePass(testPass);

            expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
                testPass,
                null,
                { mProgram: {}, mResult: true },
                expect.any(Object)
            );
        });

        it('should handle null shader gracefully', () => {
            mockShaderPipeline.getPassShader.mockReturnValue(null);
            const testPass = { name: 'Test', shaderSrc: 'test shader', inputs: {} };

            frameRenderer.renderSinglePass(testPass);

            expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
                testPass,
                null,
                null,
                expect.any(Object)
            );
        });
    });

    describe('buffer swapping', () => {
        it('should swap front and back buffers for non-Image passes', () => {
            const bufferA = {
                front: 'front_texture',
                back: 'back_texture'
            };

            const originalFront = bufferA.front;
            const originalBack = bufferA.back;

            mockBufferManager.getPassBuffers.mockReturnValue({
                'Buffer A': bufferA
            });

            mockShaderPipeline.getPasses.mockReturnValue([
                { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} }
            ]);

            frameRenderer.setRunning(true);
            frameRenderer.render(1000);

            expect(bufferA.front).toBe(originalBack);
            expect(bufferA.back).toBe(originalFront);
        });
    });

    describe('edge cases', () => {
        it('should handle missing Image pass', () => {
            mockShaderPipeline.getPasses.mockReturnValue([
                { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} }
            ]);

            expect(() => frameRenderer.render(1000)).not.toThrow();
        });

        it('should handle empty passes array', () => {
            mockShaderPipeline.getPasses.mockReturnValue([]);

            expect(() => frameRenderer.render(1000)).not.toThrow();
        });

        it('should handle missing pass buffers', () => {
            mockBufferManager.getPassBuffers.mockReturnValue({});

            expect(() => frameRenderer.render(1000)).not.toThrow();
        });
    });
});
