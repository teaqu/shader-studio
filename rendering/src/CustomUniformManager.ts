export type CustomUniformType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'bool';

export interface CustomUniform {
  name: string;
  type: CustomUniformType;
  value: number | number[] | boolean;
}

export class CustomUniformManager {
  private declarations = "";
  private inferredTypes: Record<string, CustomUniformType> = {};
  private externalValues: CustomUniform[] | null = null;

  /**
   * Load pre-computed declarations and type info from the extension host.
   * Used when script evaluation happens in Node.js (not in the webview).
   */
  public loadDeclarations(declarations: string, uniformInfo: { name: string; type: string }[]): void {
    // Preserve external values across reloads so static uniforms survive recompilation
    const savedValues = this.externalValues;
    this.clear();
    this.externalValues = savedValues;
    this.declarations = declarations;
    for (const { name, type } of uniformInfo) {
      if (['float', 'vec2', 'vec3', 'vec4', 'bool'].includes(type)) {
        this.inferredTypes[name] = type as CustomUniformType;
      }
    }
  }

  /**
   * Set externally-evaluated uniform values (from extension host polling).
   */
  public setValues(values: CustomUniform[]): void {
    this.externalValues = values;
  }

  public getValues(): CustomUniform[] {
    return this.externalValues ?? [];
  }

  public getDeclarations(): string {
    return this.declarations;
  }

  public clear(): void {
    this.declarations = "";
    this.inferredTypes = {};
    this.externalValues = null;
  }

  public hasUniforms(): boolean {
    return Object.keys(this.inferredTypes).length > 0;
  }

  public getUniformInfo(): { name: string; type: string }[] {
    return Object.entries(this.inferredTypes).map(([name, type]) => ({ name, type }));
  }

  /**
   * Get the current uniform values (external or zero defaults).
   * Used by variable capture to upload custom uniforms to capture shaders.
   */
  public getCurrentValues(): { name: string; type: string; value: number | number[] | boolean }[] {
    if (this.externalValues !== null) {
      return this.externalValues.map(u => ({ name: u.name, type: u.type, value: u.value }));
    }
    return this.getZeroUniforms().map(u => ({ name: u.name, type: u.type, value: u.value }));
  }

  private getZeroUniforms(): CustomUniform[] {
    return Object.entries(this.inferredTypes).map(([name, type]) => {
      let value: number | number[] | boolean;
      switch (type) {
        case 'float': value = 0; break;
        case 'vec2': value = [0, 0]; break;
        case 'vec3': value = [0, 0, 0]; break;
        case 'vec4': value = [0, 0, 0, 0]; break;
        case 'bool': value = false; break;
      }
      return { name, type, value };
    });
  }

}
