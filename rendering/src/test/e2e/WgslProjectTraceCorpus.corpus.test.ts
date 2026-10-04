import { describe, expect, it } from "vitest";
import type {
  WgslProjectTraceRequest,
  WgslProjectTraceTarget,
  WgslTraceRecording,
} from "@shader-studio/types";
import projects from "virtual:shader-fixture-corpus";
import rawSources from "virtual:wgsl-source-corpus";
import {
  createShaderCanvasHarness,
  type ShaderCanvasHarness,
} from "./ShaderCanvasHarness";

interface WgslProjectTraceEngine {
  getWgslTraceTargets(): WgslProjectTraceTarget[];
  captureWgslProjectTrace(
    request: WgslProjectTraceRequest,
    signal?: AbortSignal,
  ): Promise<WgslTraceRecording>;
  captureWgslProjectReference(
    request: WgslProjectTraceRequest,
    signal?: AbortSignal,
  ): Promise<WgslTraceRecording>;
}

const REGION_SIZE = 60;

function traceEngine(harness: ShaderCanvasHarness): WgslProjectTraceEngine {
  return harness.engine as typeof harness.engine & WgslProjectTraceEngine;
}

function sourceForTarget(
  project: (typeof projects)[number],
  target: WgslProjectTraceTarget,
): string | undefined {
  if (target.path === project.path) {
    return project.image;
  }
  const paths = project.slangSourcePaths ?? {};
  const key = Object.entries(paths).find(
    ([, path]) => path === target.path,
  )?.[0];
  return key === undefined ? undefined : project.buffers?.[key];
}

function sourcePaths(project: (typeof projects)[number]): Map<string, string> {
  const result = new Map<string, string>();
  if (project.path) {
    result.set(project.path, project.image);
  }
  for (const [key, path] of Object.entries(project.slangSourcePaths ?? {})) {
    const source = project.buffers?.[key];
    if (source !== undefined) {
      result.set(path, source);
    }
  }
  return result;
}

function renderedPixel(
  region: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number] {
  const originX = Math.floor(width / 2) - REGION_SIZE / 2;
  const originY = Math.floor(height / 2) - REGION_SIZE / 2;
  for (let y = 0; y < REGION_SIZE; y += 1) {
    for (let x = 0; x < REGION_SIZE; x += 1) {
      const offset = (y * REGION_SIZE + x) * 4;
      if (
        region[offset] !== 0 ||
        region[offset + 1] !== 0 ||
        region[offset + 2] !== 0
      ) {
        const pixel: [number, number] = [originX + x, originY + y];
        if (
          pixel[0] >= 0 &&
          pixel[0] < width &&
          pixel[1] >= 0 &&
          pixel[1] < height
        ) {
          return pixel;
        }
      }
    }
  }
  return [
    Math.max(0, Math.floor(width / 2)),
    Math.max(0, Math.floor(height / 2)),
  ];
}

function renderedColor(
  region: Uint8ClampedArray,
  width: number,
  height: number,
  pixel: [number, number],
): number[] | undefined {
  const x = pixel[0] - (Math.floor(width / 2) - REGION_SIZE / 2);
  const y = pixel[1] - (Math.floor(height / 2) - REGION_SIZE / 2);
  if (x < 0 || x >= REGION_SIZE || y < 0 || y >= REGION_SIZE) {
    return undefined;
  }
  const offset = (y * REGION_SIZE + x) * 4;
  return Array.from(region.slice(offset, offset + 4), (value) => value / 255);
}

function renderTime(project: (typeof projects)[number]): number {
  const hasSpatialGeometry = Object.values(project.config?.passes ?? {}).some(
    (pass) =>
      pass &&
      "geometry" in pass &&
      pass.geometry?.type &&
      pass.geometry.type !== "fullscreen",
  );
  return hasSpatialGeometry ||
    /(?:two-meshes|fullscreen-vertex)/.test(project.name)
    ? 1
    : 0;
}

function canCompareImageToLive(project: (typeof projects)[number]): boolean {
  const passes = project.config?.passes ?? {};
  const image = passes.Image;
  const imageUsesBuffer = Object.values(image?.inputs ?? {}).some(
    (input) => input.type === "buffer",
  );
  const hasAuxiliaryPass = Object.entries(passes).some(
    ([name, pass]) => name !== "Image" && name !== "common" && pass !== undefined,
  );
  const usesGeometryOrVertex = Boolean(image?.vertex) ||
    (image?.geometry?.type !== undefined && image.geometry.type !== "fullscreen");
  return !imageUsesBuffer && !hasAuxiliaryPass && !project.config?.storage && !usesGeometryOrVertex;
}

