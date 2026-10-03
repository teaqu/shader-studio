
import {
  type RenderPassNode
} from "./SlangPassGraph";
import type { PassTiming,SlangAssetUrls } from "./WebGPUCompilationTypes";

interface WebGPUCompileDiagnosticsHost {

  slangAssets?: SlangAssetUrls;
}

/** Owns diagnostics state and operations; dependencies stay live across compilation swaps. */
export class WebGPUCompileDiagnostics {
  constructor(private readonly host: WebGPUCompileDiagnosticsHost) {}

  logCompileTiming(
    status: "success" | "failed" | "superseded",
    details: {
      path: string;
      generation: number;
      startedAt: number;
      readyMs: number;
      graphMs: number;
      passTimings: PassTiming[];
      graph: { passes: RenderPassNode[]; warnings: string[] };
      errors: string[];
    },
  ): void {
    const totalMs = this.ms(this.now() - details.startedAt);
    const cacheHits = details.passTimings.filter((pass) => pass.cacheHit).length;
    const passSummary = details.passTimings
      .map((pass) => {
        if (pass.cacheHit) {
          return `${pass.name}:cache ${pass.totalMs ?? 0}ms`;
        }
        const pieces = [`${pass.name}:compile ${pass.totalMs ?? 0}ms`];
        if (pass.wgslCacheHit) {
          pieces.push("wgsl-cache");
        } else if (pass.slangMs !== undefined) {
          pieces.push(`slang ${pass.slangMs}ms`);
        }
        if (pass.pipelineMs !== undefined) {
          pieces.push(`pipeline ${pass.pipelineMs}ms`);
        }
        if (pass.errorCount !== undefined && pass.errorCount > 0) {
          pieces.push(`errors ${pass.errorCount}`);
        }
        return pieces.join(" ");
      })
      .join(" | ");
    const readyMs = this.ms(details.readyMs);
    const compileWorkMs = this.ms(Math.max(0, totalMs - details.readyMs));
    this.logSlangPerf("compile", {
      status,
      path: details.path,
      generation: details.generation,
      totalMs,
      readyMs,
      compileWorkMs,
      graphMs: this.ms(details.graphMs),
      passCount: details.graph.passes.length,
      cacheHits,
      compiledPasses: details.passTimings
        .filter((pass) => !pass.cacheHit)
        .map((pass) => pass.name),
      passSummary,
      passes: details.passTimings,
      warningCount: details.graph.warnings.length,
      errorCount: details.errors.length,
    });
    if (this.host.slangAssets?.debugTimings) {
      console.log(
        "[SlangPerf] compile summary",
        `${status} ${details.path} total=${totalMs}ms ready=${readyMs}ms work=${compileWorkMs}ms passes=${details.graph.passes.length} cacheHits=${cacheHits} :: ${passSummary}`,
      );
    }
  }

  logSlangPerf(event: string, data: Record<string, unknown>): void {
    if (this.host.slangAssets?.debugTimings) {
      console.log(`[SlangPerf] ${event}`, data);
    }
  }

  now(): number {
    return performance.now();
  }

  ms(value: number): number {
    return Number(value.toFixed(2));
  }
}
