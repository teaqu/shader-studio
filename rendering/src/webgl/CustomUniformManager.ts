export type CustomUniformType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'bool';

export interface CustomUniform {
  name: string;
  type: string;
  value: number | number[] | boolean;
}

export class CustomUniformManager {
  private declarations = "";
  private inferredTypes: Record<string, CustomUniformType> = {};
  private externalValues: CustomUniform[] | null = null;
  /**
   * Values that arrived before the declarations did. The extension host starts
   * polling as soon as it has sent the shader, so its first values routinely
   * beat the compile that loads the declarations - and a value dropped there
   * used to be dropped for the life of the shader.
   */
  private earlyValues = new Map<string, CustomUniform>();

  /**
   * Load pre-computed declarations and type info from the extension host.
   * Used when script evaluation happens in Node.js (not in the webview).
   */
  public loadDeclarations(declarations: string, uniformInfo: { name: string; type: string }[]): void {
    // Preserve external values across reloads so static uniforms survive recompilation
    const savedValues = this.externalValues;
    // Copied, not aliased: clear() empties the live map.
    const earlyValues = new Map(this.earlyValues);
    this.clear();
    this.declarations = declarations;
    for (const { name, type } of uniformInfo) {
      if (['float', 'vec2', 'vec3', 'vec4', 'bool'].includes(type)) {
        this.inferredTypes[name] = type as CustomUniformType;
      }
    }

    if (savedValues === null && earlyValues.size === 0) {
      return;
    }

    // One entry per declared uniform, taking the newest value known for it and
    // zero where none is: a uniform the script stopped declaring goes away, and
    // a uniform declared but never sent renders as zero rather than nothing.
    const known = new Map<string, CustomUniform>();
    for (const value of savedValues ?? []) {
      known.set(value.name, value);
    }
    for (const [name, value] of earlyValues) {
      known.set(name, value);
    }
    this.externalValues = this.getZeroUniforms().map((zero) => {
      const value = known.get(zero.name);
      return value && value.type === zero.type ? { ...value } : zero;
    });
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
    const copy = (u: CustomUniform): CustomUniform => ({
      ...u,
      value: Array.isArray(u.value) ? [...u.value] : u.value,
    });

    // Before the declarations arrive there is nothing to merge into, so the
    // update is held until loadDeclarations can place it.
    if (!this.hasUniforms()) {
      for (const u of changed) {
        this.earlyValues.set(u.name, copy(u));
      }
      return;
    }

    if (!this.externalValues) {
      this.externalValues = this.getZeroUniforms();
    }
    for (const u of changed) {
      if (!(u.name in this.inferredTypes)) {
        continue;
      }
      if (u.type !== this.inferredTypes[u.name]) {
        continue;
      }
      const idx = this.externalValues.findIndex(v => v.name === u.name);
      if (idx >= 0) {
        this.externalValues[idx] = copy(u);
      } else {
        this.externalValues.push(copy(u));
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
    this.earlyValues.clear();
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
