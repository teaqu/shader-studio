import * as assert from 'assert';
import * as sinon from 'sinon';
import { ConfigUpdateHandler } from '../../../app/handlers/ConfigUpdateHandler';
import { Logger } from '../../../app/services/Logger';

suite('ConfigUpdateHandler Test Suite', () => {
    let handler: ConfigUpdateHandler;
    let sandbox: sinon.SinonSandbox;
    let mockGlslFileTracker: any;
    let mockShaderProvider: any;
    let mockMessenger: any;
    let logger: Logger;

    setup(() => {
        sandbox = sinon.createSandbox();

        const mockOutputChannel = {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            dispose: sandbox.stub(),
        } as any;
        Logger.initialize(mockOutputChannel);
        logger = Logger.getInstance();

        mockGlslFileTracker = {
            getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
        } as any;

        mockShaderProvider = {
            sendShaderFromPath: sandbox.stub().resolves(),
        } as any;

        mockMessenger = {
            send: sandbox.stub(),
        } as any;

        handler = new ConfigUpdateHandler(
            mockGlslFileTracker,
            mockShaderProvider,
            mockMessenger,
            logger,
        );
    });

    teardown(() => {
        sandbox.restore();
        (Logger as any).instance = undefined;
    });

    test('can be instantiated', () => {
        assert.ok(handler instanceof ConfigUpdateHandler);
    });

    suite('handleConfigUpdate', () => {
        test('writes config file with the provided text', async () => {
            const fs = require('fs');
            const writeStub = sandbox.stub(fs, 'writeFileSync');

            await handler.handleConfigUpdate({
                config: {} as any,
                text: '{"version":1}',
                shaderPath: '/test/shader.glsl',
            });

            assert.ok(writeStub.calledOnce);
            assert.strictEqual(writeStub.firstCall.args[0], '/test/shader.sha.json');
            assert.strictEqual(writeStub.firstCall.args[1], '{"version":1}');
            assert.strictEqual(writeStub.firstCall.args[2], 'utf-8');
        });

        test('replaces .frag extension when deriving config path', async () => {
            const fs = require('fs');
            const writeStub = sandbox.stub(fs, 'writeFileSync');

            await handler.handleConfigUpdate({
                config: {} as any,
                text: '{}',
                shaderPath: '/test/shader.frag',
            });

            assert.ok(writeStub.calledOnce);
            assert.strictEqual(writeStub.firstCall.args[0], '/test/shader.sha.json');
        });

        test('triggers shader refresh after timeout when skipRefresh is not set', async () => {
            const clock = sandbox.useFakeTimers();
            const fs = require('fs');
            sandbox.stub(fs, 'writeFileSync');

            await handler.handleConfigUpdate({
                config: {} as any,
                text: '{}',
                shaderPath: '/test/shader.glsl',
            });

            assert.ok(mockShaderProvider.sendShaderFromPath.notCalled);
            clock.tick(200);
            assert.ok(mockShaderProvider.sendShaderFromPath.calledOnce);
            assert.strictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[0], '/test/shader.glsl');
            assert.deepStrictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[1], { forceCleanup: true });

            clock.restore();
        });

        test('skips shader refresh when skipRefresh is true', async () => {
            const clock = sandbox.useFakeTimers();
            const fs = require('fs');
            sandbox.stub(fs, 'writeFileSync');

            await handler.handleConfigUpdate({
                config: {} as any,
                text: '{}',
                shaderPath: '/test/shader.glsl',
                skipRefresh: true,
            });

            clock.tick(300);
            assert.ok(mockShaderProvider.sendShaderFromPath.notCalled);

            clock.restore();
        });

        test('falls back to active GLSL editor when shaderPath is not provided', async () => {
            const fs = require('fs');
            const writeStub = sandbox.stub(fs, 'writeFileSync');
            mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns({
                document: { uri: { fsPath: '/active/editor.glsl' } },
            });

            await handler.handleConfigUpdate({
                config: {} as any,
                text: '{}',
            });

            assert.ok(writeStub.calledOnce);
            assert.strictEqual(writeStub.firstCall.args[0], '/active/editor.sha.json');
        });

        test('returns early when shaderPath is absent and no active editor', async () => {
            const fs = require('fs');
            const writeStub = sandbox.stub(fs, 'writeFileSync');
            mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(null);

            await handler.handleConfigUpdate({
                config: {} as any,
                text: '{}',
            });

            assert.ok(writeStub.notCalled);
        });

        test('sends error message to messenger when writeFileSync throws', async () => {
            const fs = require('fs');
            sandbox.stub(fs, 'writeFileSync').throws(new Error('Disk full'));

            await handler.handleConfigUpdate({
                config: {} as any,
                text: '{}',
                shaderPath: '/test/shader.glsl',
            });

            assert.ok((mockMessenger.send as sinon.SinonStub).calledOnce);
            const msg = (mockMessenger.send as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(msg.type, 'error');
            assert.ok(Array.isArray(msg.payload));
            assert.ok((msg.payload[0] as string).includes('Failed to update shader config'));
        });

        test('does not throw when messenger is null and write fails', async () => {
            const handlerNoMessenger = new ConfigUpdateHandler(
                mockGlslFileTracker,
                mockShaderProvider,
                null,
                logger,
            );
            const fs = require('fs');
            sandbox.stub(fs, 'writeFileSync').throws(new Error('IO error'));

            await assert.doesNotReject(
                handlerNoMessenger.handleConfigUpdate({
                    config: {} as any,
                    text: '{}',
                    shaderPath: '/test/shader.glsl',
                }),
            );
        });
    });
});
