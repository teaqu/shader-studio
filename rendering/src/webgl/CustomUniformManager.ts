import { parseScriptUniformType, zeroScriptUniform, type ScriptUniformType } from "@shader-studio/types";
export type CustomUniformType = ScriptUniformType;

export interface CustomUniform {
  name: string;
  type: string;
  value: number | number[] | boolean;
}

/** Keep transport updates received before shader declarations are available. */
export function mergeCustomUniformValues(current: CustomUniform[] | null, changed: CustomUniform[]): CustomUniform[] {
  const merged = new Map((current ?? []).map(uniform => [uniform.name, uniform]));
  for (const uniform of changed) {
    merged.set(uniform.name, uniform);
  }
  return [...merged.values()].map(uniform => ({
    ...uniform,
    value: Array.isArray(uniform.value) ? [...uniform.value] : uniform.value,
  }));
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
      if (parseScriptUniformType(type)) {
        this.inferredTypes[name] = type as CustomUniformType;
      }
    }
  }

  /**
   * Set externally-evaluated uniform values (from extension host polling).
   */
  public setValues(values: CustomUniform[]): void {
    this.externalValues = values.map(u => ({
      ...u,
      value: Array.isArray(u.value) ? [...u.value] : u.value,
    }));
  }

  /**
   * Merge a partial update of changed uniforms into externalValues.
   * Only touches named entries; leaves others unchanged.
   */
  public updateValues(changed: CustomUniform[]): void {
    if (!this.externalValues) {
      this.externalValues = this.getZeroUniforms();
    }
    for (const u of changed) {
      const idx = this.externalValues.findIndex(v => v.name === u.name);
      if (idx >= 0) {
        this.externalValues[idx] = {
          ...u,
          value: Array.isArray(u.value) ? [...u.value] : u.value,
        };
      }
    }
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
      const value = zeroScriptUniform(type);
      return { name, type, value };
    });
  }

}
