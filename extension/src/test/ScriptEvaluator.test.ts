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
      trace: sandbox.stub(),
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

    test('gives a fresh consumer every uniform, not the deltas the last one left', () => {
      // A re-send hands the poll loop a new callback for a client that knows
      // nothing of what the previous one was told. Carrying the old comparison
      // over would withhold every uniform that had not moved since.
      evaluator.loadScript(makeBundle('return { uMoves: ctx.iTime, uHolds: 12.0 };'));
      evaluator.startPolling(sinon.stub(), 100);
      clock.tick(100);

      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);

      sinon.assert.calledOnce(callback);
      assert.deepStrictEqual(
        callback.firstCall.args[0].map((v: any) => v.name),
        ['uMoves', 'uHolds'],
      );
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

    test('should only emit changed uniforms per tick (not all uniforms)', () => {
      evaluator.loadScript(makeBundle('return { uFast: ctx.iTime, uStatic: 1.0 };'));
      const callback = sinon.stub();

      evaluator.startPolling(callback, 100);
      assert.strictEqual(callback.callCount, 1);
      // Initial call sends all uniforms (lastValues was empty)
      const initial = callback.firstCall.args[0];
      assert.strictEqual(initial.length, 2);

      clock.tick(100);
      assert.strictEqual(callback.callCount, 2);
      // Second call: only uFast changed (iTime advanced), uStatic is still 1.0
      const second = callback.secondCall.args[0];
      assert.strictEqual(second.length, 1);
      assert.strictEqual(second[0].name, 'uFast');
    });

    test('should emit all uniforms on first poll regardless of value', () => {
      evaluator.loadScript(makeBundle('return { uA: 0.0, uB: false };'));
      const callback = sinon.stub();

      evaluator.startPolling(callback, 100);

      // Even zero/false values must be emitted on the first call
      const initial = callback.firstCall.args[0];
      assert.strictEqual(initial.length, 2);
      assert.ok(initial.some((v: any) => v.name === 'uA'));
      assert.ok(initial.some((v: any) => v.name === 'uB'));
    });

    test('should emit vec uniforms only when their array contents change', () => {
      let tick = 0;
      evaluator.loadScript(makeBundle(
        'return { uVec: tick++ < 1 ? [1.0, 2.0, 3.0] : [1.0, 2.0, 4.0] };'
      ));
      // Inject tick into the script scope via a simpler approach:
      // Use iTime to drive the change instead
      evaluator.loadScript(makeBundle(
        'return { uVec: [ctx.iTime, 0.0, 0.0] };'
      ));
      const callback = sinon.stub();

      evaluator.startPolling(callback, 100);
      assert.strictEqual(callback.callCount, 1);

      clock.tick(100);
      // uVec[0] changes with iTime → should emit
      assert.strictEqual(callback.callCount, 2);
      const second = callback.secondCall.args[0];
      assert.strictEqual(second.length, 1);
      assert.strictEqual(second[0].name, 'uVec');
      assert.ok(Array.isArray(second[0].value));
    });
  });

  suite('setRuntimeState', () => {
    /** What the viewer reports about the shader the script is feeding. */
    const running = (over = {}) => ({
      paused: false,
      time: 12,
      frame: 360,
      frameRate: 60,
      resolution: [1920, 1080, 1920 / 1080] as [number, number, number],
      mouse: [400, 300, 1, 0] as [number, number, number, number],
      channelTimes: [1.5, 2.5, 0, 0],
      sampleRate: 48000,
      ...over,
    });

    test('stops running the script while the shader is paused', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);
      callback.resetHistory();

      evaluator.setRuntimeState(running({ paused: true }));
      clock.tick(1000);

      // A paused shader is not asking for new values, and a script is free to
      // poll hardware or the network on every call.
      sinon.assert.notCalled(callback);
    });

    test('resumes at the same cadence when the shader is unpaused', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);
      evaluator.setRuntimeState(running({ paused: true }));
      clock.tick(500);
      callback.resetHistory();

      evaluator.setRuntimeState(running({ paused: false }));
      clock.tick(100);
      clock.tick(100);

      assert.ok(callback.callCount >= 2, `polling did not resume (${callback.callCount} calls)`);
    });

    test('feeds the shader time the viewer reports, not wall clock', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();
      evaluator.setRuntimeState(running({ time: 12 }));
      evaluator.startPolling(callback, 100);

      assert.deepStrictEqual(callback.firstCall.args[0], [{ name: 'uTime', type: 'float', value: 12 }]);
    });

    test('advances shader time between syncs while the shader runs', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();
      evaluator.setRuntimeState(running({ time: 12 }));
      evaluator.startPolling(callback, 100);

      clock.tick(500);

      const latest = callback.lastCall.args[0][0].value as number;
      assert.ok(Math.abs(latest - 12.5) < 0.05, `expected ~12.5, got ${latest}`);
    });

    test('holds shader time still while the shader is paused', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime, uTick: Math.random() };'));
      const callback = sinon.stub();
      evaluator.setRuntimeState(running({ time: 12, paused: true }));
      evaluator.startPolling(callback, 100);
      clock.tick(5000);

      // Whatever it last reported must still be the paused time, not the time
      // that passed while nothing was rendering.
      evaluator.setRuntimeState(running({ time: 12, paused: false }));
      clock.tick(0);
      const value = evaluator.getLastValues().find((v) => v.name === 'uTime');
      assert.ok(value && Math.abs((value.value as number) - 12) < 0.05, JSON.stringify(value));
    });

    test('reports the real resolution, mouse, frame, and frame rate', () => {
      evaluator.loadScript(makeBundle(
        'return { uRes: ctx.iResolution, uMouse: ctx.iMouse, uFrame: ctx.iFrame, uRate: ctx.iFrameRate };',
      ));
      const callback = sinon.stub();
      evaluator.setRuntimeState(running());
      evaluator.startPolling(callback, 100);

      const values = callback.firstCall.args[0] as { name: string; value: unknown }[];
      const byName = Object.fromEntries(values.map((v) => [v.name, v.value]));
      assert.deepStrictEqual(byName.uRes, [1920, 1080, 1920 / 1080]);
      assert.deepStrictEqual(byName.uMouse, [400, 300, 1, 0]);
      assert.strictEqual(byName.uFrame, 360);
      assert.strictEqual(byName.uRate, 60);
    });

    test('follows a scrub backwards instead of drifting on from the old time', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();
      evaluator.setRuntimeState(running({ time: 12 }));
      evaluator.startPolling(callback, 100);
      clock.tick(300);

      evaluator.setRuntimeState(running({ time: 2 }));
      clock.tick(100);

      const latest = callback.lastCall.args[0][0].value as number;
      assert.ok(Math.abs(latest - 2.1) < 0.05, `expected ~2.1, got ${latest}`);
    });

    test('carries the reported channel times and sample rate into the script context', () => {
      evaluator.loadScript(makeBundle('return { uCh: ctx.iChannelTime, uRate: ctx.iSampleRate };'));
      const callback = sinon.stub();
      evaluator.setRuntimeState(running({
        channelTimes: [1.5, 2.5, 0, 0],
        sampleRate: 48000,
      } as any));
      evaluator.startPolling(callback, 100);

      const values = callback.firstCall.args[0] as { name: string; value: unknown }[];
      const byName = Object.fromEntries(values.map((v) => [v.name, v.value]));
      assert.deepStrictEqual(byName.uCh, [1.5, 2.5, 0, 0]);
      assert.strictEqual(byName.uRate, 48000);
    });

    test('falls back to zero channel times and 44100Hz until the viewer reports anything', () => {
      evaluator.loadScript(makeBundle('return { uCh: ctx.iChannelTime, uRate: ctx.iSampleRate };'));
      const callback = sinon.stub();

      evaluator.startPolling(callback, 100);

      const values = callback.firstCall.args[0] as { name: string; value: unknown }[];
      const byName = Object.fromEntries(values.map((v) => [v.name, v.value]));
      assert.deepStrictEqual(byName.uCh, [0, 0, 0, 0]);
      assert.strictEqual(byName.uRate, 44100);
    });

    test('falls back to its own clock until the viewer reports anything', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();

      evaluator.startPolling(callback, 100);
      clock.tick(200);

      const latest = callback.lastCall.args[0][0].value as number;
      assert.ok(Math.abs(latest - 0.2) < 0.05, `expected ~0.2, got ${latest}`);
    });
  });

  suite('setRuntimeState with an incomplete report', () => {
    /**
     * The report crosses a WebSocket as plain JSON, so the evaluator takes it
     * as it finds it: fill in what is missing rather than throw, and rather
     * than drop a report whose pause flag is the part that matters.
     */
    const startWith = (state: any) => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime, uRes: ctx.iResolution };'));
      const callback = sinon.stub();
      evaluator.setRuntimeState(state);
      evaluator.startPolling(callback, 100);
      return callback;
    };

    test('fills in arrays a report left out instead of throwing', () => {
      const callback = startWith({ paused: false, time: 3 });

      const values = callback.firstCall.args[0] as { name: string; value: any }[];
      const byName = Object.fromEntries(values.map((v) => [v.name, v.value]));
      assert.strictEqual(byName.uTime, 3);
      assert.deepStrictEqual(byName.uRes, [0, 0, 0]);
    });

    test('still pauses on a report carrying nothing but the pause flag', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);
      callback.resetHistory();

      // An older webview sends fewer fields; the flag that stops the script
      // must still be acted on.
      evaluator.setRuntimeState({ paused: true } as any);
      clock.tick(1000);

      sinon.assert.notCalled(callback);
    });

    test('treats a non-boolean pause as running rather than as truthy', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);
      callback.resetHistory();

      evaluator.setRuntimeState({ paused: 'no' } as any);
      clock.tick(200);

      assert.ok(callback.callCount > 0, 'the string "no" stopped the script');
    });

    test('rejects NaN and non-numeric time, which would poison every uniform', () => {
      const callback = startWith({ paused: false, time: NaN, frameRate: '60' });

      const value = (callback.firstCall.args[0] as { name: string; value: any }[])
        .find((v) => v.name === 'uTime');
      assert.strictEqual(value?.value, 0);
    });

    test('survives a report that is not an object at all', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();

      evaluator.setRuntimeState(undefined as any);
      evaluator.startPolling(callback, 100);

      assert.ok(callback.callCount > 0, 'polling never started');
    });

    test('defaults the sample rate to 44100 when the report omits it', () => {
      const callback = startWith({ paused: false, time: 0 });
      callback.resetHistory();
      evaluator.loadScript(makeBundle('return { uRate: ctx.iSampleRate };'));
      const rateCallback = sinon.stub();
      evaluator.setRuntimeState({ paused: false, time: 0 } as any);
      evaluator.startPolling(rateCallback, 100);

      const values = rateCallback.firstCall.args[0] as { name: string; value: any }[];
      assert.strictEqual(values.find((v) => v.name === 'uRate')?.value, 44100);
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

    test('rewinds the reported shader clock, not just its own', () => {
      // With a runtime state the fallback clock is unused, so resetting only
      // startTime would leave the script reading the pre-reset time until the
      // viewer's next report arrived.
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime, uFrame: ctx.iFrame };'));
      evaluator.setRuntimeState({
        paused: false,
        time: 12,
        frame: 720,
        frameRate: 60,
        resolution: [800, 600, 800 / 600],
        mouse: [0, 0, 0, 0],
        channelTimes: [0, 0, 0, 0],
        sampleRate: 44100,
      });
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);
      callback.resetHistory();

      evaluator.resetTime();
      clock.tick(100);

      const values = callback.lastCall.args[0] as { name: string; value: any }[];
      const byName = Object.fromEntries(values.map((v) => [v.name, v.value]));
      assert.ok(byName.uTime < 0.5, `iTime after reset should be near zero, got ${byName.uTime}`);
      assert.ok(byName.uFrame < 30, `iFrame after reset should be near zero, got ${byName.uFrame}`);
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

  suite('currentValues', () => {
    // Poll batches after the first carry only what changed, so a uniform the
    // script holds constant is sent once. A client that rebuilt its uniform
    // state - a swapped engine, a recompile - has no way back to it without a
    // full answer, and every effect that constant drives silently does nothing.
    const bundle = makeBundle('return { uMoves: ctx.iTime, uHolds: 12.0 };');

    test('answers with every uniform, not just the ones that moved', () => {
      evaluator.loadScript(bundle);
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);
      clock.tick(100);

      const delta = callback.lastCall.args[0];
      assert.deepStrictEqual(delta.map((v: any) => v.name), ['uMoves']);

      const values = evaluator.currentValues();
      assert.deepStrictEqual(values.map((v: any) => v.name), ['uMoves', 'uHolds']);
      const holds = values.find((v: any) => v.name === 'uHolds');
      assert.ok(holds);
      assert.strictEqual(holds.value, 12.0);
    });

    test('answers while the shader is paused', () => {
      // A paused picture is still drawn with the values the script last stood
      // at, so a client that lost them while paused still has to get them back.
      evaluator.loadScript(bundle);
      evaluator.setRuntimeState({ paused: false, time: 2 });
      evaluator.startPolling(sinon.stub(), 100);
      evaluator.setRuntimeState({ paused: true, time: 9 });

      const values = evaluator.currentValues();
      assert.deepStrictEqual(values.map((v: any) => v.name), ['uMoves', 'uHolds']);
      const moves = values.find((v: any) => v.name === 'uMoves');
      assert.ok(moves);
      // The paused picture was fed the last poll at time 2. A full-value
      // request must re-send that snapshot, not run the script at the newer
      // pause report time and alter the frozen image.
      assert.strictEqual(moves.value, 2);
    });

    test('does not rerun a stateful script when answering while paused', () => {
      const statefulBundle = 'let calls = 0; var __shaderUniforms = { uniforms: function() { return { uCalls: ++calls }; } };';
      evaluator.loadScript(statefulBundle);
      evaluator.startPolling(sinon.stub(), 100);
      evaluator.setRuntimeState({ paused: true, time: 1 });

      const values = evaluator.currentValues();

      // `loadScript` calls once to infer types and startPolling records the
      // second call. A paused full-value request must be a read of that second
      // result, not a third call with a new value or side effect.
      assert.deepStrictEqual(values, [{ name: 'uCalls', type: 'float', value: 2 }]);
    });

    test('takes an initial snapshot when it starts paused', () => {
      const statefulBundle = 'let calls = 0; var __shaderUniforms = { uniforms: function(ctx) { return { uCalls: ++calls, uTime: ctx.iTime }; } };';
      evaluator.loadScript(statefulBundle);
      evaluator.setRuntimeState({ paused: true, time: 3 });
      evaluator.startPolling(sinon.stub(), 100);

      // There is no earlier poll to cache while startup is paused, but the
      // first compiled frame still needs the script's constants. The next
      // request must use that newly created snapshot too.
      const first = evaluator.currentValues();
      const second = evaluator.currentValues();
      assert.deepStrictEqual(first, [
        { name: 'uCalls', type: 'float', value: 2 },
        { name: 'uTime', type: 'float', value: 3 },
      ]);
      assert.deepStrictEqual(second, first);
    });

    test('leaves the delta stream comparing against what it answered', () => {
      evaluator.loadScript(bundle);
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);
      evaluator.currentValues();
      callback.resetHistory();

      clock.tick(100);

      assert.deepStrictEqual(
        callback.lastCall.args[0].map((v: any) => v.name),
        ['uMoves'],
        'the constant it just answered with should not be resent as changed',
      );
    });

    test('answers with nothing when no script is loaded', () => {
      assert.deepStrictEqual(evaluator.currentValues(), []);
    });
  });

  suite('getLastValues', () => {
    test('should return empty array before polling starts', () => {
      evaluator.loadScript(makeBundle('return { uVal: 1.0 };'));
      assert.deepStrictEqual(evaluator.getLastValues(), []);
    });

    test('should return the most recently emitted values after polling starts', () => {
      evaluator.loadScript(makeBundle('return { uVal: 5.0 };'));
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);

      const lastValues = evaluator.getLastValues();
      assert.strictEqual(lastValues.length, 1);
      assert.strictEqual(lastValues[0].name, 'uVal');
      assert.strictEqual(lastValues[0].value, 5.0);
    });

    test('should update as values change across ticks', () => {
      evaluator.loadScript(makeBundle('return { uTime: ctx.iTime };'));
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);
      const firstTime = (evaluator.getLastValues()[0] as any).value;

      clock.tick(100);
      const laterTime = (evaluator.getLastValues()[0] as any).value;
      assert.ok(laterTime > firstTime, 'iTime should advance');
    });
  });

  suite('runtime errors', () => {
    test('should emit zero values when script throws at runtime', () => {
      // Script is valid at iTime=0 but throws for iTime > 0
      evaluator.loadScript(makeBundle(
        'if (ctx.iTime > 0) throw new Error("runtime oops"); return { uVal: 1.0 };'
      ));
      const callback = sinon.stub();
      evaluator.startPolling(callback, 100);

      assert.strictEqual(callback.callCount, 1); // initial succeeds (iTime=0)
      const initial = callback.firstCall.args[0];
      assert.strictEqual(initial[0].value, 1.0);

      // Advance clock — iTime > 0 → script throws → zero values emitted
      clock.tick(100);
      assert.strictEqual(callback.callCount, 2);
      const errorValues = callback.secondCall.args[0];
      assert.ok(errorValues.some((v: any) => v.name === 'uVal' && v.value === 0));
    });
  });
});
