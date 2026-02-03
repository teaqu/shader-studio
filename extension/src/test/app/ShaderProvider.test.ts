import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ShaderProvider } from '../../app/ShaderProvider';
import { ShaderConfigProcessor } from '../../app/ShaderConfigProcessor';
import { Logger } from '../../app/services/Logger';

suite('ShaderProvider Test Suite', () => {
    let provider: ShaderProvider;
    let mockMessenger: any;
    let sandbox: sinon.SinonSandbox;
    let sendSpy: sinon.SinonSpy;
    let mockOutputChannel: any;
    let loadAndProcessConfigStub: sinon.SinonStub;
    let processConfigStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockOutputChannel = {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            dispose: sandbox.stub(),
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            name: 'Test Output',
            replace: sandbox.stub(),
        };

        Logger.initialize(mockOutputChannel);

        sendSpy = sandbox.spy();
        mockMessenger = {
            send: sendSpy,
            hasActiveClients: sandbox.stub().returns(true),
            getErrorHandler: sandbox.stub().returns({
                handleError: sandbox.stub(),
                handlePersistentError: sandbox.stub()
            })
        };

        // Stub prototype methods before creating provider
        loadAndProcessConfigStub = sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig');
        processConfigStub = sandbox.stub(ShaderConfigProcessor.prototype, 'processConfig');

        provider = new ShaderProvider(mockMessenger);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('isCommonBufferFile', () => {
        test('should return true when file is used as common buffer in active shader', () => {
            const shaderPath = '/path/to/shader.glsl';
            const commonBufferPath = '/path/to/common.glsl';

            // Mock config with common buffer
            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {},
                    common: { path: commonBufferPath }
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            // Add active shader
            (provider as any).activeShaders.add(shaderPath);

            const result = (provider as any).isCommonBufferFile(commonBufferPath);
            assert.strictEqual(result, true);
        });

        test('should return false when file is not used as common buffer', () => {
            const shaderPath = '/path/to/shader.glsl';
            const otherPath = '/path/to/other.glsl';

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {},
                    common: { path: '/different/path.glsl' }
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            (provider as any).activeShaders.add(shaderPath);

            const result = (provider as any).isCommonBufferFile(otherPath);
            assert.strictEqual(result, false);
        });

        test('should return false when no active shaders', () => {
            const result = (provider as any).isCommonBufferFile('/any/path.glsl');
            assert.strictEqual(result, false);
        });
    });

    suite('updatePreviewedShadersUsingCommonBuffer', () => {
        test('should send updates to shaders that use the common buffer', () => {
            const shaderPath = '/path/to/shader.glsl';
            const commonBufferPath = '/path/to/common.glsl';

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {},
                    common: { path: commonBufferPath }
                }
            };

            const mockBuffers = {
                Image: 'shader code',
                common: 'common code'
            };

            loadAndProcessConfigStub.returns(mockConfig);
            processConfigStub.callsFake((_config: any, _path: any, buffers: any) => {
                buffers.Image = 'shader code';
                buffers.common = 'common code';
            });

            (provider as any).activeShaders.add(shaderPath);

            (provider as any).updatePreviewedShadersUsingCommonBuffer(commonBufferPath);

            sinon.assert.calledOnce(sendSpy);
            const message = sendSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shaderSource');
            assert.strictEqual(message.code, 'shader code');
            assert.strictEqual(message.path, shaderPath);
            assert.deepStrictEqual(message.buffers, mockBuffers);
        });

        test('should not send updates to shaders that do not use the common buffer', () => {
            const shaderPath = '/path/to/shader.glsl';
            const commonBufferPath = '/path/to/common.glsl';

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {},
                    common: { path: '/different/common.glsl' }
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            (provider as any).activeShaders.add(shaderPath);

            (provider as any).updatePreviewedShadersUsingCommonBuffer(commonBufferPath);

            sinon.assert.notCalled(sendSpy);
        });
    });

    suite('sendShaderToWebview', () => {
        test('should call updatePreviewedShadersUsingCommonBuffer for common buffer files', () => {
            const commonBufferPath = '/path/to/common.glsl';
            const shaderPath = '/path/to/shader.glsl';

            const mockEditor = {
                document: {
                    getText: sandbox.stub().returns('common code'),
                    uri: { fsPath: commonBufferPath },
                    languageId: 'glsl'
                }
            };

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {},
                    common: { path: commonBufferPath }
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            (provider as any).activeShaders.add(shaderPath);

            const updateSpy = sandbox.spy(provider as any, 'updatePreviewedShadersUsingCommonBuffer');

            provider.sendShaderToWebview(mockEditor as any);

            sinon.assert.calledOnce(updateSpy);
            sinon.assert.calledWith(updateSpy, commonBufferPath);
            sinon.assert.calledOnce(sendSpy); // Called by updatePreviewedShadersUsingCommonBuffer
        });

        test('should send regular shader for non-common buffer GLSL files with mainImage', () => {
            const shaderPath = '/path/to/shader.glsl';

            const mockEditor = {
                document: {
                    getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
                    uri: { fsPath: shaderPath },
                    languageId: 'glsl'
                }
            };

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {}
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            provider.sendShaderToWebview(mockEditor as any);

            sinon.assert.calledOnce(sendSpy);
            const message = sendSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shaderSource');
            assert.strictEqual(message.code, 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');
            assert.strictEqual(message.path, shaderPath);
        });

        test('should include forceCleanup in message when option is provided', () => {
            const shaderPath = '/path/to/shader.glsl';

            const mockEditor = {
                document: {
                    getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
                    uri: { fsPath: shaderPath },
                    languageId: 'glsl'
                }
            };

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {}
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            provider.sendShaderToWebview(mockEditor as any, { forceCleanup: true });

            sinon.assert.calledOnce(sendSpy);
            const message = sendSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shaderSource');
            assert.strictEqual(message.forceCleanup, true);
        });

        test('should not include forceCleanup when option is not provided', () => {
            const shaderPath = '/path/to/shader.glsl';

            const mockEditor = {
                document: {
                    getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
                    uri: { fsPath: shaderPath },
                    languageId: 'glsl'
                }
            };

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {}
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            provider.sendShaderToWebview(mockEditor as any);

            sinon.assert.calledOnce(sendSpy);
            const message = sendSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shaderSource');
            assert.strictEqual(message.forceCleanup, undefined);
        });

        test('should show warning for GLSL files without mainImage', () => {
            const shaderPath = '/path/to/shader.glsl';

            const mockEditor = {
                document: {
                    getText: sandbox.stub().returns('void someFunction() {}'),
                    uri: { fsPath: shaderPath },
                    languageId: 'glsl'
                }
            };

            const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage');

            provider.sendShaderToWebview(mockEditor as any);

            sinon.assert.calledOnce(showWarningStub);
            sinon.assert.calledWith(showWarningStub, "GLSL file ignored: missing mainImage function.");
            sinon.assert.notCalled(sendSpy);
        });
    });

    suite('removeActiveShader', () => {
        test('should remove shader from active set', () => {
            const shaderPath = '/path/to/shader.glsl';
            (provider as any).activeShaders.add(shaderPath);

            provider.removeActiveShader(shaderPath);

            assert.strictEqual((provider as any).activeShaders.has(shaderPath), false);
        });
    });

    suite('sendShaderFromPath', () => {
        test('should include forceCleanup in message when option is provided', async () => {
            const shaderPath = '/path/to/shader.glsl';
            const fs = require('fs');

            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs, 'readFileSync').returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {}
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            await provider.sendShaderFromPath(shaderPath, { forceCleanup: true });

            sinon.assert.calledOnce(sendSpy);
            const message = sendSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shaderSource');
            assert.strictEqual(message.forceCleanup, true);
            assert.strictEqual(message.path, shaderPath);
        });

        test('should not include forceCleanup when option is not provided', async () => {
            const shaderPath = '/path/to/shader.glsl';
            const fs = require('fs');

            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs, 'readFileSync').returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');

            const mockConfig = {
                version: "1.0",
                passes: {
                    Image: {}
                }
            };

            loadAndProcessConfigStub.returns(mockConfig);

            await provider.sendShaderFromPath(shaderPath);

            sinon.assert.calledOnce(sendSpy);
            const message = sendSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shaderSource');
            assert.strictEqual(message.forceCleanup, undefined);
        });
    });
});