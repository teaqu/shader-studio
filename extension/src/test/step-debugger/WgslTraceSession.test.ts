import * as assert from 'assert';
import type { WgslTraceRecording } from '@shader-studio/types';
import { WgslTraceSession, type TraceProtocolMessage } from '../../step-debugger/WgslTraceSession';

suite('WGSL trace DAP session', () => {
  const recording: WgslTraceRecording = { path: '/image.wgsl', source: 'immutable shader source', color: [0, 0, 0, 1], overflow: false,
    sites: [2, 3, 4].map((line, id) => ({ id, line, column: 1, variables: [] })),
    events: [2, 3, 3, 4].map((line, index) => ({ siteId: line - 2, line, column: 1,
      values: [{ name: 'x', type: 'u32', value: 4000000000 + index }] })) };
  function rig(capture: () => Promise<WgslTraceRecording> = async () => recording, current: () => boolean = () => true) {
    const messages: TraceProtocolMessage[] = [];
    let cleaned = 0;
    let captures = 0;
    let seq = 1;
    const session = new WgslTraceSession(message => messages.push(message), async () => {
      captures++; return capture();
    },
    () => {
      cleaned++;
    }, current);
    const send = (command: string, args?: Record<string, unknown>) => session.handle({ seq: seq++, type: 'request', command, arguments: args });
    return { session, send, messages, cleaned: () => cleaned, captures: () => captures };
  }

  test('handshakes, steps repeated lines, evaluates locals and uses the original shader source editor', async () => {
    const test = rig();
    await test.send('initialize');
    await test.send('configurationDone');
    await test.send('launch');
    assert.ok(test.messages.some(message => message.event === 'stopped'));
    await test.send('next');
    await test.send('next');
    await test.send('evaluate', { expression: 'x' });
    assert.deepStrictEqual(test.messages.at(-1)!.body, { result: '4000000002', type: 'u32', variablesReference: 0 });
    await test.send('stackTrace');
    const stack = test.messages.at(-1)!.body as { stackFrames: { source: { sourceReference: number; path: string; name: string }; line: number }[] };
    assert.strictEqual(stack.stackFrames[0].line, 3);
    assert.deepStrictEqual(stack.stackFrames[0].source, { name: 'image.wgsl', path: '/image.wgsl', sourceReference: 0 });
    await test.send('source', { sourceReference: 1 });
    assert.deepStrictEqual(test.messages.at(-1)!.body, { content: 'immutable shader source', mimeType: 'text/plain' });
    await test.send('source', { sourceReference: 99 });
    assert.strictEqual(test.messages.at(-1)!.success, false);
    await test.send('stepBack');
    await test.send('evaluate', { expression: 'x' });
    assert.strictEqual((test.messages.at(-1)!.body as { result: string }).result, '4000000001');
    assert.strictEqual(test.captures(), 1);
  });

  test('displays unavailable locals and reports their recording limit explicitly', async () => {
    const limited: WgslTraceRecording = { ...recording,
      sites: recording.sites.map(site => ({ ...site, unavailableVariables: [{ name: 'weights', type: 'array<f32, 2>' }] })),
      events: recording.events.map(event => ({ ...event, values: [...event.values,
        { name: 'weights', type: 'array<f32, 2>', value: '<not recorded: unsupported or unresolved type>' }] })) };
    const test = rig(async () => limited);
    await test.send('launch');
    assert.ok(test.messages.some(message => message.event === 'output'
      && JSON.stringify(message.body).includes('weights (array<f32, 2>)')));
    await test.send('variables', { variablesReference: 1 });
    const variables = (test.messages.at(-1)!.body as { variables: { name: string; value: string }[] }).variables;
    assert.strictEqual(variables.find(value => value.name === 'weights')?.value, '<not recorded: unsupported or unresolved type>');
  });

  test('waits for configuration after capture', async () => {
    const test = rig();
    await test.send('launch');
    assert.ok(!test.messages.some(message => message.event === 'stopped'));
    await test.send('configurationDone');
    assert.ok(test.messages.some(message => message.event === 'stopped'));
  });

  test('searches breakpoints forward/backward without running the GPU again', async () => {
    const test = rig();
    await test.send('launch');
    await test.send('setBreakpoints', { source: { path: '/image.wgsl' }, breakpoints: [{ line: 3 }] });
    await test.send('continue');
    await test.send('continue');
    await test.send('reverseContinue');
    await test.send('evaluate', { expression: 'x' });
    assert.strictEqual((test.messages.at(-1)!.body as { result: string }).result, '4000000001');
    await test.send('stepBack');
    await test.send('stepBack');
    await test.send('stackTrace');
    assert.strictEqual((test.messages.at(-1)!.body as { stackFrames: { line: number }[] }).stackFrames[0].line, 2);
    assert.strictEqual(test.captures(), 1);
  });

  test('declines unsupported/absent breakpoints and unavailable expressions', async () => {
    const test = rig();
    await test.send('launch');
    await test.send('setBreakpoints', { source: { path: '/image.wgsl' }, breakpoints: [{ line: 2, condition: 'x > 0' }, { line: 99 }] });
    assert.deepStrictEqual((test.messages.at(-1)!.body as { breakpoints: { verified: boolean }[] }).breakpoints.map(item => item.verified), [false, false]);
    await test.send('evaluate', { expression: 'x + 1' });
    assert.strictEqual(test.messages.at(-1)!.success, false);
    await test.send('stepOut');
    assert.strictEqual(test.messages.at(-1)!.event, 'terminated');
  });

  test('does not treat a breakpoint in a different file as a match', async () => {
    const test = rig();
    await test.send('launch');
    await test.send('setBreakpoints', { source: { path: '/other.wgsl' }, breakpoints: [{ line: 3 }] });
    await test.send('continue');
    assert.strictEqual(test.cleaned(), 1);
    assert.strictEqual(test.messages.at(-1)!.event, 'terminated');
  });

  test('uses each recorded helper source and function when navigating a multi-source trace', async () => {
    const multiSource: WgslTraceRecording = {
      ...recording,
      sources: [
        { path: '/common.wgsl', source: 'fn helper() {}' },
        { path: '/image.wgsl', source: 'fn mainImage() {}' },
      ],
      sites: [
        { id: 0, path: '/common.wgsl', functionName: 'helper', line: 2, column: 1, variables: [] },
        { id: 1, path: '/image.wgsl', functionName: 'mainImage', line: 7, column: 3, variables: [] },
      ],
      events: [
        { siteId: 0, path: '/common.wgsl', functionName: 'helper', line: 2, column: 1, values: [] },
        { siteId: 1, path: '/image.wgsl', functionName: 'mainImage', line: 7, column: 3, values: [] },
      ],
    };
    const test = rig(async () => multiSource);
    await test.send('launch');
    await test.send('stackTrace');
    let stack = test.messages.at(-1)!.body as { stackFrames: { name: string; source: { path: string }; line: number }[] };
    assert.deepStrictEqual(stack.stackFrames[0], { id: 1, name: 'helper', line: 2, column: 1,
      source: { name: 'common.wgsl', path: '/common.wgsl', sourceReference: 0 } });
    await test.send('setBreakpoints', { source: { path: '/image.wgsl' }, breakpoints: [{ line: 7 }] });
    assert.strictEqual((test.messages.at(-1)!.body as { breakpoints: { verified: boolean }[] }).breakpoints[0].verified, true);
    await test.send('continue');
    assert.strictEqual((test.messages.at(-1)!.body as { reason: string }).reason, 'breakpoint');
    await test.send('stackTrace');
    stack = test.messages.at(-1)!.body as { stackFrames: { name: string; source: { path: string }; line: number }[] };
    assert.strictEqual(stack.stackFrames[0].name, 'mainImage');
    assert.strictEqual(stack.stackFrames[0].source.path, '/image.wgsl');
    assert.strictEqual(stack.stackFrames[0].line, 7);
  });

  test('pages recorded frames and expands aggregate locals in the requested frame', async () => {
    const framed: WgslTraceRecording = { ...recording, events: [{
      siteId: 0, line: 3, column: 2, values: [], frames: [
        { id: 20, functionName: 'helper', path: '/common.wgsl', line: 3, column: 2, values: [{
          name: 'state', type: 'State', value: 'State', children: [{
            name: 'weights', type: 'array<f32, 2>', value: '[0.25, 0.5]', children: [
              { name: '0', type: 'f32', value: 0.25 }, { name: '1', type: 'f32', value: 0.5 },
            ],
          }],
        }] },
        { id: 10, functionName: 'mainImage', path: '/image.wgsl', line: 9, column: 1, values: [{ name: 'pixel', type: 'vec2<u32>', value: [4, 8] }] },
      ],
    }] };
    const test = rig(async () => framed);
    await test.send('launch');
    await test.send('stackTrace', { startFrame: 1, levels: 1 });
    assert.deepStrictEqual(test.messages.at(-1)!.body, { stackFrames: [{ id: 10, name: 'mainImage', line: 9, column: 1,
      source: { name: 'image.wgsl', path: '/image.wgsl', sourceReference: 0 } }], totalFrames: 2 });
    await test.send('scopes', { frameId: 20 });
    const reference = ((test.messages.at(-1)!.body as { scopes: { variablesReference: number }[] }).scopes[0]!).variablesReference;
    await test.send('variables', { variablesReference: reference });
    const state = ((test.messages.at(-1)!.body as { variables: { name: string; variablesReference: number }[] }).variables[0]!);
    await test.send('variables', { variablesReference: state.variablesReference, filter: 'named', start: 0, count: 1 });
    const weights = ((test.messages.at(-1)!.body as { variables: { name: string; variablesReference: number }[] }).variables[0]!);
    await test.send('variables', { variablesReference: weights.variablesReference, filter: 'indexed', start: 1, count: 1 });
    assert.deepStrictEqual((test.messages.at(-1)!.body as { variables: unknown[] }).variables, [{ name: '1', type: 'f32', value: '0.5', variablesReference: 0 }]);
    await test.send('evaluate', { frameId: 20, expression: 'state.weights[1]' });
    assert.deepStrictEqual(test.messages.at(-1)!.body, { result: '0.5', type: 'f32', variablesReference: 0 });
    await test.send('scopes', { frameId: 999 });
    assert.strictEqual(test.messages.at(-1)!.success, false);
    await test.send('evaluate', { frameId: 999, expression: 'state.weights[1]' });
    assert.strictEqual(test.messages.at(-1)!.success, false);
  });

  test('steps over nested and repeated calls, stops at a callee breakpoint, and rejects stale locals', async () => {
    const values = (name: string, value: number) => [{ name, type: 'u32', value }];
    const frame = (id: number, functionName: string, path: string, line: number, name: string, value: number) =>
      ({ id, functionName, path, line, column: 1, values: values(name, value) });
    const framed: WgslTraceRecording = { ...recording, sites: [
      { id: 0, path: '/image.wgsl', functionName: 'mainImage', line: 10, column: 1, variables: [] },
      { id: 1, path: '/common.wgsl', functionName: 'helper', line: 3, column: 1, variables: [] },
      { id: 2, path: '/common.wgsl', functionName: 'helper', line: 4, column: 1, variables: [] },
      { id: 3, path: '/image.wgsl', functionName: 'mainImage', line: 11, column: 1, variables: [] },
      { id: 4, path: '/image.wgsl', functionName: 'mainImage', line: 12, column: 1, variables: [] },
    ], events: [
      { siteId: 0, line: 10, column: 1, values: [], frames: [frame(10, 'mainImage', '/image.wgsl', 10, 'caller', 0)] },
      { siteId: 1, line: 3, column: 1, values: [], frames: [frame(20, 'helper', '/common.wgsl', 3, 'call', 1), frame(10, 'mainImage', '/image.wgsl', 10, 'caller', 0)] },
      { siteId: 2, line: 4, column: 1, values: [], frames: [frame(20, 'helper', '/common.wgsl', 4, 'call', 2), frame(10, 'mainImage', '/image.wgsl', 10, 'caller', 0)] },
      { siteId: 3, line: 11, column: 1, values: [], frames: [frame(10, 'mainImage', '/image.wgsl', 11, 'caller', 1)] },
      { siteId: 1, line: 3, column: 1, values: [], frames: [frame(21, 'helper', '/common.wgsl', 3, 'call', 3), frame(10, 'mainImage', '/image.wgsl', 11, 'caller', 1)] },
      { siteId: 4, line: 12, column: 1, values: [], frames: [frame(10, 'mainImage', '/image.wgsl', 12, 'caller', 2)] },
    ] };
    const test = rig(async () => framed);
    await test.send('launch');
    await test.send('stepIn');
    await test.send('scopes', { frameId: 20 });
    const staleReference = ((test.messages.at(-1)!.body as { scopes: { variablesReference: number }[] }).scopes[0]!).variablesReference;
    await test.send('next');
    await test.send('stackTrace');
    assert.strictEqual((test.messages.at(-1)!.body as { stackFrames: { id: number; line: number }[] }).stackFrames[0]!.id, 20);
    await test.send('stepOut');
    await test.send('variables', { variablesReference: staleReference });
    assert.strictEqual(test.messages.at(-1)!.success, false);
    await test.send('setBreakpoints', { source: { path: '/common.wgsl' }, breakpoints: [{ line: 3 }] });
    await test.send('next');
    assert.strictEqual((test.messages.at(-1)!.body as { reason: string }).reason, 'breakpoint');
    await test.send('stackTrace');
    assert.strictEqual((test.messages.at(-1)!.body as { stackFrames: { id: number }[] }).stackFrames[0]!.id, 21);
    await test.send('stepOut');
    await test.send('stackTrace');
    assert.strictEqual((test.messages.at(-1)!.body as { stackFrames: { line: number }[] }).stackFrames[0]!.line, 12);
  });

  test('keeps a partial stack available when an overflowing trace ends in an active helper', async () => {
    const partial: WgslTraceRecording = { ...recording, overflow: true, events: [{
      siteId: 0, line: 3, column: 1, values: [], frames: [
        { id: 2, functionName: 'helper', path: '/common.wgsl', line: 3, column: 1, values: [] },
        { id: 1, functionName: 'mainImage', path: '/image.wgsl', line: 8, column: 1, values: [] },
      ],
    }] };
    const test = rig(async () => partial);
    await test.send('launch');
    await test.send('stackTrace');
    assert.strictEqual((test.messages.at(-1)!.body as { totalFrames: number }).totalFrames, 2);
    await test.send('stepOut');
    assert.ok(JSON.stringify(test.messages).includes('End of incomplete trace recording'));
    assert.strictEqual(test.messages.at(-1)!.event, 'terminated');
  });

  test('verifies initial breakpoints after capture and retains them when another file is configured', async () => {
    const test = rig();
    await test.send('setBreakpoints', { source: { path: '/image.wgsl' }, breakpoints: [{ line: 3 }, { line: 99 }] });
    assert.deepStrictEqual((test.messages.at(-1)!.body as { breakpoints: { verified: boolean }[] }).breakpoints.map(item => item.verified), [false, false]);
    await test.send('setBreakpoints', { source: { path: '/other.wgsl' }, breakpoints: [{ line: 4 }] });
    await test.send('launch');
    const verified = test.messages.filter(message => message.event === 'breakpoint')
      .map(message => (message.body as { breakpoint: { verified: boolean } }).breakpoint.verified);
    assert.deepStrictEqual(verified, [true, false, false]);
    await test.send('continue');
    await test.send('stackTrace');
    assert.strictEqual((test.messages.at(-1)!.body as { stackFrames: { line: number }[] }).stackFrames[0].line, 3);
    await test.send('setBreakpoints', { source: { sourceReference: 1 }, breakpoints: [{ line: 4 }] });
    await test.send('continue');
    await test.send('stackTrace');
    assert.strictEqual((test.messages.at(-1)!.body as { stackFrames: { line: number }[] }).stackFrames[0].line, 4);
  });

  test('reports overflow and distinguishes end of an incomplete recording', async () => {
    const test = rig(async () => ({ ...recording, overflow: true }));
    await test.send('launch');
    assert.ok(JSON.stringify(test.messages).includes('capacity reached'));
    await test.send('continue');
    assert.ok(JSON.stringify(test.messages).includes('End of incomplete'));
    test.session.dispose();
    assert.strictEqual(test.cleaned(), 1);
  });

  test('cancels an in-flight capture and ignores its late result', async () => {
    let finish!: (value: WgslTraceRecording) => void;
    const test = rig(() => new Promise(resolve => {
      finish = resolve;
    }));
    const pending = test.send('launch');
    await test.send('disconnect');
    finish(recording);
    await pending;
    assert.strictEqual(test.cleaned(), 1);
    assert.ok(!test.messages.some(message => message.event === 'stopped'));
    assert.strictEqual(test.messages.at(-1)!.success, false);
  });

  test('reports capture failures/empty traces and releases resources', async () => {
    for (const capture of [async () => {
      throw new Error('GPU lost');
    }, async () => ({ ...recording, events: [] })]) {
      const test = rig(capture);
      await test.send('launch');
      assert.ok(test.messages.some(message => message.success === false));
      assert.strictEqual(test.cleaned(), 1);
    }
  });

  test('invalidates stepping after a source edit', async () => {
    let current = true;
    const test = rig(undefined, () => current);
    await test.send('launch');
    current = false;
    await test.send('next');
    assert.strictEqual(test.messages.at(-1)!.success, false);
    assert.strictEqual(test.cleaned(), 1);
  });
});
