import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RenderingSettings from "../../../lib/components/config/RenderingSettings.svelte";
import { setGpuBackpressureDefaults } from "../../../lib/state/gpuBackpressureState.svelte";

describe("Rendering settings", () => {
  beforeEach(() => setGpuBackpressureDefaults());

  it("shows inherited values and updates them when global defaults change", async () => {
    const view = render(RenderingSettings, { onUpdate: vi.fn() });
    expect(view.getByLabelText("Frames in flight")).toBeDisabled();
    expect(view.getByLabelText("Stall timeout")).toHaveValue(2000);
    setGpuBackpressureDefaults({ framesInFlight: 4, stallTimeoutMs: 500 });
    await tick();
    expect(view.getByLabelText("Frames in flight")).toHaveValue(4);
    expect(view.getByLabelText("Stall timeout")).toHaveValue(500);
  });

  it("creates and removes overrides independently", async () => {
    const onUpdate = vi.fn();
    const view = render(RenderingSettings, { settings: { framesInFlight: 1 }, onUpdate });
    expect(view.getByLabelText("Frames in flight")).toBeEnabled();
    await fireEvent.input(view.getByLabelText("Frames in flight"), { target: { value: "3" } });
    expect(onUpdate).toHaveBeenLastCalledWith({ framesInFlight: 3 });
    await fireEvent.click(view.getByRole("checkbox", { name: /for stall timeout/ }));
    expect(onUpdate).toHaveBeenLastCalledWith({ framesInFlight: 1, stallTimeoutMs: 2000 });
    await fireEvent.click(view.getByRole("checkbox", { name: /for frames in flight/ }));
    expect(onUpdate).toHaveBeenLastCalledWith(undefined);
  });

  it.each(["0", "-1", "1.5", "", "9007199254740992"])("does not persist invalid input %s", async value => {
    const onUpdate = vi.fn();
    const view = render(RenderingSettings, { settings: { framesInFlight: 1 }, onUpdate });
    await fireEvent.input(view.getByLabelText("Frames in flight"), { target: { value } });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(view.getByRole("alert")).toBeInTheDocument();
    await fireEvent.input(view.getByLabelText("Frames in flight"), { target: { value: "2" } });
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
    expect(onUpdate).toHaveBeenLastCalledWith({ framesInFlight: 2 });
  });
});
