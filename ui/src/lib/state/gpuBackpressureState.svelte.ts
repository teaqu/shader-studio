import { resolveGpuBackpressure, type GpuBackpressureSettings } from "@shader-studio/types";

let defaults = $state(resolveGpuBackpressure());

export function getGpuBackpressureDefaults(): GpuBackpressureSettings {
  return defaults;
}

export function setGpuBackpressureDefaults(value?: Partial<GpuBackpressureSettings>): void {
  defaults = resolveGpuBackpressure(value);
}
