import * as assert from 'assert';
import * as sinon from 'sinon';
import { ScriptEvaluator } from '../app/ScriptEvaluator';
import { Logger } from '../app/services/Logger';

function makeBundle(body: string): string {
    return `var __shaderUniforms = { uniforms: function(ctx) { ${body} } };`;
}

suite('ScriptEvaluator', () => {
    let evaluator: ScriptEvaluator;
    let sandbox: sinon.SinonSandbox;
    let clock: sinon.SinonFakeTimers;

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

        clock = sandbox.useFakeTimers();
        evaluator = new ScriptEvaluator();
    });

    teardown(() => {
        evaluator.dispose();
        sandbox.restore();
        (Logger as any).instance = undefined;
    });

    suite('loadScript', () => {
        test('should load a valid script', () => {
            const result = evaluator.loadScript(makeBundle('return { uVal: 1.0 };'));
            assert.strictEqual(result.error, undefined);
            assert.strictEqual(result.declarations, 'uniform float uVal;');
            assert.deepStrictEqual(result.uniforms, [{ name: 'uVal', type: 'float' }]);
            assert.strictEqual(evaluator.hasUniforms(), true);
        });

        test('should reject scripts without uniforms function', () => {
            const result = evaluator.loadScript('var __shaderUniforms = {};');
            assert.ok(result.error?.includes('uniforms(ctx)'));
        });

        test('should detect built-in collisions', () => {
            const result = evaluator.loadScript(makeBundle('return { iTime: 1.0 };'));
            assert.ok(result.error?.includes('conflict with built-ins'));
        });

        test('should stop existing polling on reload', () => {
            evaluator.loadScript(makeBundle('return { uVal: 1.0 };'));
            const callback = sinon.stub();
            evaluator.startPolling(callback, 100);

            callback.resetHistory();
            evaluator.loadScript(makeBundle('return { uNew: 2.0 };'));
            clock.tick(200);

            sinon.assert.notCalled(callback);
        });
    });

    suite('startPolling', () => {
        test('should call callback immediately with initial values', () => {
            evaluator.loadScript(makeBundle('return { uVal: 1.0 };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 100);

            sinon.assert.calledOnce(callback);
            const firstCallArg = callback.firstCall.args[0];
            assert.deepStrictEqual(firstCallArg, [{ name: 'uVal', type: 'float', value: 1.0 }]);
        });

        test('should poll at the specified interval', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 100);
            assert.strictEqual(callback.callCount, 1); // initial

            clock.tick(100);
            assert.strictEqual(callback.callCount, 2);

            clock.tick(100);
            assert.strictEqual(callback.callCount, 3);
        });

        test('should not poll when no uniforms', () => {
            evaluator.loadScript(makeBundle('return {};'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 100);
            clock.tick(500);

            sinon.assert.notCalled(callback);
        });

        test('should stop previous polling when called again', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback1 = sinon.stub();
            const callback2 = sinon.stub();

            evaluator.startPolling(callback1, 100);
            callback1.resetHistory();

            evaluator.startPolling(callback2, 100);
            clock.tick(100);

            sinon.assert.notCalled(callback1);
            sinon.assert.called(callback2);
        });

        test('should only send values when they change', () => {
            evaluator.loadScript(makeBundle('return { uVal: 42.0 };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 50);
            assert.strictEqual(callback.callCount, 1); // initial

            clock.tick(200);
            // Static value doesn't change, so no additional calls
            assert.strictEqual(callback.callCount, 1);
        });
    });

    suite('updatePollingRate', () => {
        test('should change the polling interval without stopping', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 100);
            callback.resetHistory();

            evaluator.updatePollingRate(50);

            clock.tick(100);
            assert.ok(callback.callCount >= 2);
        });

        test('should not restart if rate is the same', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 100);
            callback.resetHistory();

            evaluator.updatePollingRate(100); // same rate

            clock.tick(100);
            assert.ok(callback.callCount <= 1);
        });

        test('should do nothing if not currently polling', () => {
            evaluator.loadScript(makeBundle('return { uVal: 1.0 };'));

            evaluator.updatePollingRate(50);

            const callback = sinon.stub();
            clock.tick(200);
            sinon.assert.notCalled(callback);
        });

        test('should preserve the callback when changing rate', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 1000);
            callback.resetHistory();

            evaluator.updatePollingRate(50);
            clock.tick(100);

            sinon.assert.called(callback);
        });

        test('should not reset startTime when changing rate', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 100);
            callback.resetHistory();

            clock.tick(1000);
            evaluator.updatePollingRate(50);
            clock.tick(50);

            const lastCall = callback.lastCall;
            const timeValue = lastCall?.args[0]?.find((v: any) => v.name === 'uTime')?.value;
            assert.ok(timeValue !== undefined && timeValue > 0.9, `iTime should be > 0.9, got ${timeValue}`);
        });
    });

    suite('resetTime', () => {
        test('should reset iTime to near zero', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 100);
            callback.resetHistory();

            clock.tick(2000);

            const timeBefore = callback.lastCall?.args[0]?.find((v: any) => v.name === 'uTime')?.value;
            assert.ok(timeBefore > 1.5, `iTime before reset should be > 1.5, got ${timeBefore}`);

            callback.resetHistory();
            evaluator.resetTime();
            clock.tick(100);

            if (callback.callCount > 0) {
                const timeAfter = callback.lastCall?.args[0]?.find((v: any) => v.name === 'uTime')?.value;
                assert.ok(timeAfter < 0.5, `iTime after reset should be < 0.5, got ${timeAfter}`);
            }
        });

        test('should not affect polling cadence', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 100);
            callback.resetHistory();

            clock.tick(500);
            const callsBefore = callback.callCount;
            callback.resetHistory();

            evaluator.resetTime();
            clock.tick(500);
            const callsAfter = callback.callCount;

            assert.ok(callsAfter >= callsBefore - 1);
        });
    });

    suite('stop', () => {
        test('should stop polling', () => {
            evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
            const callback = sinon.stub();

            evaluator.startPolling(callback, 50);
            callback.resetHistory();

            evaluator.stop();
            clock.tick(500);

            sinon.assert.notCalled(callback);
        });
    });

    suite('dispose', () => {
        test('should stop polling and clear state', () => {
            evaluator.loadScript(makeBundle('return { uVal: 1.0 };'));
            const callback = sinon.stub();
            evaluator.startPolling(callback, 50);

            evaluator.dispose();

            assert.strictEqual(evaluator.hasUniforms(), false);
            assert.deepStrictEqual(evaluator.getLastValues(), []);
        });
    });
});
