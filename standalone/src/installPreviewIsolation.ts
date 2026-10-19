import { installPreviewStorage, previewChannel } from './previewIsolation';

/** Imported first by `main.ts`, before any module reads storage as it loads. */
export const previewStorageIsolated = installPreviewStorage(previewChannel());
