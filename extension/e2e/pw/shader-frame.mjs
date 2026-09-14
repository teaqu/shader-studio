/**
 * Whether every iframe embedding a frame is visible in the workbench. VS Code
 * keeps hidden Shader Studio panels alive (retainContextWhenHidden), and their
 * content still looks visible from inside its own document, so a canvas check
 * alone can pick a hidden panel whose buttons another panel's iframe covers.
 */
async function isEmbeddingShown(frame) {
  for (let current = frame; current.parentFrame(); current = current.parentFrame()) {
    const element = await current.frameElement();
    if (!await element.isVisible()) {
      return false;
    }
  }
  return true;
}

/** The shown frame hosting the Shader Studio app, found by content: VS Code's
 *  internal webview frame names differ across versions. */
export async function findShownAppFrame(frames) {
  for (const frame of frames) {
    try {
      const canvas = frame.locator('.canvas-container').first();
      if (await canvas.isVisible() && await isEmbeddingShown(frame)) {
        return frame;
      }
    } catch { /* frame detached mid-scan */ }
  }
  return null;
}
