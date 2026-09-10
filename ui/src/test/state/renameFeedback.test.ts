import { describe, expect, it } from "vitest";
import { getRenameFeedback, setRenameFeedback } from "../../lib/state/renameFeedback.svelte";

describe("rename feedback", () => {
  it("keeps feedback scoped to its editor and clears it", () => {
    setRenameFeedback("first", "Cannot rename");
    setRenameFeedback("second", "Other reason");
    expect(getRenameFeedback("first")).toBe("Cannot rename");
    expect(getRenameFeedback("second")).toBe("Other reason");
    setRenameFeedback("first", undefined);
    expect(getRenameFeedback("first")).toBeUndefined();
    expect(getRenameFeedback("second")).toBe("Other reason");
    setRenameFeedback("second", undefined);
  });
});
