import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/svelte";
import { tooltip } from "../../lib/actions/tooltip";

/**
 * The browser's own `title` tooltips do not reliably appear inside a VS Code
 * webview, so the panel renders its own. Being real DOM, the behaviour can be
 * asserted rather than assumed.
 */
function mount(text = "Explains the control") {
  const button = document.createElement("button");
  document.body.appendChild(button);
  return { button, handle: tooltip(button, text) };
}

function bubble() {
  return document.querySelector(".ss-tooltip");
}

describe("tooltip action", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("carries its text on the element", () => {
    const { button } = mount("Reset the zoom, pan and time window");

    expect(button.getAttribute("data-tooltip")).toBe("Reset the zoom, pan and time window");
  });

  it("appears after hovering, not instantly", async () => {
    const { button } = mount();

    await fireEvent.mouseEnter(button);
    expect(bubble()).toBeNull();

    vi.advanceTimersByTime(400);
    expect(bubble()?.textContent).toBe("Explains the control");
  });

  it("disappears when the pointer leaves", async () => {
    const { button } = mount();

    await fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(400);
    await fireEvent.mouseLeave(button);

    expect(bubble()).toBeNull();
  });

  it("never appears when the pointer leaves before the delay", async () => {
    const { button } = mount();

    await fireEvent.mouseEnter(button);
    await fireEvent.mouseLeave(button);
    vi.advanceTimersByTime(1000);

    expect(bubble()).toBeNull();
  });

  it("appears for keyboard users on focus", async () => {
    const { button } = mount();

    await fireEvent.focus(button);
    vi.advanceTimersByTime(400);

    expect(bubble()).not.toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe(bubble()!.id);
  });

  it("gets out of the way once the control is used", async () => {
    const { button } = mount();

    await fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(400);
    await fireEvent.click(button);

    expect(bubble()).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("follows text that changes, such as pause becoming resume", async () => {
    const { button, handle } = mount("Freeze the graph");

    await fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(400);
    handle.update?.("Resume the live graph");

    expect(bubble()?.textContent).toBe("Resume the live graph");
    expect(button.getAttribute("data-tooltip")).toBe("Resume the live graph");
  });

  it("leaves nothing behind when the control is destroyed", async () => {
    const { button, handle } = mount();

    await fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(400);
    handle.destroy?.();

    expect(bubble()).toBeNull();
  });

  it("keeps the bubble inside the viewport", async () => {
    const { button } = mount();
    button.getBoundingClientRect = () => ({
      top: 10, bottom: 30, left: -50, right: -10, width: 40, height: 20, x: -50, y: 10,
      toJSON: () => {},
    });

    await fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(400);

    expect(Number.parseFloat((bubble() as HTMLElement).style.left)).toBeGreaterThanOrEqual(0);
  });
});
