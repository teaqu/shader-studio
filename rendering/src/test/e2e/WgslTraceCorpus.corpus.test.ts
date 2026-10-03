import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WgslTraceLaunch } from '@shader-studio/types';
import sources from 'virtual:wgsl-source-corpus';
import { captureWgslTrace } from '../../trace/WgslTraceCapture';
import { expectedTraceRefusals, supportedTraceSources, traceLaunchInputs } from './WgslTraceCorpusExpectations';
import { renderWgslTraceReference } from './WgslTraceReference';

const samples = [
  { pixel: [0, 0], time: 0, frame: 0 },
  { pixel: [8, 8], time: 0.75, frame: 3 },
  { pixel: [15, 15], time: 1.25, frame: 7 },
] as const;

describe('WGSL trace: every corpus source', () => {
  let device: GPUDevice;
  beforeAll(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    expect(adapter).toBeTruthy();
    device = await adapter!.requestDevice();
  });
  afterAll(() => device?.destroy());

  it('accounts for all roots and auxiliary sources without silently skipping new fixtures', () => {
    const classified = [...supportedTraceSources, ...expectedTraceRefusals.keys()];
    expect(new Set(classified).size).toBe(classified.length);
    expect(classified.sort()).toEqual(sources.map(fixture => fixture.name).sort());
    expect(supportedTraceSources.size).toBe(12);
    expect(expectedTraceRefusals.size).toBe(81);
  });

  for (const fixture of sources) {
    it(fixture.name, async () => {
      const launch: WgslTraceLaunch = { source: fixture.source, path: fixture.name,
        width: 16, height: 16, pixel: [8, 8], time: 0, frame: 0, capacity: 4096, ...traceLaunchInputs[fixture.name] };
      const refusal = expectedTraceRefusals.get(fixture.name);
      if (refusal) {
        await expect(captureWgslTrace(launch)).rejects.toThrow(refusal);
        return;
      }
      expect(supportedTraceSources.has(fixture.name)).toBe(true);
      for (const sample of samples) {
        const input = { ...launch, ...sample, pixel: [...sample.pixel] as [number, number] };
        const reference = await renderWgslTraceReference(device, input);
        const recording = await captureWgslTrace(input);
        expect(recording.source).toBe(fixture.source);
        expect(recording.overflow).toBe(false);
        // The current positive fixtures have straight-line mainImage bodies.
        expect(recording.events.map(event => event.siteId)).toEqual(recording.sites.map(site => site.id));
        for (const event of recording.events) {
          const site = recording.sites.find(site => site.id === event.siteId)!;
          expect(event.line).toBe(site.line);
          expect(event.values.map(value => value.name)).toEqual([...site.variables, ...(site.unavailableVariables ?? [])].map(value => value.name));
          const coord = event.values.find(value => value.name === 'coord');
          const expectedCoord = [sample.pixel[0] + 0.5, input.height - sample.pixel[1] - 0.5];
          expect(coord?.value).toEqual(expectedCoord);
          const uv = event.values.find(value => value.name === 'uv');
          if (uv) {
            expect(uv.value).toEqual(expectedCoord.map(value => value / 16));
          }
        }
        recording.color.forEach((value, channel) => expect(value).toBeCloseTo(reference[channel], 5));
      }
      const full = await captureWgslTrace(launch);
      const overflow = await captureWgslTrace({ ...launch, capacity: 1 });
      expect(overflow.events).toEqual(full.events.slice(0, 1));
      expect(overflow.overflow).toBe(full.events.length > 1);
      const reference = await renderWgslTraceReference(device, launch);
      overflow.color.forEach((value, channel) => expect(value).toBeCloseTo(reference[channel], 5));
    });
  }
});
