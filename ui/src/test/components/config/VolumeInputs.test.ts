import type { ConfigInput } from "@shader-studio/types";
import VolumeTab from "../../../lib/components/config/tabs/VolumeTab.svelte";
import { ktxVolume } from "../../../../../types/test/ktxVolume";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import ChannelConfigModal from "../../../lib/components/config/ChannelConfigModal.svelte";
import VolumePreview from "../../../lib/components/config/VolumePreview.svelte";

const gpu = vi.hoisted(() => ({ draw: vi.fn(), dispose: vi.fn(), error: undefined as unknown }));
vi.mock("../../../lib/util/VolumePreviewRenderer", () => ({
  VolumePreviewRenderer: class {
    constructor() {
      if (gpu.error !== undefined) {
        throw gpu.error;
      }
    }
    draw = gpu.draw; dispose = gpu.dispose;
  }
}));

function asset() {
  return ktxVolume();
}

afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); gpu.error = undefined;
});
describe("volume configuration", () => {
  it("selects volumes, saves paths and sampler options, and restores the tab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => asset() })));
    const onSave = vi.fn();
    const props = { channelInput: undefined, isOpen: true, channelName: "iChannel0", getWebviewUri: () => undefined, onClose: vi.fn(), onRemove: vi.fn(), onSave };
    const component = render(ChannelConfigModal, props);
    await fireEvent.click(screen.getByRole("tab", { name: "Volumes" }));
    expect(onSave).toHaveBeenLastCalledWith("iChannel0", { type: "volume", path: "" });
    await fireEvent.input(screen.getByPlaceholderText("Path to volume .ktx2 file"), { target: { value: "./density.ktx2" } });
    await fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "nearest" } });
    await fireEvent.change(screen.getByLabelText("Wrap X / Y / Z"), { target: { value: "clamp" } });
    const saved = onSave.mock.calls.at(-1)![1];
    expect(saved).toEqual({ type: "volume", path: "./density.ktx2", filter: "nearest", wrap: "clamp" });
    expect(screen.queryByRole("option", { name: "Mipmap" })).toBeNull();
    await component.rerender({ ...props, isOpen: false });
    await component.rerender({ ...props, channelInput: saved });
    expect(screen.getByRole("tab", { name: "Volumes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Filter")).toHaveValue("nearest");
    expect(screen.getByLabelText("Wrap X / Y / Z")).toHaveValue("clamp");
  });
  it("shows dimensions and previews slice changes on every axis", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => asset() })));
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ putImageData })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    render(VolumePreview, { path: "volume.ktx2", controls: true });
    await screen.findByText("2 × 3 × 4 · R8");
    await fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    await waitFor(() => expect(putImageData).toHaveBeenCalled());
    const pixels = () => Array.from(putImageData.mock.calls.at(-1)![0].data as Uint8Array).filter((_, i) => i % 4 === 0);
    expect(pixels()).toEqual([0, 1, 2, 3, 4, 5]);
    await fireEvent.input(screen.getByRole("slider"), { target: { value: "2" } });
    expect(pixels()).toEqual([12, 13, 14, 15, 16, 17]);
    await fireEvent.change(screen.getByLabelText("Slice axis"), { target: { value: "x" } });
    expect(pixels()).toEqual([0, 6, 12, 18, 2, 8, 14, 20, 4, 10, 16, 22]);
    await fireEvent.change(screen.getByLabelText("Slice axis"), { target: { value: "y" } });
    expect(pixels()).toEqual([0, 1, 6, 7, 12, 13, 18, 19]);
    vi.restoreAllMocks();
  });
  it("opens a 3D view with rotation and zoom controls and switches back to slices", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => asset() })));
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ putImageData })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    try {
      render(VolumePreview, { path: "volume.ktx2", controls: true });
      await screen.findByLabelText("3D volume preview; drag to rotate");
      expect(screen.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
      const before = gpu.draw.mock.calls.length;
      await fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(gpu.draw.mock.calls.length).toBeGreaterThan(before);
      await fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
      await fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
      await fireEvent.click(screen.getByRole("button", { name: "Slices" }));
      expect(screen.getByLabelText("Volume slice preview")).toBeInTheDocument();
      expect(screen.getByLabelText("Slice axis")).toBeInTheDocument();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("uses a middle slice for thumbnails and hides the dimension label", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => asset() })));
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ putImageData })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    try {
      const component = render(VolumePreview, { path: "volume.ktx2", thumbnail: true });
      await waitFor(() => expect(putImageData).toHaveBeenCalled());
      const pixels = Array.from(putImageData.mock.calls.at(-1)![0].data as Uint8Array).filter((_, i) => i % 4 === 0);
      expect(pixels).toEqual([12, 13, 14, 15, 16, 17]);
      expect(component.queryByText("2 × 3 × 4 · R8")).toBeNull();
      expect(component.queryByRole("slider")).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("displays useful HTTP/decode errors and aborts superseded requests", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => ({ ok: false, status: 404, arrayBuffer: async () => asset() }));
    vi.stubGlobal("fetch", fetcher);
    const component = render(VolumePreview, { path: "missing.ktx2" });
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 404");
    const signal = fetcher.mock.calls[0][1]!.signal as AbortSignal;
    fetcher.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
    await component.rerender({ path: "bad.ktx2" });
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("header"));
    component.unmount();
    expect((fetcher.mock.calls[1][1]!.signal as AbortSignal).aborted).toBe(true);
  });
});

