import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDiagEnabled } from "../../capture/captureDiagnostics";

describe("capture diagnostics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as typeof globalThis & { __captureDiag?: boolean }).__captureDiag;
  });

  it("stays silent in a browser until explicitly enabled", () => {
    vi.stubGlobal("process", undefined);

    expect(captureDiagEnabled()).toBe(false);
  });

  it("can be explicitly enabled in a browser", () => {
    vi.stubGlobal("process", undefined);
    (globalThis as typeof globalThis & { __captureDiag?: boolean }).__captureDiag = true;

    expect(captureDiagEnabled()).toBe(true);
  });
});
