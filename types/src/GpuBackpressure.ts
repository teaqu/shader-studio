/** Limits apply to a complete shader frame, including all buffer/compute passes. */
export interface GpuBackpressureSettings {
  framesInFlight: number;
  stallTimeoutMs: number;
}

export const DEFAULT_GPU_BACKPRESSURE: Readonly<GpuBackpressureSettings> = {
  framesInFlight: 2,
  stallTimeoutMs: 2000,
};

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function resolveGpuBackpressure(
  defaults?: Partial<GpuBackpressureSettings>,
  overrides?: Partial<GpuBackpressureSettings>,
): GpuBackpressureSettings {
  const resolve = (key: keyof GpuBackpressureSettings): number =>
    isPositiveInteger(overrides?.[key]) ? overrides[key] :
      isPositiveInteger(defaults?.[key]) ? defaults[key] : DEFAULT_GPU_BACKPRESSURE[key];
  return { framesInFlight: resolve("framesInFlight"), stallTimeoutMs: resolve("stallTimeoutMs") };
}
