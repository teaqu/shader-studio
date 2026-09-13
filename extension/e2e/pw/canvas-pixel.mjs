/** Read the presented canvas, including WebGPU's transient swapchain. */
export async function centrePixel(frame) {
  const screenshot = await frame.locator('.canvas-container canvas').first().screenshot();
  return frame.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data].slice(0, 3);
    } finally {
      bitmap.close();
    }
  }, screenshot.toString('base64'));
}
