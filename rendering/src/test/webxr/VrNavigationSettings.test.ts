import { describe, expect, it } from "vitest";
import { DEFAULT_VR_NAVIGATION, normalizeVrNavigation } from "../../webxr/VrNavigationSettings";

describe("VR navigation settings", () => {
  it("keeps navigation opt-in and returns independent defaults", () => {
    expect(normalizeVrNavigation(null)).toEqual(DEFAULT_VR_NAVIGATION);
    expect(normalizeVrNavigation(undefined)).toEqual(DEFAULT_VR_NAVIGATION);
    const changed = normalizeVrNavigation({});
    changed.movement = true;
    expect(DEFAULT_VR_NAVIGATION.movement).toBe(false);
  });
  it("validates and bounds restored preferences", () => {
    expect(normalizeVrNavigation({ movement: true, movementSpeed: 100, turning: "smooth", snapAngle: 0, turnSpeed: Infinity }))
      .toEqual({ movement: true, movementSpeed: 10, turning: "smooth", snapAngle: 15, turnSpeed: 90 });
    expect(normalizeVrNavigation({ movementSpeed: NaN, turning: "snap", snapAngle: 200, turnSpeed: 0 }))
      .toEqual({ movement: false, movementSpeed: 2, turning: "snap", snapAngle: 90, turnSpeed: 15 });
  });
});
