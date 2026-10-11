/** Source identity is independent of which pass tab is currently focused. */
export function shaderPathsEqual(firstPath: string, secondPath: string): boolean {
  return firstPath.replace(/\\/g, "/") === secondPath.replace(/\\/g, "/");
}

export function sharedSourcePassNames(sourcePath: string, imagePath: string, bufferPaths: Readonly<Record<string, string>>): string[] {
  if (!sourcePath) {
    return [];
  }
  return [...new Set([
    ...(imagePath && shaderPathsEqual(sourcePath, imagePath) ? ["Image"] : []),
    ...Object.entries(bufferPaths).filter(([name, path]) => name !== "common" && shaderPathsEqual(path, sourcePath)).map(([name]) => name),
  ])];
}