describe("volume tab host integration", () => {
  it.each([
    { resolved_path: "webview://resolved.ktx2", hostPath: "webview://converted.ktx2", expected: "webview://resolved.ktx2" },
    { resolved_path: undefined, hostPath: "webview://converted.ktx2", expected: "webview://converted.ktx2" },
    { resolved_path: undefined, hostPath: undefined, expected: "local.ktx2" },
  ])("resolves preview URIs with precedence $expected", async ({ resolved_path, hostPath, expected }) => {
    const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => asset() }));
    vi.stubGlobal("fetch", fetcher);
    const component = render(VolumeTab, {
      tempInput: { type: "volume", path: "local.ktx2", resolved_path }, shaderPath: "shader.glsl",
      postMessage: vi.fn(), onMessage: vi.fn(), getWebviewUri: () => hostPath,
      onAssetSelect: vi.fn(), onUpdatePath: vi.fn(), onUpdateFilter: vi.fn(), onUpdateWrap: vi.fn(),
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expected, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    await component.rerender({ tempInput: { type: "keyboard" } as ConfigInput });
    expect(screen.getByLabelText("Filter")).toHaveValue("linear");
    expect(screen.getByLabelText("Wrap X / Y / Z")).toHaveValue("repeat");
  });
});

describe("volume preview interactions and failures", () => {
  it("rotates only the captured pointer, releases drags, and returns from slices to 3D", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => ktxVolume(2,3,4,4) })));
    render(VolumePreview, { path: "rgba.ktx2", controls: true });
    const canvas = await screen.findByLabelText("3D volume preview; drag to rotate");
    const event = (name: string, id = 1, x = 10, y = 20) => fireEvent(canvas, Object.assign(new Event(name, { bubbles: true }), { pointerId: id, clientX: x, clientY: y }));
    const before = gpu.draw.mock.calls.length;
    await event("pointermove");
    expect(gpu.draw.mock.calls.length).toBe(before);
    await event("pointerdown");
    await event("pointermove", 2, 30, 40);
    expect(gpu.draw.mock.calls.length).toBe(before);
    await event("pointermove", 1, 30, 40);
    expect(gpu.draw.mock.calls.length).toBeGreaterThan(before);
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
      await event("pointerdown"); await event(name);
    }
    await fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    await fireEvent.pointerDown(screen.getByLabelText("Volume slice preview"));
    await fireEvent.click(screen.getByRole("button", { name: /^3D$/ }));
    expect(screen.getByRole("button", { name: /^3D$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2 × 3 × 4 · RGBA8")).toBeInTheDocument();
  });
  it.each([new Error("WebGL unavailable"), "device unavailable"])("shows GPU initialization failures and still allows slices (%s)", async error => {
    gpu.error = error;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => asset() })));
    render(VolumePreview, { path: "volume.ktx2", controls: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(error instanceof Error ? error.message : error);
    await fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    expect(screen.getByLabelText("Slice axis")).toBeInTheDocument();
  });
  it("ignores stale decoded responses, stale failures, and empty paths", async () => {
    let finish!: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    let fail!: (reason: unknown) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => finish = resolve))
      .mockImplementationOnce(() => new Promise((_, reject) => fail = reject)).mockRejectedValueOnce("offline");
    vi.stubGlobal("fetch", fetcher);
    const component = render(VolumePreview, { path: "old.ktx2" });
    await component.rerender({ path: "second.ktx2" });
    finish({ ok: true, arrayBuffer: async () => asset() });
    await component.rerender({ path: "third.ktx2" });
    fail(new Error("stale"));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    await component.rerender({ path: "" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Loading volume/)).toBeNull();
  });
});
