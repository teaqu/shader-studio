/**
 * Explorer, Files and Config panes add their own dividers to the standalone
 * layout, so a test resizing one split picks the vertical sash closest to the
 * pane edge it means rather than relying on sash order.
 */
export const OUTER_SASHES = '.standalone-dockview .dv-sash.dv-enabled:not(.standalone-panel-source *)';

/** Index of the vertical box whose centre is closest to `x`, or -1 if none. */
export function nearestVerticalBoxIndex(boxes, x) {
  let best = -1;
  let bestDistance = Infinity;
  boxes.forEach((box, index) => {
    if (box.height <= box.width) {
      return;
    }
    const distance = Math.abs(box.x + box.width / 2 - x);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** The vertical outer sash on the left edge `x` of a pane. */
export async function sashAtLeftEdge(page, x) {
  const sashes = page.locator(OUTER_SASHES);
  const boxes = await sashes.evaluateAll(elements => elements.map(element => {
    const { x: left, width, height } = element.getBoundingClientRect();
    return { x: left, width, height };
  }));
  const index = nearestVerticalBoxIndex(boxes, x);
  if (index < 0) {
    throw new Error('No vertical layout sash is visible.');
  }
  return sashes.nth(index);
}
