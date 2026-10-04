import { expect, it } from "vitest";
import { bt709I420Planes } from "../e2e/bt709I420Diagnostic";

function image(width: number, height: number, colors: number[][]): ImageData {
  return { width, height, data: new Uint8ClampedArray(colors.flatMap(color => [...color, 255])) } as ImageData;
}
it.each([
  [[0, 0, 0], [16, 16, 16, 16, 128, 128]],
  [[255, 255, 255], [235, 235, 235, 235, 128, 128]],
  [[255, 0, 0], [63, 63, 63, 63, 102, 240]],
  [[0, 255, 0], [173, 173, 173, 173, 42, 26]],
  [[0, 0, 255], [32, 32, 32, 32, 240, 118]],
])("matches BT709 legal-range primary vectors %j", (color, expected) => {
  expect([...bt709I420Planes(image(2, 2, [color, color, color, color]))]).toEqual(expected);
});
it("averages all four chroma pixels and writes U and V into separate planes", () => {
  const colors = [[255, 0, 0], [255, 0, 0], [0, 0, 255], [0, 0, 255], [0, 255, 0], [0, 255, 0], [255, 255, 255], [255, 255, 255]];
  expect([...bt709I420Planes(image(4, 2, colors))]).toEqual([63, 63, 32, 32, 173, 173, 235, 235, 72, 184, 133, 123]);
});
it("rejects dimensions that cannot have a complete two-by-two chroma block", () => {
  expect(() => bt709I420Planes(image(3, 2, []))).toThrow("even dimensions");
});
it.each([
  [[255, 0, 0], [81, 81, 81, 81, 90, 240]],
  [[0, 255, 0], [145, 145, 145, 145, 54, 34]],
  [[0, 0, 255], [41, 41, 41, 41, 240, 110]],
])("matches BT601 legal-range primary vectors %j", (color, expected) => {
  expect([...bt709I420Planes(image(2, 2, [color, color, color, color]), "smpte170m")]).toEqual(expected);
});
