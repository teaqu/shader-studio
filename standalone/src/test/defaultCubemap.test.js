import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const image = PNG.sync.read(readFileSync(resolve(
  dirname(fileURLToPath(import.meta.url)), '../../public/assets/desert-cubemap-cross.png',
)));
const size = image.width / 4;
const faces = { left: [0, 1], front: [1, 1], right: [2, 1], back: [3, 1], sky: [1, 0], ground: [1, 2] };

function pixel(face, edge, offset) {
  const [column, row] = faces[face];
  const x = edge === 'left' ? 0 : edge === 'right' ? size - 1 : offset;
  const y = edge === 'top' ? 0 : edge === 'bottom' ? size - 1 : offset;
  const index = ((row * size + y) * image.width + column * size + x) * 4;
  return image.data.subarray(index, index + 3);
}

describe('bundled desert cubemap', () => {
  it('has six square faces on an exact 4 by 3 grid', () => {
    expect(Number.isInteger(size)).toBe(true);
    expect(image.height).toBe(size * 3);
  });

  // These are the twelve physical cube edges, including reversed edges where
  // the two faces run in opposite directions. Test the shipped pixels rather
  // than a synthetic fixture: the original artwork had unrelated sky/ground
  // tiles and white borders even though its face extraction was correct.
  it.each([
    ['left', 'right', 'front', 'left', false],
    ['front', 'right', 'right', 'left', false],
    ['right', 'right', 'back', 'left', false],
    ['back', 'right', 'left', 'left', false],
    ['sky', 'bottom', 'front', 'top', false],
    ['sky', 'right', 'right', 'top', true],
    ['sky', 'top', 'back', 'top', true],
    ['sky', 'left', 'left', 'top', false],
    ['ground', 'top', 'front', 'bottom', false],
    ['ground', 'right', 'right', 'bottom', false],
    ['ground', 'bottom', 'back', 'bottom', true],
    ['ground', 'left', 'left', 'bottom', true],
  ])('joins %s %s to %s %s (reversed: %s)', (a, edgeA, b, edgeB, reverse) => {
    let difference = 0;
    const segments = 32;
    for (let segment = 0; segment < segments; segment++) {
      const start = Math.floor(segment * size / segments);
      const end = Math.floor((segment + 1) * size / segments);
      const delta = [0, 0, 0];
      for (let i = start; i < end; i++) {
        const first = pixel(a, edgeA, i);
        const second = pixel(b, edgeB, reverse ? size - 1 - i : i);
        for (let channel = 0; channel < 3; channel++) {
          delta[channel] += first[channel] - second[channel];
        }
      }
      difference += delta.reduce((sum, value) => sum + Math.abs(value) / (end - start), 0);
    }
    // Compare local mean colours: adjacent texel centres sample different
    // stones in detailed terrain. Per-pixel absolute differences incorrectly
    // flag that texture detail as a seam, even within a single seamless face.
    expect(difference / (segments * 3)).toBeLessThan(12);
  });
});
