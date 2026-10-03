import type { ConfigInput } from "@shader-studio/types";

// Runtime identities only: the persisted config retains the pathless device type.
export const WEBCAM_PATH = "shader-studio-live://webcam";
export const MICROPHONE_PATH = "shader-studio-live://microphone";

/** Reuse media binding, channel metadata and sampler handling in both engines. */
export function normalizeLiveInput(input: ConfigInput): ConfigInput {
  if (input.type === "webcam") {
    return { ...input, type: "video", path: WEBCAM_PATH, muted: true };
  }
  if (input.type === "microphone") {
    return { type: "audio", path: MICROPHONE_PATH, muted: true };
  }
  return input;
}

export function normalizeLiveInputs(inputs: Record<string, ConfigInput>): Record<string, ConfigInput> {
  return Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, normalizeLiveInput(input)]));
}

/** Keep file-media warnings stable while preserving device permission guidance. */
export function audioLoadWarning(path: string, error: unknown): string {
  return path === MICROPHONE_PATH && error instanceof Error ? error.message : `Audio loading failed: ${path}`;
}

export function liveInputPaths(passInputs: Record<string, ConfigInput>[]): Set<string> {
  const paths = new Set<string>();
  for (const inputs of passInputs) {
    for (const input of Object.values(inputs)) {
      if (input.type === "video" && input.path === WEBCAM_PATH ||
          input.type === "audio" && input.path === MICROPHONE_PATH) {
        paths.add(input.path);
      }
    }
  }
  return paths;
}
