/** A CPU snapshot of a contiguous element range in a GPU storage buffer. */
export interface StorageBufferSnapshot {
  name: string;
  elementType: string;
  stride: number;
  start: number;
  count: number;
  data: ArrayBuffer;
  fields?: StorageFieldLayout[];
  frame?: number;
  capturePoint?: StorageCapturePoint;
}

export interface StorageCapturePoint {
  pass: string;
  timing: 'before' | 'after';
}

export interface StorageFieldLayout {
  name: string;
  type: string;
  offset: number;
}