function requestFor(
  target: WgslProjectTraceTarget,
  imagePixel: [number, number],
): WgslProjectTraceRequest {
  const pixel: [number, number] =
    target.passName === "Image" && target.stage === "fragment"
      ? imagePixel
      : [Math.floor(target.width / 2), Math.floor(target.height / 2)];
  return {
    passName: target.passName,
    stage: target.stage,
    pixel,
    ...(target.stage === "compute"
      ? { invocation: [0, 0, 0] as [number, number, number] }
      : {}),
    ...(target.stage === "vertex" ? { vertexIndex: 0 } : {}),
    capacity: 4096,
  };
}

function storageSnapshot(
  harness: ShaderCanvasHarness,
  project: (typeof projects)[number],
) {
  return Promise.all(
    Object.entries(project.config?.storage ?? {}).map(
      async ([name, storage]) => {
        const snapshot = await harness.engine.readStorageBuffer(
          name,
          0,
          storage.count,
        );
        return [name, new Uint8Array(snapshot.data)] as const;
      },
    ),
  );
}

function expectNumbersEqual(
  actual: readonly number[],
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    const observed = actual[index]!;
    const baseline = expected[index]!;
    if (!Number.isFinite(observed) || !Number.isFinite(baseline)) {
      expect(Object.is(observed, baseline)).toBe(true);
    } else {
      expect(observed).toBeCloseTo(baseline, 5);
    }
  }
}

function expectTraceMatchesReference(
  trace: WgslTraceRecording,
  reference: WgslTraceRecording,
): void {
  expectNumbersEqual(trace.color, reference.color);
  expect(trace.storage).toEqual(reference.storage);
}

