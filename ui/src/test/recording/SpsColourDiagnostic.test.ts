// @vitest-environment node
import { expect, it } from "vitest";
import { patchMp4SpsColourDiagnostic } from "../e2e/spsColourDiagnostic";

const sps = [39, 100, 0, 31, 172, 19, 20, 52, 12, 195, 191, 146, 106, 2, 2, 2, 15, 8, 4, 35, 96];
function box(type: string, payload: number[]): number[] {
  const size = payload.length + 8;
  return [size >>> 24, size >>> 16 & 255, size >>> 8 & 255, size & 255, ...Array.from(type, char => char.charCodeAt(0)), ...payload];
}
it.each([["primaries", 6, 13, 12], ["transfer", 13, 14, 26]] as const)("changes only the existing SPS %s field and preserves sample bytes", async (field, value, nalOffset, expectedByte) => {
  const original = new Uint8Array([
    ...box("avcC", [1, 100, 0, 31, 255, 225, 0, sps.length, ...sps, 0]),
    ...box("mdat", [1, 2, 3, 0, 0, 3, 255]),
  ]);
  const result = new Uint8Array(await (await patchMp4SpsColourDiagnostic(new Blob([original], { type: "video/mp4" }), field, value)).arrayBuffer());
  const expected = original.slice();
  expected[16 + nalOffset] = expectedByte;
  expect(result).toEqual(expected);
});
it("rejects a file without an AVC configuration rather than modifying arbitrary sample bytes", async () => {
  await expect(patchMp4SpsColourDiagnostic(new Blob([new Uint8Array(box("mdat", [1, 2, 3]))]), "primaries", 1)).rejects.toThrow("no AVC configuration");
});
