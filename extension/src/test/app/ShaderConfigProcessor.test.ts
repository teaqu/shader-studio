import * as assert from 'assert';
import * as sinon from 'sinon';
import { ShaderConfigProcessor } from '../../app/ShaderConfigProcessor';
import { Logger } from '../../app/services/Logger';

suite('ShaderConfigProcessor Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let fsExistsSyncStub: sinon.SinonStub;
    let mockErrorHandler: { handleError: sinon.SinonStub; handlePersistentError: sinon.SinonStub };
    let configProcessor: ShaderConfigProcessor;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Initialize Logger with a mock output channel
        const mockOutputChannel = {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            appendLine: sandbox.stub(),
        } as any;
        Logger.initialize(mockOutputChannel);
        
        const fs = require('fs');
        fsExistsSyncStub = sandbox.stub(fs, 'existsSync');
        
        mockErrorHandler = {
            handleError: sandbox.stub(),
            handlePersistentError: sandbox.stub()
        };
        
        configProcessor = new ShaderConfigProcessor(mockErrorHandler as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('processInputs - video handling', () => {
        test('should resolve video path when file exists', () => {
            fsExistsSyncStub.returns(true);
            
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: 'video', path: './video.mp4' }
                        }
                    }
                }
            };
            
            configProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            assert.strictEqual(config.passes.Image.inputs.iChannel0.path, '/path/to/video.mp4');
        });

        test('should call handlePersistentError when video file not found', () => {
            fsExistsSyncStub.returns(false);
            
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: 'video', path: './missing-video.mp4' }
                        }
                    }
                }
            };
            
            configProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            sinon.assert.calledOnce(mockErrorHandler.handlePersistentError);
            const errorCall = mockErrorHandler.handlePersistentError.getCall(0).args[0];
            assert.strictEqual(errorCall.type, 'error');
            assert.ok(errorCall.payload[0].includes('Video file not found'));
        });

        test('should handle multiple video inputs', () => {
            fsExistsSyncStub.returns(true);
            
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: 'video', path: './video1.mp4' },
                            iChannel1: { type: 'video', path: './video2.mp4' }
                        }
                    }
                }
            };
            
            configProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            assert.strictEqual(config.passes.Image.inputs.iChannel0.path, '/path/to/video1.mp4');
            assert.strictEqual(config.passes.Image.inputs.iChannel1.path, '/path/to/video2.mp4');
        });

        test('should handle mixed texture and video inputs', () => {
            fsExistsSyncStub.returns(true);
            
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: 'texture', path: './texture.png' },
                            iChannel1: { type: 'video', path: './video.mp4' }
                        }
                    }
                }
            };
            
            configProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            assert.strictEqual(config.passes.Image.inputs.iChannel0.path, '/path/to/texture.png');
            assert.strictEqual(config.passes.Image.inputs.iChannel1.path, '/path/to/video.mp4');
        });

        test('should handle video inputs in buffer passes', () => {
            fsExistsSyncStub.returns(true);
            
            const config = {
                passes: {
                    BufferA: {
                        inputs: {
                            iChannel0: { type: 'video', path: './video.mp4' }
                        }
                    },
                    Image: {
                        inputs: {}
                    }
                }
            };
            
            configProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            assert.strictEqual(config.passes.BufferA.inputs.iChannel0.path, '/path/to/video.mp4');
        });

        test('should not modify inputs without path', () => {
            fsExistsSyncStub.returns(true);
            
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: 'video' } // No path
                        }
                    }
                }
            };
            
            configProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            assert.strictEqual((config.passes.Image.inputs.iChannel0 as any).path, undefined);
        });

        test('should handle absolute video paths', () => {
            fsExistsSyncStub.returns(true);
            
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: 'video', path: '/absolute/path/to/video.mp4' }
                        }
                    }
                }
            };
            
            configProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            assert.strictEqual(config.passes.Image.inputs.iChannel0.path, '/absolute/path/to/video.mp4');
        });

        test('should report error for each missing video file', () => {
            fsExistsSyncStub.returns(false);
            
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: 'video', path: './video1.mp4' },
                            iChannel1: { type: 'video', path: './video2.mp4' }
                        }
                    }
                }
            };
            
            configProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            sinon.assert.calledTwice(mockErrorHandler.handlePersistentError);
        });
    });

    suite('constructor injection', () => {
        test('should use injected error handler for errors', () => {
            fsExistsSyncStub.returns(false);
            
            const customErrorHandler = {
                handleError: sandbox.stub(),
                handlePersistentError: sandbox.stub()
            };
            
            const customProcessor = new ShaderConfigProcessor(customErrorHandler as any);
            
            const config = {
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: { type: 'video', path: './missing.mp4' }
                        }
                    }
                }
            };
            
            customProcessor.processConfig(config as any, '/path/to/shader.glsl', {});
            
            sinon.assert.calledOnce(customErrorHandler.handlePersistentError);
            sinon.assert.notCalled(mockErrorHandler.handlePersistentError);
        });
    });
});
