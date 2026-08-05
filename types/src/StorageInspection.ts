/** A CPU snapshot of a contiguous element range in a GPU storage buffer. */
export interface StorageBufferSnapshot {
  name: string;
  elementType: string;
  stride: number;
  start: number;
  count: number;
  data: ArrayBuffer;
}
