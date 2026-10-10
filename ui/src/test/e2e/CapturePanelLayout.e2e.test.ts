import { afterEach, describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
// Types for cdp().send() come from the Playwright browser provider.
import type {} from "@vitest/browser-playwright";
import { flushSync, mount, unmount } from "svelte";
import RecordingPanel from "../../lib/components/recording/RecordingPanel.svelte";
import { recordingStore } from "../../lib/stores/recordingStore";
import { resetCapturePreferences } from "../../lib/state/capturePreferences.svelte";

// Real browser layout of the capture panel in narrow hosts (#36): phone
// widths and narrow VS Code panels. Boxes are measured, not snapshotted.

function button(root: HTMLElement, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((element) => element.textContent?.trim() === name);
  if (!found) {
    throw new Error(`no button "${name}"`);
  }
  return found;
}

function click(root: HTMLElement, name: string) {
  button(root, name).click();
  flushSync();
}

describe.each([320, 390])("capture panel at %i px", (width) => {
  let host: HTMLDivElement;
  let panel: ReturnType<typeof mount> | null = null;

  function render() {
    resetCapturePreferences();
    recordingStore.reset();
    host = document.createElement("div");
    host.style.width = `${width}px`;
    host.style.height = "900px";
    document.body.appendChild(host);
    panel = mount(RecordingPanel, {
      target: host,
      props: {
        canvasWidth: 640,
        canvasHeight: 360,
        displayFrameRate: 60,
        onScreenshot: () => {},
        onRecord: () => {},
        onCancel: () => {},
        onStopLive: () => {},
      },
    });
    flushSync();
  }

  afterEach(() => {
    if (panel) {
      unmount(panel);
      panel = null;
    }
    recordingStore.reset();
    host.remove();
  });

  it("keeps Render video settings readable without horizontal overflow", () => {
    render();
    click(host, "Video");
    click(host, "Render");

    const scroller = host.querySelector<HTMLElement>(".recording-tab-content") ?? host;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);

    // Custom width × height stays on one row.
    const [customWidth, customHeight] = host.querySelectorAll<HTMLElement>(".recording-custom-res-input");
    expect(Math.abs(customWidth.getBoundingClientRect().top - customHeight.getBoundingClientRect().top)).toBeLessThan(2);
    expect(customHeight.getBoundingClientRect().right).toBeLessThanOrEqual(host.getBoundingClientRect().right + 1);

    // The preceding-frames helper sits directly below the start time input.
    const startSection = [...host.querySelectorAll<HTMLElement>(".resolution-section")]
      .find((section) => section.textContent?.includes("Start recording at"))!;
    const input = startSection.querySelector("input")!.getBoundingClientRect();
    const helper = [...startSection.querySelectorAll<HTMLElement>("p")]
      .find((p) => p.textContent?.includes("Renders preceding frames"))!.getBoundingClientRect();
    expect(helper.top).toBeGreaterThanOrEqual(input.bottom - 1);
    expect(helper.top - input.bottom).toBeLessThan(24);

    // The main action is inside the panel and a usable size.
    const action = button(host, "Render video").getBoundingClientRect();
    expect(action.left).toBeGreaterThanOrEqual(host.getBoundingClientRect().left - 1);
    expect(action.right).toBeLessThanOrEqual(host.getBoundingClientRect().right + 1);
  });

  it("keeps Discard and Stop & save together on one row while Live recording", () => {
    render();
    recordingStore.startLiveRecording("webm");
    flushSync();

    const discard = button(host, "Discard").getBoundingClientRect();
    const stop = button(host, "Stop & save").getBoundingClientRect();
    expect(Math.abs(discard.top - stop.top)).toBeLessThan(2);
    expect(stop.right).toBeLessThanOrEqual(host.getBoundingClientRect().right + 1);
    expect(host.querySelector(".recording-preview")).toBeNull();
  });

  it("gives touch users 44 px targets and zoom-safe inputs", async () => {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp().send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
    try {
      expect(matchMedia("(pointer: coarse)").matches).toBe(true);
      render();
      click(host, "Video");
      click(host, "Render");

      for (const name of ["Live", "Render", "Render video"]) {
        expect(button(host, name).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
      const input = host.querySelector<HTMLInputElement>(".recording-custom-res-input")!;
      expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);
      const scroller = host.querySelector<HTMLElement>(".recording-tab-content") ?? host;
      expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
    } finally {
      await cdp().send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
      await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
    }
  });
});
