import { describe, expect, it } from "vitest";
import { nativeAuthoringMetadata } from "../../lib/editor/nativeAuthoringMetadata";

describe("nativeAuthoringMetadata", () => {
  it("enables writable storage for a Slang module with a native compute entry point", () => {
    expect(nativeAuthoringMetadata('[shader("compute")] [numthreads(8, 8, 1)] void simulate(uint3 id : SV_DispatchThreadID) {}', "slang"))
      .toEqual({ storageWritable: true });
  });

  it("does not enable writable storage for render-only Slang or WGSL compute source", () => {
    expect(nativeAuthoringMetadata('[shader("fragment")] float4 image() : SV_Target { return 0; }', "slang")).toEqual({});
    expect(nativeAuthoringMetadata('@compute @workgroup_size(8) fn simulate() {}', "wgsl")).toEqual({});
  });
});
