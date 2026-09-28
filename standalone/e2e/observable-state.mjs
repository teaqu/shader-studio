/** Advance through browser render opportunities instead of sleeping on a wall clock. */
export async function waitForAnimationFrames(page, count = 2) {
  for (let frame = 0; frame < count; frame += 1) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
}

/**
 * Assert a negative condition over a finite window, sampling every fresh
 * animation frame. This keeps debounce/no-flash checks meaningful without a
 * blind pause that can race a slow renderer.
 */
export async function expectStableFor(page, assertion, durationMs = 750) {
  const deadline = Date.now() + durationMs;
  do {
    await assertion();
    await waitForAnimationFrames(page, 1);
  } while (Date.now() < deadline);
  await assertion();
}
