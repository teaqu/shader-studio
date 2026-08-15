export interface SlangComputeFeature {
  readonly name: string;
  readonly kind: "attribute" | "semantic";
  readonly syntax: string;
  readonly description: string;
}

function feature(
  name: string,
  kind: SlangComputeFeature["kind"],
  syntax: string,
  description: string,
): SlangComputeFeature {
  return Object.freeze({ name, kind, syntax, description });
}

/** Slang compute entry-point features used by Shader Studio. */
export const SLANG_COMPUTE_FEATURES: readonly SlangComputeFeature[] = Object.freeze([
  feature("shader", "attribute", "[shader(\"compute\")]", "Marks a function as a compute-shader entry point."),
  feature("numthreads", "attribute", "[numthreads(x, y, z)]", "Sets the number of threads in each compute workgroup."),
  feature("SV_DispatchThreadID", "semantic", "uint3 value : SV_DispatchThreadID", "Global dispatch thread index across all workgroups."),
  feature("SV_GroupID", "semantic", "uint3 value : SV_GroupID", "Workgroup index within the dispatch."),
  feature("SV_GroupThreadID", "semantic", "uint3 value : SV_GroupThreadID", "Local thread index within its workgroup."),
  feature("SV_GroupIndex", "semantic", "uint value : SV_GroupIndex", "Flattened local thread index within its workgroup."),
].sort((left, right) => left.name.localeCompare(right.name)));