describe("WGSL project trace: configured corpus", () => {
  it(
    "discovers every configured project pass and vertex hook",
    { timeout: 120_000 },
    async () => {
      const wgslProjects = projects.filter(
        (project) => project.language === "wgsl",
      );
      const rawBySource = new Map(rawSources.map((source) => [source.source, source.name]));
      expect(wgslProjects).toHaveLength(45);
      expect(rawSources).toHaveLength(93);
      expect(rawSources.filter((source) => /\bfn\s+mainImage\b/.test(source.source))).toHaveLength(58);
      expect(rawSources.filter((source) => /@compute\b/.test(source.source))).toHaveLength(23);
      expect(rawSources.filter((source) => /\bfn\s+mainVertex\b/.test(source.source))).toHaveLength(6);
      expect(rawSources.filter((source) => !/\bfn\s+(mainImage|mainVertex)\b|@compute\b/.test(source.source))).toHaveLength(6);
      let configuredPasses = 0;
      let vertexHooks = 0;
      const targetSources = new Set<string>();
      const computeEntries = new Set<string>();
      for (const project of wgslProjects) {
        const harness = createShaderCanvasHarness("wgsl");
        try {
          harness.resize(64, 64);
          await harness.compile(project);
          const targets = traceEngine(harness).getWgslTraceTargets();
          const passCount = Object.keys(project.config?.passes ?? {}).filter(
            (name) => name !== "common",
          ).length;
          const vertexCount = Object.values(
            project.config?.passes ?? {},
          ).filter((pass) => pass && "vertex" in pass && pass.vertex).length;
          expect(targets).toHaveLength(passCount + vertexCount);
          expect(
            targets
              .map((target) => `${target.passName}:${target.stage}`)
              .sort(),
          ).toEqual(
            [
              ...Object.entries(project.config?.passes ?? {})
                .filter(([name]) => name !== "common")
                .map(
                  ([name, pass]) =>
                    `${name}:${pass?.type === "compute" ? "compute" : "fragment"}`,
                ),
              ...Object.entries(project.config?.passes ?? {})
                .filter(
                  ([, pass]) =>
                    pass && "vertex" in pass && Boolean(pass.vertex),
                )
                .map(([name]) => `${name}:vertex`),
            ].sort(),
          );
          configuredPasses += passCount;
          vertexHooks += vertexCount;
          for (const target of targets) {
            targetSources.add(target.source);
            if (target.stage === "compute") {
              expect(target.entryPoint).toBeDefined();
              expect(target.source).toMatch(new RegExp(`\\bfn\\s+${target.entryPoint}\\b`));
              computeEntries.add(`${rawBySource.get(target.source)}:${target.entryPoint}`);
            }
          }
        } finally {
          harness.dispose();
        }
      }
      expect(configuredPasses).toBe(87);
      expect(vertexHooks).toBe(6);
      expect(targetSources.size).toBe(85);
      expect(computeEntries.size).toBe(27);
      expect(rawSources.filter((source) => !targetSources.has(source.source)).map((source) => source.name).sort()).toEqual([
        "wgsl/common.wgsl",
        "wgsl/feature-coverage.common.wgsl",
        "wgsl/foundation/debugging/common.wgsl",
        "wgsl/foundation/workspace/common.wgsl",
        "wgsl/gravity/common.wgsl",
        "wgsl/parity/pixel-inspector/gradient.wgsl",
        "wgsl/shadertoy.wgsl",
        "wgsl/structs/common.wgsl",
      ]);
    },
  );

  for (const project of projects.filter(
    (project) => project.language === "wgsl",
  )) {
    it(project.name, { timeout: 120_000 }, async () => {
      const harness = createShaderCanvasHarness("wgsl");
      try {
        harness.resize(64, 64);
        await harness.compile(project);
        const region = await harness.renderAndReadRegion(renderTime(project));
        const engine = traceEngine(harness);
        const targets = engine.getWgslTraceTargets();
        const paths = sourcePaths(project);
        const imageTarget = targets.find(
          (target) =>
            target.passName === "Image" && target.stage === "fragment",
        );
        expect(imageTarget).toBeDefined();
        const imagePixel = renderedPixel(
          region,
          imageTarget!.width,
          imageTarget!.height,
        );
        const before = await storageSnapshot(harness, project);

        for (const target of targets) {
          expect(sourceForTarget(project, target)).toBe(target.source);
          const request = requestFor(target, imagePixel);
          const reference = await engine.captureWgslProjectReference(request);
          const recording = await engine.captureWgslProjectTrace(request);
          expectTraceMatchesReference(recording, reference);
        if (target.passName === "Image" && target.stage === "fragment" && canCompareImageToLive(project)) {
            const liveColor = renderedColor(
              region,
              imageTarget!.width,
              imageTarget!.height,
              imagePixel,
            );
            expect(liveColor).toBeDefined();
            // Canvas readback is rgba8 while the clone is rgba32float; this is
            // intentionally a display-equivalence check, not an exact float bit test.
            for (let channel = 0; channel < 4; channel += 1) {
              expect(reference.color[channel]!).toBeCloseTo(
                liveColor![channel]!,
                2,
              );
            }
          }
          expect(recording.path).toBe(target.path);
          expect(recording.source).toBe(target.source);
          expect(recording.sources).toBeDefined();
          for (const source of recording.sources!) {
            expect(
              paths.get(source.path),
              `unknown source path ${source.path}`,
            ).toBe(source.source);
          }
          const commonPath = project.slangSourcePaths?.common;
          if (commonPath) {
            expect(
              recording.sources!.some((source) => source.path === commonPath),
            ).toBe(true);
          }
          expect(recording.sites.length).toBeGreaterThan(0);
          expect(
            recording.events.length,
            `${target.passName}:${target.stage} did not hit a trace site`,
          ).toBeGreaterThan(0);
          for (const event of recording.events) {
            const site = recording.sites.find(
              (candidate) => candidate.id === event.siteId,
            );
            expect(site).toBeDefined();
            expect(event.line).toBe(site!.line);
            expect(event.column).toBe(site!.column);
            expect(site!.path).toBeDefined();
            const source = paths.get(site!.path!);
            expect(source, `unknown source path ${site!.path}`).toBeDefined();
            expect(site!.line).toBeGreaterThan(0);
            expect(site!.line).toBeLessThanOrEqual(source!.split("\n").length);
          }
        }

        const after = await storageSnapshot(harness, project);
        expect(after.map(([name, data]) => [name, [...data]])).toEqual(
          before.map(([name, data]) => [name, [...data]]),
        );
      } finally {
        harness.dispose();
      }
    });
  }

  it(
    "keeps fragment and storage-compute output when the event budget is exhausted",
    { timeout: 120_000 },
    async () => {
      const selected = [
        projects.find((project) => project.name === "wgsl/flow.wgsl"),
        projects.find(
          (project) => project.name === "wgsl/compute-lab/game-of-life.wgsl",
        ),
      ];
      for (const project of selected) {
        expect(project).toBeDefined();
        const harness = createShaderCanvasHarness("wgsl");
        try {
          harness.resize(64, 64);
          await harness.compile(project!);
          const region = await harness.renderAndReadRegion(
            renderTime(project!),
          );
          const engine = traceEngine(harness);
          const target =
            engine
              .getWgslTraceTargets()
              .find((candidate) => candidate.stage === "compute") ??
            engine
              .getWgslTraceTargets()
              .find(
                (candidate) =>
                  candidate.passName === "Image" &&
                  candidate.stage === "fragment",
              );
          expect(target).toBeDefined();
          const image = engine
            .getWgslTraceTargets()
            .find(
              (candidate) =>
                candidate.passName === "Image" &&
                candidate.stage === "fragment",
            )!;
          const pixel = renderedPixel(region, image.width, image.height);
          const request = { ...requestFor(target!, pixel), capacity: 1 };
          const reference = await engine.captureWgslProjectReference(request);
          const trace = await engine.captureWgslProjectTrace(request);
          expectTraceMatchesReference(trace, reference);
          expect(trace.events).toHaveLength(1);
          expect(trace.overflow).toBe(true);
        } finally {
          harness.dispose();
        }
      }
    },
  );
});
