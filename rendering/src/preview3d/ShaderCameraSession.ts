/** Camera navigation belongs to a successfully installed shader, not its recompiles. */
export class ShaderCameraSession {
  private shaderPath: string | undefined;

  constructor(private readonly camera: { reset(): void }) {}

  install(shaderPath: string): void {
    if (this.shaderPath === shaderPath) {
      return;
    }
    this.camera.reset();
    this.shaderPath = shaderPath;
  }
}
