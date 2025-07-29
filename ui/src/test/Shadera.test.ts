import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shadera } from "../lib/shadera";

vi.mock("../../vendor/pilibs/src/piRenderer", () => ({
    piRenderer: () => ({
        Initialize: vi.fn().mockReturnValue(true),
    }),
}));

describe("Shadera locker integration", () => {
    let shadera: Shadera;
    let mockTransport: any;
    let mockCanvas: HTMLCanvasElement;
    let mockGL: any;

    beforeEach(() => {
        mockTransport = {
            postMessage: vi.fn(),
            onMessage: vi.fn(),
            dispose: vi.fn(),
            getType: vi.fn().mockReturnValue("websocket"),
            isConnected: vi.fn().mockReturnValue(true),
        };

        mockGL = {
            getExtension: vi.fn(),
            createProgram: vi.fn(),
            createShader: vi.fn(),
            compileShader: vi.fn(),
            linkProgram: vi.fn(),
            useProgram: vi.fn(),
            getParameter: vi.fn().mockReturnValue(true),
            getShaderInfoLog: vi.fn().mockReturnValue(""),
            getProgramInfoLog: vi.fn().mockReturnValue(""),
            deleteShader: vi.fn(),
            deleteProgram: vi.fn(),
        };

        mockCanvas = {
            getContext: vi.fn().mockReturnValue(mockGL),
            width: 800,
            height: 600,
        } as any;

        shadera = new Shadera(mockTransport);
        vi.spyOn(console, "log").mockImplementation(() => { });
    });

    describe("when checking lock state", () => {
        it("then should not be locked initially", () => {
            expect(shadera.getIsLocked()).toBe(false);
        });
    });

    describe("when toggling lock", () => {
        beforeEach(async () => {
            await shadera.initialize(mockCanvas);
        });

        it("then should toggle lock state", () => {
            const mockEvent = {
                data: { path: "test.glsl" },
            } as MessageEvent;

            vi.spyOn(shadera as any, "messageHandler", "get")
                .mockReturnValue({
                    getLastEvent: vi.fn().mockReturnValue(mockEvent),
                });

            shadera.handleToggleLock();
            expect(shadera.getIsLocked()).toBe(true);

            shadera.handleToggleLock();
            expect(shadera.getIsLocked()).toBe(false);
        });
    });

    describe("when handling shader messages", () => {
        beforeEach(async () => {
            await shadera.initialize(mockCanvas);
        });

        it("then should process shader when not locked", async () => {
            const mockEvent = {
                data: {
                    type: "shaderSource",
                    path: "test.glsl",
                    code: "void mainImage() {}",
                    config: null,
                    buffers: {},
                },
            } as MessageEvent;

            vi.spyOn(shadera as any, "messageHandler", "get")
                .mockReturnValue({
                    handleShaderMessage: vi.fn().mockResolvedValue({
                        running: true,
                    }),
                    getLastEvent: vi.fn().mockReturnValue(mockEvent),
                });

            const result = await shadera.handleShaderMessage(mockEvent);
            expect(result.running).toBe(true);
        });

        it("then should process same shader when locked", async () => {
            const mockEvent = {
                data: {
                    type: "shaderSource",
                    path: "test.glsl",
                    code: "void mainImage() {}",
                    config: null,
                    buffers: {},
                },
            } as MessageEvent;

            const mockMessageHandler = {
                handleShaderMessage: vi.fn().mockResolvedValue({
                    running: true,
                }),
                getLastEvent: vi.fn().mockReturnValue(mockEvent),
            };

            vi.spyOn(shadera as any, "messageHandler", "get")
                .mockReturnValue(mockMessageHandler);

            await shadera.handleShaderMessage(mockEvent);
            shadera.handleToggleLock();

            const result = await shadera.handleShaderMessage(mockEvent);
            expect(result.running).toBe(true);
        });

        it("then should ignore different shader when locked", async () => {
            const firstEvent = {
                data: {
                    type: "shaderSource",
                    path: "first.glsl",
                    code: "void mainImage() {}",
                    config: null,
                    buffers: {},
                },
            } as MessageEvent;

            const secondEvent = {
                data: {
                    type: "shaderSource",
                    path: "second.glsl",
                    code: "void mainImage() {}",
                    config: null,
                    buffers: {},
                },
            } as MessageEvent;

            const mockMessageHandler = {
                handleShaderMessage: vi.fn().mockResolvedValue({
                    running: true,
                }),
                getLastEvent: vi.fn().mockReturnValue(firstEvent),
            };

            vi.spyOn(shadera as any, "messageHandler", "get")
                .mockReturnValue(mockMessageHandler);
            vi.spyOn(shadera as any, "frameRenderer", "get").mockReturnValue(
                {
                    isRunning: vi.fn().mockReturnValue(false),
                },
            );

            await shadera.handleShaderMessage(firstEvent);
            shadera.handleToggleLock();

            const result = await shadera.handleShaderMessage(secondEvent);
            expect(result.running).toBe(false);
        });

        it("then should process all shaders after unlocking", async () => {
            const firstEvent = {
                data: {
                    type: "shaderSource",
                    path: "first.glsl",
                    code: "void mainImage() {}",
                    config: null,
                    buffers: {},
                },
            } as MessageEvent;

            const secondEvent = {
                data: {
                    type: "shaderSource",
                    path: "second.glsl",
                    code: "void mainImage() {}",
                    config: null,
                    buffers: {},
                },
            } as MessageEvent;

            const mockMessageHandler = {
                handleShaderMessage: vi.fn().mockResolvedValue({
                    running: true,
                }),
                getLastEvent: vi.fn().mockReturnValue(firstEvent),
            };

            vi.spyOn(shadera as any, "messageHandler", "get")
                .mockReturnValue(mockMessageHandler);

            await shadera.handleShaderMessage(firstEvent);
            shadera.handleToggleLock();
            shadera.handleToggleLock();

            const result = await shadera.handleShaderMessage(secondEvent);
            expect(result.running).toBe(true);
        });
    });
});
