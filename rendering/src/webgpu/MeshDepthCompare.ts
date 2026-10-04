/** Raw clip-space meshes may sit exactly at the legal far depth boundary (z = w). */
export function meshDepthCompare(useViewerCamera?: boolean): 'less' | 'less-equal' {
  return useViewerCamera === false ? 'less-equal' : 'less';
}
