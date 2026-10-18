/** Deliver real browser Files through the same drag events as a device drop. */
export async function dropDeviceFiles(page, target, files) {
  const transfer = await page.evaluateHandle(entries => {
    const data = new DataTransfer();
    for (const entry of entries) {
      data.items.add(new File([new Uint8Array(entry.bytes)], entry.name, { type: entry.mimeType }));
    }
    return data;
  }, files.map(file => ({ name: file.name, mimeType: file.mimeType, bytes: [...file.buffer] })));
  try {
    await target.dispatchEvent('dragover', { dataTransfer: transfer });
    await target.dispatchEvent('drop', { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
}
