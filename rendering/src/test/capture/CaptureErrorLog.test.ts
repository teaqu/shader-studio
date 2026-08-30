import { describe, expect, it } from "vitest";
import { CaptureErrorLog } from "../../capture/CaptureErrorLog";

describe("CaptureErrorLog", () => {
  it("starts empty", () => {
    const log = new CaptureErrorLog();

    expect(log.list()).toEqual([]);
    expect(log.lastMessage).toBeNull();
    expect(log.format()).toBeNull();
  });

  it("keeps one entry per failing variable rather than only the last", () => {
    const log = new CaptureErrorLog();

    log.record("compile failed", "col");
    log.record("compile failed", "tun");

    expect(log.list()).toEqual([
      { varName: "col", message: "compile failed" },
      { varName: "tun", message: "compile failed" },
    ]);
    expect(log.lastMessage).toBe("compile failed");
  });

  it("ignores an exact repeat of a failure it already holds", () => {
    const log = new CaptureErrorLog();

    log.record("compile failed", "col");
    log.record("compile failed", "col");

    expect(log.list()).toHaveLength(1);
  });

  it("keeps an unattributed failure separate from the same message on a variable", () => {
    const log = new CaptureErrorLog();

    log.record("channels are not resolvable yet");
    log.record("channels are not resolvable yet", "col");

    expect(log.list()).toEqual([
      { message: "channels are not resolvable yet" },
      { varName: "col", message: "channels are not resolvable yet" },
    ]);
  });

  it("ignores empty and missing messages", () => {
    const log = new CaptureErrorLog();

    log.record(null);
    log.record(undefined);
    log.record("");
    log.record("   ");

    expect(log.list()).toEqual([]);
  });

  it("trims what it records", () => {
    const log = new CaptureErrorLog();

    log.record("  boom\n", "col");

    expect(log.list()).toEqual([{ varName: "col", message: "boom" }]);
  });

  it("stops growing once a realtime loop has filled it", () => {
    const log = new CaptureErrorLog();

    for (let index = 0; index < 200; index += 1) {
      log.record(`failure ${index}`, `var${index}`);
    }

    expect(log.list()).toHaveLength(64);
    expect(log.list()[0].message).toBe("failure 0");
  });

  it("clears everything it holds", () => {
    const log = new CaptureErrorLog();
    log.record("boom", "col");

    log.clear();

    expect(log.list()).toEqual([]);
    expect(log.lastMessage).toBeNull();
  });

  it("formats one line per failure, naming the variable where there is one", () => {
    const log = new CaptureErrorLog();
    log.record("channels are not resolvable yet");
    log.record("compile failed", "col");

    expect(log.format()).toBe("channels are not resolvable yet\ncol: compile failed");
  });
});
