import * as assert from 'assert';
import { ConfigChangeClassifier } from '../../app/services/ConfigChangeClassifier';

suite('ConfigChangeClassifier', () => {
  const base = () => ({
    version: '1.0',
    passes: {
      Image: {
        inputs: {
          iChannel0: { type: 'video', path: 'v.mp4', muted: false },
          iChannel1: { type: 'audio', path: 'a.mp3', startTime: 1, endTime: 4 },
        },
      },
    },
  });
  const CONFIG_PATH = '/x/shader.sha.json';

  function primed(config: unknown = base()): ConfigChangeClassifier {
    const c = new ConfigChangeClassifier();
    c.recordSentConfig(CONFIG_PATH, JSON.stringify(config));
    return c;
  }

  test('skip: formatting/key-order-only change', () => {
    const c = primed();
    const reordered = JSON.stringify(base(), null, 4); // same structure, different formatting
    assert.strictEqual(c.classifyChange(CONFIG_PATH, reordered), 'skip');
  });

  test('skip: muted toggled', () => {
    const c = primed();
    const next = base(); (next.passes.Image.inputs.iChannel0 as any).muted = true;
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'skip');
  });

  test('skip: muted field added where absent', () => {
    const start = base(); delete (start.passes.Image.inputs.iChannel0 as any).muted;
    const c = primed(start);
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(base())), 'skip');
  });

  test('skip: muted field removed', () => {
    const c = primed();
    const next = base(); delete (next.passes.Image.inputs.iChannel0 as any).muted;
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'skip');
  });

  test('recompile: startTime and endTime changed together', () => {
    const c = primed();
    const next = base();
    (next.passes.Image.inputs.iChannel1 as any).startTime = 2;
    (next.passes.Image.inputs.iChannel1 as any).endTime = 9;
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'recompile');
  });

  test('recompile: muted plus another live-safe field changed', () => {
    const c = primed();
    const next = base();
    (next.passes.Image.inputs.iChannel0 as any).muted = true;
    (next.passes.Image.inputs.iChannel1 as any).startTime = 2;
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'recompile');
  });

  test('reload: input path changed', () => {
    const c = primed();
    const next = base(); (next.passes.Image.inputs.iChannel0 as any).path = 'other.mp4';
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'reload');
  });

  test('reload: filter changed', () => {
    const c = primed();
    const next = base(); (next.passes.Image.inputs.iChannel0 as any).filter = 'nearest';
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'reload');
  });

  test('reload: live-safe and structural changes mixed', () => {
    const c = primed();
    const next = base();
    (next.passes.Image.inputs.iChannel0 as any).muted = true;
    (next.passes.Image.inputs.iChannel0 as any).wrap = 'repeat';
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'reload');
  });

  test('reload: whole input added, even if it only carries muted', () => {
    const c = primed();
    const next = base();
    (next.passes.Image.inputs as any).iChannel2 = { type: 'audio', path: 'b.mp3', muted: true };
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'reload');
  });

  test('reload: whole input removed', () => {
    const c = primed();
    const next = base(); delete (next.passes.Image.inputs as any).iChannel1;
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'reload');
  });

  test('reload: buffer pass added', () => {
    const c = primed();
    const next = base(); (next.passes as any).BufferA = { path: 'a.glsl' };
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(next)), 'reload');
  });

  test('reload: script / resolution / unknown root field changed', () => {
    const c1 = primed();
    assert.strictEqual(c1.classifyChange(CONFIG_PATH, JSON.stringify({ ...base(), script: 'u.ts' })), 'reload');
    const c2 = primed();
    const withRes = base(); (withRes.passes.Image as any).resolution = { scale: 2 };
    assert.strictEqual(c2.classifyChange(CONFIG_PATH, JSON.stringify(withRes)), 'reload');
    const c3 = primed();
    assert.strictEqual(c3.classifyChange(CONFIG_PATH, JSON.stringify({ ...base(), someFutureField: 1 })), 'reload');
  });

  test('reload: no snapshot recorded for this path', () => {
    const c = new ConfigChangeClassifier();
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(base())), 'reload');
  });

  test('reload: malformed new text', () => {
    const c = primed();
    assert.strictEqual(c.classifyChange(CONFIG_PATH, '{ not json'), 'reload');
  });

  test('reload: snapshot recorded from malformed text', () => {
    const c = new ConfigChangeClassifier();
    c.recordSentConfig(CONFIG_PATH, '{ not json');
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(base())), 'reload');
  });

  test('snapshots are per path', () => {
    const c = primed();
    assert.strictEqual(c.classifyChange('/other/one.sha.json', JSON.stringify(base())), 'reload');
  });

  test('recordSentConfig(null) clears to safe default', () => {
    const c = primed();
    c.recordSentConfig(CONFIG_PATH, null);
    assert.strictEqual(c.classifyChange(CONFIG_PATH, JSON.stringify(base())), 'reload');
  });
});
