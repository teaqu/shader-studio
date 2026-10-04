
import { ResourceManager } from "../resources/ResourceManager";
import { SlangComputePipeline } from "./SlangComputePipeline";
import {
  SlangPassPipeline
} from "./SlangPassPipeline";
import type { PendingPipelineCandidates } from "./WebGPUCompilationTypes";
import { type WebGPUTextureHandle } from "./WebGPUTextureBackend";

interface WebGPUPipelineCandidatesHost {

  disposed: boolean;
}

/** Owns candidates state and operations; dependencies stay live across compilation swaps. */
export class WebGPUPipelineCandidates {
  constructor(private readonly host: WebGPUPipelineCandidatesHost) {}

  pendingPipelineCandidates = new Set<PendingPipelineCandidates>();

  preparePipelineCandidates(
    generation: number,
    resourceManager: ResourceManager<WebGPUTextureHandle> | null,
  ): PendingPipelineCandidates {
    const candidates: PendingPipelineCandidates = {
      generation,
      render: new Set(),
      compute: new Set(),
      resourceManager,
      resourceLoadsPending: 0,
      resourceManagerDisposed: false,
      installed: false,
      settled: false,
    };
    this.pendingPipelineCandidates.add(candidates);
    return candidates;
  }

  async trackCandidateResourceLoad<T>(
    candidates: PendingPipelineCandidates,
    load: () => Promise<T>,
    resourceManager?: ResourceManager<WebGPUTextureHandle>,
  ): Promise<T> {
    candidates.resourceLoadsPending++;
    try {
      return await load();
    } finally {
      candidates.resourceLoadsPending--;
      if (
        this.host.disposed &&
        candidates.resourceLoadsPending === 0 &&
        resourceManager &&
        candidates.resourceManager !== resourceManager
      ) {
        resourceManager.cleanup();
      }
    }
  }

  registerPipelineCandidate(
    candidates: PendingPipelineCandidates,
    pipeline: SlangPassPipeline | SlangComputePipeline,
  ): boolean {
    if (candidates.settled) {
      try {
        pipeline.dispose();
      } catch {
        // The transaction was already cancelled; disposal is best effort and
        // must not let a late async rebuild reject its superseded compile.
      }
      return false;
    }
    if (pipeline instanceof SlangComputePipeline) {
      candidates.compute.add(pipeline);
    } else {
      candidates.render.add(pipeline);
    }
    return true;
  }

  installPipelineCandidates(candidates: PendingPipelineCandidates): void {
    candidates.installed = true;
    candidates.settled = true;
    candidates.render.clear();
    candidates.compute.clear();
    this.pendingPipelineCandidates.delete(candidates);
  }

  discardPipelineCandidates(candidates: PendingPipelineCandidates): void {
    if (candidates.installed) {
      return;
    }
    if (!candidates.settled) {
      candidates.settled = true;
      this.pendingPipelineCandidates.delete(candidates);
      for (const pipeline of candidates.render) {
        try {
          pipeline.dispose();
        } catch {
          // Best-effort candidate teardown must not mask the compile result or
          // prevent the remaining candidate resources from being released.
        }
      }
      for (const pipeline of candidates.compute) {
        try {
          pipeline.dispose();
        } catch {
          // See render candidate teardown above.
        }
      }
      candidates.render.clear();
      candidates.compute.clear();
    }
    const resourceManager = candidates.resourceManager;
    const shouldDisposeResourceManager = resourceManager && (
      !candidates.resourceManagerDisposed || candidates.resourceLoadsPending === 0
    );
    if (shouldDisposeResourceManager) {
      candidates.resourceManagerDisposed = true;
      try {
        resourceManager.dispose();
      } catch {
        // Candidate cleanup remains best effort for the same reason as pipeline
        // teardown: publication never transferred ownership of this manager.
      }
    }
    if (candidates.resourceLoadsPending === 0) {
      candidates.resourceManager = null;
    }
  }
  dispose(attempt: (cleanup: () => void) => void): void {
    for (const candidates of [...this.pendingPipelineCandidates]) {
      attempt(() => this.discardPipelineCandidates(candidates));
    }
  }

}
