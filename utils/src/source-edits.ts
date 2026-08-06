import type { DebugSourceEdit } from "@shader-studio/types";

export type ApplySourceEditsResult =
  | { ok: true; source: string }
  | { ok: false; code: "debug-overlapping-edits" };

export function applySourceEdits(
  source: string,
  edits: readonly DebugSourceEdit[],
): ApplySourceEditsResult {
  const sortedEdits = [...edits].sort((left, right) =>
    left.start - right.start || left.end - right.end,
  );

  let previousEnd = 0;
  for (const edit of sortedEdits) {
    if (
      !Number.isInteger(edit.start)
      || !Number.isInteger(edit.end)
      || edit.start < 0
      || edit.end < edit.start
      || edit.end > source.length
      || edit.start < previousEnd
    ) {
      return { ok: false, code: "debug-overlapping-edits" };
    }
    previousEnd = edit.end;
  }

  let updatedSource = source;
  for (let index = sortedEdits.length - 1; index >= 0; index -= 1) {
    const edit = sortedEdits[index]!;
    updatedSource = `${updatedSource.slice(0, edit.start)}${edit.text}${updatedSource.slice(edit.end)}`;
  }

  return { ok: true, source: updatedSource };
}
