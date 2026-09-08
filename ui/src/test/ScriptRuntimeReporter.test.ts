import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScriptRuntimeReporter } from '../lib/ScriptRuntimeReporter';

/**
 * The script runs in the extension host, which has no clock of the shader's
 * own. This is what tells it: pause stops the script, and `ctx` carries the
 * shader's real time, size, and mouse instead of a wall clock and fictions.
 */
describe('ScriptRuntimeReporter', () => {
  let posted: any[];
  let engine: any;
  let reporter: ScriptRuntimeReporter;
  let state: {
    paused: boolean;
    time: number;
    frame: number;
    fps: number;
    mouse: [number, number, number, number];
    width: number;
    height: number;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    state = { paused: false, time: 4, frame: 240, fps: 60, mouse: [1, 2, 1, 0], width: 800, height: 400 };
    engine = {
      getTimeManager: () => ({
        isPaused: () => state.paused,
        getCurrentTime: () => state.time,
        getFrame: () => state.frame,
      }),
      getCurrentFPS: () => state.fps,
      getMouse: () => state.mouse,
      getCanvas: () => ({ width: state.width, height: state.height }),
    };
    reporter = new ScriptRuntimeReporter(engine, { postMessage: (m: any) => posted.push(m) } as any);
  });

  afterEach(() => {
    reporter.dispose();
    vi.useRealTimers();
  });

  const payloads = () => posted
    .filter((message) => message.type === 'scriptRuntimeState')
    .map((message) => message.payload);

  it('reports the shader state as soon as it starts', () => {
    reporter.start();

    expect(payloads()).toEqual([{
      paused: false,
      time: 4,
      frame: 240,
      frameRate: 60,
      resolution: [800, 400, 2],
      mouse: [1, 2, 1, 0],
      channelTimes: [0, 0, 0, 0],
      sampleRate: 44100,
    }]);
  });

  it('reports a pause within the throttle window rather than at the next sample', () => {
    reporter.start();
    posted.length = 0;

    state.paused = true;
    reporter.sync();
    vi.advanceTimersByTime(50);

    expect(payloads()).toEqual([expect.objectContaining({ paused: true })]);
  });

  it('stays quiet while nothing but time moves', () => {
    reporter.start();
    posted.length = 0;

    // The host advances time itself between reports, so a shader running in
    // step with the wall clock needs no traffic at all.
    for (let step = 1; step <= 4; step++) {
      state.time = 4 + step * 0.25;
      state.frame = 240 + step * 15;
      vi.advanceTimersByTime(250);
    }

    expect(payloads()).toEqual([]);
  });

  it('reports again when the shader time stops matching what the host would predict', () => {
    reporter.start();
    posted.length = 0;

    // A scrub: time jumps somewhere the host could not have predicted.
    state.time = 40;
    vi.advanceTimersByTime(250);

    expect(payloads()).toEqual([expect.objectContaining({ time: 40 })]);
  });

  it.each([[0, 60], [60, 30], [30, 60]])('reports FPS changing from %s to %s while time stays in step', (before, after) => {
    state.fps = before;
    reporter.start();
    posted.length = 0;
    state.fps = after;
    state.time += 0.25;
    state.frame += Math.floor(after * 0.25);
    vi.advanceTimersByTime(250);
    expect(payloads()).toEqual([expect.objectContaining({ frameRate: after, frame: state.frame })]);
  });

  it('corrects accumulated frame drift even when FPS and time agree', () => {
    reporter.start();
    posted.length = 0;
    state.time += 0.25;
    state.frame += 60;
    vi.advanceTimersByTime(250);
    expect(payloads()).toEqual([expect.objectContaining({ frame: 300 })]);
  });

  it('ignores small FPS noise when predicted frames still agree', () => {
    reporter.start();
    posted.length = 0;
    state.fps = 60.2;
    state.time += 0.25;
    state.frame += 15;
    vi.advanceTimersByTime(250);
    expect(payloads()).toEqual([]);
  });

  it('reports a resize and a mouse move', () => {
    reporter.start();
    posted.length = 0;

    state.width = 1024;
    vi.advanceTimersByTime(250);
    state.mouse = [10, 20, 1, 0];
    vi.advanceTimersByTime(250);

    expect(payloads()).toEqual([
      expect.objectContaining({ resolution: [1024, 400, 2.56] }),
      expect.objectContaining({ mouse: [10, 20, 1, 0] }),
    ]);
  });

  it('keeps reporting the paused state as time stands still', () => {
    reporter.start();
    state.paused = true;
    reporter.sync();
    posted.length = 0;

    // Let the throttle window drain so the pause itself is reported...
    vi.advanceTimersByTime(50);
    expect(payloads()).toEqual([expect.objectContaining({ paused: true })]);
    posted.length = 0;

    vi.advanceTimersByTime(2000);

    // ...and nothing changes while paused, so nothing needs saying.
    expect(payloads()).toEqual([]);
  });

  it('survives an engine with no canvas yet', () => {
    engine.getCanvas = () => null;

    reporter.start();

    expect(payloads()).toEqual([expect.objectContaining({ resolution: [0, 0, 0] })]);
  });

  it('reports zeros rather than failing on an engine that answers nothing', () => {
    // Engines are swapped and rebuilt around this; a missing accessor must not
    // take the viewer's startup down with it.
    reporter = new ScriptRuntimeReporter({} as any, { postMessage: (m: any) => posted.push(m) } as any);

    reporter.start();

    expect(payloads()).toEqual([{
      paused: false,
      time: 0,
      frame: 0,
      frameRate: 0,
      resolution: [0, 0, 0],
      mouse: [0, 0, 0, 0],
      channelTimes: [0, 0, 0, 0],
      sampleRate: 44100,
    }]);
  });

  it('reports channel times and the audio sample rate', () => {
    engine.getChannelTimes = () => [1.5, 2.5, 0, 0];
    engine.getAudioSampleRate = () => 48000;
    reporter = new ScriptRuntimeReporter(engine, { postMessage: (m: any) => posted.push(m) } as any);

    reporter.start();

    expect(payloads()).toEqual([expect.objectContaining({
      channelTimes: [1.5, 2.5, 0, 0],
      sampleRate: 48000,
    })]);
  });

  it('reports zero channel times and the engines\' own 44100 fallback when asked nothing', () => {
    reporter.start();

    expect(payloads()).toEqual([expect.objectContaining({
      channelTimes: [0, 0, 0, 0],
      sampleRate: 44100,
    })]);
  });

  it('stays quiet while channel times drift within tolerance', () => {
    let channelTimes = [1.0, 0, 0, 0];
    engine.getChannelTimes = () => channelTimes;
    engine.getAudioSampleRate = () => 44100;
    reporter = new ScriptRuntimeReporter(engine, { postMessage: (m: any) => posted.push(m) } as any);
    reporter.start();
    posted.length = 0;

    // Within the 0.25s tolerance: playback drift, not a seek.
    channelTimes = [1.1, 0, 0, 0];
    vi.advanceTimersByTime(250);

    expect(payloads()).toEqual([]);
  });

  it('reports when a channel jumps beyond tolerance', () => {
    let channelTimes = [1.0, 0, 0, 0];
    engine.getChannelTimes = () => channelTimes;
    engine.getAudioSampleRate = () => 44100;
    reporter = new ScriptRuntimeReporter(engine, { postMessage: (m: any) => posted.push(m) } as any);
    reporter.start();
    posted.length = 0;

    channelTimes = [9.0, 0, 0, 0];
    vi.advanceTimersByTime(250);

    expect(payloads()).toEqual([expect.objectContaining({ channelTimes: [9.0, 0, 0, 0] })]);
  });

  it('refreshes sustained media playback within a bounded lag without reporting every sample', () => {
    let channelTime = 1;
    engine.getChannelTimes = () => [channelTime, 0, 0, 0];
    reporter.start();
    posted.length = 0;
    let lastHostTime = channelTime;

    // The host holds channel clocks between reports: unlike shader time, it
    // cannot assume every media channel is playing at wall-clock speed.
    for (let step = 1; step <= 40; step++) {
      channelTime = 1 + step * 0.25;
      state.time = 4 + step * 0.25;
      state.frame = 240 + step * 15;
      vi.advanceTimersByTime(250);
      lastHostTime = payloads().at(-1)?.channelTimes[0] ?? lastHostTime;
      expect(channelTime - lastHostTime).toBeLessThanOrEqual(0.25);
    }

    expect(payloads()).toHaveLength(20);
    expect(payloads().at(-1).channelTimes).toEqual([11, 0, 0, 0]);
  });

  it('reports a media loop or backward seek after sustained playback', () => {
    let channelTime = 10;
    engine.getChannelTimes = () => [0, channelTime, 0, 0];
    reporter.start();
    for (let step = 1; step <= 8; step++) {
      channelTime = 10 + step * 0.25;
      state.time = 4 + step * 0.25;
      state.frame = 240 + step * 15;
      vi.advanceTimersByTime(250);
    }
    posted.length = 0;

    channelTime = 0;
    state.time += 0.25;
    state.frame += 15;
    vi.advanceTimersByTime(250);

    expect(payloads()).toEqual([expect.objectContaining({ channelTimes: [0, 0, 0, 0] })]);
  });

  it('keeps a paused media snapshot quiet, then refreshes when playback resumes', () => {
    let channelTime = 3;
    engine.getChannelTimes = () => [channelTime, 0, 0, 0];
    reporter.start();
    state.paused = true;
    vi.advanceTimersByTime(250);
    posted.length = 0;

    vi.advanceTimersByTime(5000);
    expect(payloads()).toEqual([]);

    state.paused = false;
    channelTime = 3.5;
    state.time += 0.25;
    state.frame += 15;
    vi.advanceTimersByTime(250);
    expect(payloads()).toEqual([expect.objectContaining({
      paused: false, channelTimes: [3.5, 0, 0, 0],
    })]);
  });

  it('reports a sample-rate change even when all clocks are paused', () => {
    let sampleRate = 44100;
    state.paused = true;
    engine.getAudioSampleRate = () => sampleRate;
    reporter.start();
    posted.length = 0;

    sampleRate = 48000;
    vi.advanceTimersByTime(250);
    expect(payloads()).toEqual([expect.objectContaining({ sampleRate: 48000 })]);
    posted.length = 0;
    vi.advanceTimersByTime(5000);
    expect(payloads()).toEqual([]);
  });

  it('throttles a burst of syncs to one report carrying the latest state', () => {
    reporter.start();
    posted.length = 0;

    // Ten mouse samples inside one throttle window: at most one report may
    // go out for the window, and the tail of the burst must not be lost.
    for (let step = 1; step <= 10; step++) {
      state.mouse = [step, 0, 0, 0];
      reporter.sync();
    }
    expect(payloads().length).toBeLessThanOrEqual(1);

    vi.advanceTimersByTime(50);

    const reports = payloads();
    expect(reports.length).toBeLessThanOrEqual(2);
    expect(reports.at(-1)).toEqual(expect.objectContaining({ mouse: [10, 0, 0, 0] }));
  });

  it('does not schedule a flush when a burst changes nothing', () => {
    reporter.start();
    posted.length = 0;

    for (let step = 0; step < 10; step++) {
      reporter.sync();
    }
    // The host advances time itself; track the wall clock so only a real
    // flush could produce a report here.
    for (let step = 1; step <= 4; step++) {
      state.time = 4 + step * 0.25;
      state.frame = 240 + step * 15;
      vi.advanceTimersByTime(250);
    }

    expect(payloads()).toEqual([]);
  });

  it('stops sampling once disposed', () => {
    reporter.start();
    reporter.dispose();
    posted.length = 0;

    state.paused = true;
    vi.advanceTimersByTime(2000);

    expect(payloads()).toEqual([]);
  });
});
