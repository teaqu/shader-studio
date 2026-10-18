export interface VrNavigationSettings {
  movement: boolean;
  movementSpeed: number;
  turning: "snap" | "smooth";
  snapAngle: number;
  turnSpeed: number;
}

export const DEFAULT_VR_NAVIGATION: Readonly<VrNavigationSettings> = Object.freeze({
  movement: false, movementSpeed: 2, turning: "snap", snapAngle: 30, turnSpeed: 90,
});

/** Storage and host messages are untrusted; invalid values fall back to safe defaults. */
export function normalizeVrNavigation(value: Partial<VrNavigationSettings> | null | undefined): VrNavigationSettings {
  const bounded = (input: unknown, fallback: number, min: number, max: number) =>
    typeof input === "number" && Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : fallback;
  return {
    movement: value?.movement === true,
    movementSpeed: bounded(value?.movementSpeed, 2, 0.1, 10),
    turning: value?.turning === "smooth" ? "smooth" : "snap",
    snapAngle: bounded(value?.snapAngle, 30, 15, 90),
    turnSpeed: bounded(value?.turnSpeed, 90, 15, 180),
  };
}
