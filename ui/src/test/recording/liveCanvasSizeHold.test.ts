import { describe, expect, it, vi } from "vitest";
import { LiveCanvasSizeHold } from "../../lib/recording/liveCanvasSizeHold";

describe("LiveCanvasSizeHold", () => {
  it("applies resizes immediately when no Live recording is running", () => {
    const apply = vi.fn();
    const hold = new LiveCanvasSizeHold(apply);

    hold.resize(800, 600, false);

    expect(apply).toHaveBeenCalledWith(800, 600);
    expect(hold.isHolding).toBe(false);
  });

  it("holds resizes during a Live recording and applies only the latest on release", () => {
    const apply = vi.fn();
    const hold = new LiveCanvasSizeHold(apply);

    hold.resize(1024, 768, true);
    hold.resize(1280, 720, true);
    expect(apply).not.toHaveBeenCalled();
    expect(hold.isHolding).toBe(true);

    hold.release();
    hold.release();

    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(1280, 720);
  });

  it("drops a held size when a later resize is applied directly", () => {
    const apply = vi.fn();
    const hold = new LiveCanvasSizeHold(apply);

    hold.resize(1024, 768, true);
    hold.resize(640, 480, false);
    hold.release();

    expect(apply.mock.calls).toEqual([[640, 480]]);
  });
});
