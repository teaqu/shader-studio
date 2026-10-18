// Standalone keeps its own copy: E2E helpers may not import across workspace packages.
/**
 * Puts a debug panel toggle into the state a test depends on. Fresh settings
 * start with the variable inspector on and inline rendering off, so tests must
 * state what they need rather than toggling from an assumed default.
 */
export async function setDebugPanelControl(frame, label, active, { timeout = 30_000, interval = 100 } = {}) {
  const button = frame.locator(`.debug-panel [aria-label="${label}"]`).first();
  const isActive = () => button.evaluate(element => element.classList.contains('active'));
  await button.waitFor({ state: 'visible', timeout });
  if (await isActive() !== active) {
    await button.click();
  }
  const deadline = Date.now() + timeout;
  while (await isActive() !== active) {
    if (Date.now() >= deadline) {
      throw new Error(`${label} did not become ${active ? 'active' : 'inactive'}`);
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
