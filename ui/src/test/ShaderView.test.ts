import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderView } from '../lib/ShaderView';

vi.mock('../../vendor/pilibs/src/piRenderer', () => ({
    piRenderer: () => ({
        Initialize: vi.fn().mockReturnValue(true)
    })
}));

describe('ShaderView locker integration', () => {
    let shaderView: ShaderView;
    let mockTransport: any;
    let mockCanvas: HTMLCanvasElement;
    let mockGL: any;

    beforeEach(() => {
        mockTransport = {
            postMessage: vi.fn(),
            onMessage: vi.fn(),
            dispose: vi.fn(),
            getType: vi.fn().mockReturnValue('websocket'),
            isConnected: vi.fn().mockReturnValue(true)
        };

        mockGL = {
            getExtension: vi.fn(),
            createProgram: vi.fn(),
            createShader: vi.fn(),
            compileShader: vi.fn(),
            linkProgram: vi.fn(),
            useProgram: vi.fn(),
            getParameter: vi.fn().mockReturnValue(true),
            getShaderInfoLog: vi.fn().mockReturnValue(''),
            getProgramInfoLog: vi.fn().mockReturnValue(''),
            deleteShader: vi.fn(),
            deleteProgram: vi.fn()
        };

        mockCanvas = {
            getContext: vi.fn().mockReturnValue(mockGL),
            width: 800,
            height: 600
        } as any;

        shaderView = new ShaderView(mockTransport);
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    describe('when checking lock state', () => {
        it('then should not be locked initially', () => {
            expect(shaderView.getIsLocked()).toBe(false);
        });
    });

    describe('when toggling lock', () => {
        beforeEach(async () => {
            await shaderView.initialize(mockCanvas);
        });

        it('then should toggle lock state', () => {
            const mockEvent = {
                data: { name: 'test.glsl' }
            } as MessageEvent;

            vi.spyOn(shaderView as any, 'messageHandler', 'get').mockReturnValue({
                getLastEvent: vi.fn().mockReturnValue(mockEvent)
            });

            shaderView.handleToggleLock();
            expect(shaderView.getIsLocked()).toBe(true);

            shaderView.handleToggleLock();
            expect(shaderView.getIsLocked()).toBe(false);
        });
    });

    describe('when handling shader messages', () => {
        beforeEach(async () => {
            await shaderView.initialize(mockCanvas);
        });

        it('then should process shader when not locked', async () => {
            const mockEvent = {
                data: {
                    type: 'shaderSource',
                    name: 'test.glsl',
                    code: 'void mainImage() {}',
                    config: null,
                    buffers: {}
                }
            } as MessageEvent;

            vi.spyOn(shaderView as any, 'messageHandler', 'get').mockReturnValue({
                handleShaderMessage: vi.fn().mockResolvedValue({ running: true }),
                getLastEvent: vi.fn().mockReturnValue(mockEvent)
            });

            const result = await shaderView.handleShaderMessage(mockEvent);
            expect(result.running).toBe(true);
        });

        it('then should process same shader when locked', async () => {
            const mockEvent = {
                data: {
                    type: 'shaderSource',
                    name: 'test.glsl',
                    code: 'void mainImage() {}',
                    config: null,
                    buffers: {}
                }
            } as MessageEvent;

            const mockMessageHandler = {
                handleShaderMessage: vi.fn().mockResolvedValue({ running: true }),
                getLastEvent: vi.fn().mockReturnValue(mockEvent)
            };

            vi.spyOn(shaderView as any, 'messageHandler', 'get').mockReturnValue(mockMessageHandler);

            await shaderView.handleShaderMessage(mockEvent);
            shaderView.handleToggleLock();

            const result = await shaderView.handleShaderMessage(mockEvent);
            expect(result.running).toBe(true);
        });

        it('then should ignore different shader when locked', async () => {
            const firstEvent = {
                data: {
                    type: 'shaderSource',
                    name: 'first.glsl',
                    code: 'void mainImage() {}',
                    config: null,
                    buffers: {}
                }
            } as MessageEvent;

            const secondEvent = {
                data: {
                    type: 'shaderSource',
                    name: 'second.glsl',
                    code: 'void mainImage() {}',
                    config: null,
                    buffers: {}
                }
            } as MessageEvent;

            const mockMessageHandler = {
                handleShaderMessage: vi.fn().mockResolvedValue({ running: true }),
                getLastEvent: vi.fn().mockReturnValue(firstEvent)
            };

            vi.spyOn(shaderView as any, 'messageHandler', 'get').mockReturnValue(mockMessageHandler);
            vi.spyOn(shaderView as any, 'renderLoopManager', 'get').mockReturnValue({
                isRunning: vi.fn().mockReturnValue(false)
            });

            await shaderView.handleShaderMessage(firstEvent);
            shaderView.handleToggleLock();

            const result = await shaderView.handleShaderMessage(secondEvent);
            expect(result.running).toBe(false);
        });

        it('then should process all shaders after unlocking', async () => {
            const firstEvent = {
                data: {
                    type: 'shaderSource',
                    name: 'first.glsl',
                    code: 'void mainImage() {}',
                    config: null,
                    buffers: {}
                }
            } as MessageEvent;

            const secondEvent = {
                data: {
                    type: 'shaderSource',
                    name: 'second.glsl',
                    code: 'void mainImage() {}',
                    config: null,
                    buffers: {}
                }
            } as MessageEvent;

            const mockMessageHandler = {
                handleShaderMessage: vi.fn().mockResolvedValue({ running: true }),
                getLastEvent: vi.fn().mockReturnValue(firstEvent)
            };

            vi.spyOn(shaderView as any, 'messageHandler', 'get').mockReturnValue(mockMessageHandler);

            await shaderView.handleShaderMessage(firstEvent);
            shaderView.handleToggleLock();
            shaderView.handleToggleLock();

            const result = await shaderView.handleShaderMessage(secondEvent);
            expect(result.running).toBe(true);
        });
    });
});
