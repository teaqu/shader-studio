import { describe, it, expect, vi, beforeEach } from "vitest";
import { CustomUniformManager } from "../CustomUniformManager";

describe("CustomUniformManager", () => {
  let manager: CustomUniformManager;

  beforeEach(() => {
    manager = new CustomUniformManager();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  describe("loadDeclarations", () => {
    it("should set declarations and type info without script evaluation", () => {
      const declarations = "uniform float uSpeed;\nuniform vec3 uColor;";
      const uniformInfo = [
        { name: "uSpeed", type: "float" },
        { name: "uColor", type: "vec3" },
      ];

      manager.loadDeclarations(declarations, uniformInfo);

      expect(manager.getDeclarations()).toBe(declarations);
      expect(manager.hasUniforms()).toBe(true);
      expect(manager.getUniformInfo()).toEqual(uniformInfo);
    });

    it("should ignore invalid types", () => {
      manager.loadDeclarations("uniform mat4 uMatrix;", [
        { name: "uMatrix", type: "mat4" },
      ]);

      expect(manager.hasUniforms()).toBe(false);
      expect(manager.getUniformInfo()).toEqual([]);
    });

    it("should clear previous state", () => {
      manager.loadDeclarations("uniform float uOld;", [{ name: "uOld", type: "float" }]);
      expect(manager.hasUniforms()).toBe(true);

      manager.loadDeclarations("uniform float uNew;", [
        { name: "uNew", type: "float" },
      ]);

      expect(manager.getUniformInfo()).toEqual([{ name: "uNew", type: "float" }]);
    });
  });

  describe("getUniformInfo", () => {
    it("should return empty array when no uniforms loaded", () => {
      expect(manager.getUniformInfo()).toEqual([]);
    });

    it("should return name/type pairs for all loaded uniforms", () => {
      manager.loadDeclarations(
        "uniform float uSpeed;\nuniform vec3 uColor;\nuniform bool uEnabled;",
        [
          { name: "uSpeed", type: "float" },
          { name: "uColor", type: "vec3" },
          { name: "uEnabled", type: "bool" },
        ]
      );

      const info = manager.getUniformInfo();
      expect(info).toHaveLength(3);
      expect(info).toContainEqual({ name: "uSpeed", type: "float" });
      expect(info).toContainEqual({ name: "uColor", type: "vec3" });
      expect(info).toContainEqual({ name: "uEnabled", type: "bool" });
    });

    it("should reflect state after clear", () => {
      manager.loadDeclarations("uniform float uVal;", [{ name: "uVal", type: "float" }]);
      expect(manager.getUniformInfo()).toHaveLength(1);

      manager.clear();
      expect(manager.getUniformInfo()).toEqual([]);
    });
  });

  describe("clear", () => {
    it("should reset all state", () => {
      manager.loadDeclarations("uniform float uVal;", [{ name: "uVal", type: "float" }]);
      manager.setValues([{ name: "uVal", type: "float" as const, value: 1.0 }]);

      manager.clear();

      expect(manager.hasUniforms()).toBe(false);
      expect(manager.getDeclarations()).toBe("");
      expect(manager.getUniformInfo()).toEqual([]);
      expect(manager.getValues()).toEqual([]);
    });
  });

  describe("getCurrentValues", () => {
    it("should return empty array when no uniforms loaded", () => {
      expect(manager.getCurrentValues()).toEqual([]);
    });

    it("should return external values when set", () => {
      manager.loadDeclarations("uniform float uSpeed;", [
        { name: "uSpeed", type: "float" },
      ]);
      const external = [{ name: "uSpeed", type: "float" as const, value: 3.14 }];
      manager.setValues(external);

      const values = manager.getCurrentValues();
      expect(values).toEqual([{ name: "uSpeed", type: "float", value: 3.14 }]);
    });

    it("should return zero defaults when no external values set", () => {
      manager.loadDeclarations(
        "uniform float uF;\nuniform vec3 uV;\nuniform bool uB;",
        [
          { name: "uF", type: "float" },
          { name: "uV", type: "vec3" },
          { name: "uB", type: "bool" },
        ]
      );

      const values = manager.getCurrentValues();
      expect(values).toContainEqual({ name: "uF", type: "float", value: 0 });
      expect(values).toContainEqual({ name: "uV", type: "vec3", value: [0, 0, 0] });
      expect(values).toContainEqual({ name: "uB", type: "bool", value: false });
    });

    it("should survive loadDeclarations reload (external values preserved)", () => {
      manager.loadDeclarations("uniform float uSpeed;", [
        { name: "uSpeed", type: "float" },
      ]);
      manager.setValues([{ name: "uSpeed", type: "float" as const, value: 5.0 }]);

      // Reload declarations (simulates shader recompilation)
      manager.loadDeclarations("uniform float uSpeed;", [
        { name: "uSpeed", type: "float" },
      ]);

      const values = manager.getCurrentValues();
      expect(values).toEqual([{ name: "uSpeed", type: "float", value: 5.0 }]);
    });

    it("should return empty after clear", () => {
      manager.loadDeclarations("uniform float uVal;", [
        { name: "uVal", type: "float" },
      ]);
      manager.setValues([{ name: "uVal", type: "float" as const, value: 1.0 }]);

      manager.clear();
      expect(manager.getCurrentValues()).toEqual([]);
    });
  });

  describe("updateValues", () => {
    it("should merge changed values without replacing others", () => {
      manager.loadDeclarations("uniform float uA;\nuniform float uB;", [
        { name: "uA", type: "float" },
        { name: "uB", type: "float" },
      ]);
      manager.setValues([
        { name: "uA", type: "float" as const, value: 1.0 },
        { name: "uB", type: "float" as const, value: 2.0 },
      ]);

      manager.updateValues([{ name: "uA", type: "float" as const, value: 9.0 }]);

      const values = manager.getValues();
      const uA = values.find(v => v.name === "uA");
      const uB = values.find(v => v.name === "uB");
      expect(uA?.value).toBe(9.0);
      expect(uB?.value).toBe(2.0);
    });

    it("should initialize from zero defaults when externalValues is null", () => {
      manager.loadDeclarations("uniform float uA;\nuniform float uB;", [
        { name: "uA", type: "float" },
        { name: "uB", type: "float" },
      ]);

      manager.updateValues([{ name: "uA", type: "float" as const, value: 5.0 }]);

      const values = manager.getValues();
      const uA = values.find(v => v.name === "uA");
      const uB = values.find(v => v.name === "uB");
      expect(uA?.value).toBe(5.0);
      expect(uB?.value).toBe(0); // zero default
    });

    it("should ignore unknown uniform names", () => {
      manager.loadDeclarations("uniform float uA;", [
        { name: "uA", type: "float" },
      ]);
      manager.setValues([{ name: "uA", type: "float" as const, value: 1.0 }]);

      // uX does not exist in the known uniforms list
      manager.updateValues([{ name: "uX", type: "float" as const, value: 99.0 }]);

      const values = manager.getValues();
      expect(values.find(v => v.name === "uX")).toBeUndefined();
      expect(values.find(v => v.name === "uA")?.value).toBe(1.0);
    });

    it("should correctly merge vec3 array values", () => {
      manager.loadDeclarations("uniform vec3 uColor;\nuniform vec3 uDir;", [
        { name: "uColor", type: "vec3" },
        { name: "uDir", type: "vec3" },
      ]);
      manager.setValues([
        { name: "uColor", type: "vec3" as const, value: [1.0, 0.0, 0.0] },
        { name: "uDir", type: "vec3" as const, value: [0.0, 1.0, 0.0] },
      ]);

      manager.updateValues([{ name: "uColor", type: "vec3" as const, value: [0.0, 0.0, 1.0] }]);

      const values = manager.getValues();
      expect(values.find(v => v.name === "uColor")?.value).toEqual([0.0, 0.0, 1.0]);
      expect(values.find(v => v.name === "uDir")?.value).toEqual([0.0, 1.0, 0.0]);
    });

    it("should handle updating multiple changed uniforms at once", () => {
      manager.loadDeclarations("uniform float uA;\nuniform float uB;\nuniform float uC;", [
        { name: "uA", type: "float" },
        { name: "uB", type: "float" },
        { name: "uC", type: "float" },
      ]);
      manager.setValues([
        { name: "uA", type: "float" as const, value: 1.0 },
        { name: "uB", type: "float" as const, value: 2.0 },
        { name: "uC", type: "float" as const, value: 3.0 },
      ]);

      manager.updateValues([
        { name: "uA", type: "float" as const, value: 9.0 },
        { name: "uC", type: "float" as const, value: 8.0 },
      ]);

      const values = manager.getValues();
      expect(values.find(v => v.name === "uA")?.value).toBe(9.0);
      expect(values.find(v => v.name === "uB")?.value).toBe(2.0); // unchanged
      expect(values.find(v => v.name === "uC")?.value).toBe(8.0);
    });
  });

  describe("setValues / getValues", () => {
    it("should return external values from getValues()", () => {
      manager.loadDeclarations("uniform float uSpeed;", [
        { name: "uSpeed", type: "float" },
      ]);

      const values = [{ name: "uSpeed", type: "float" as const, value: 0.75 }];
      manager.setValues(values);

      expect(manager.getValues()).toEqual(values);
    });

    it("should return empty array when no values set", () => {
      manager.loadDeclarations("uniform float uSpeed;", [
        { name: "uSpeed", type: "float" },
      ]);

      expect(manager.getValues()).toEqual([]);
    });

    it("should reset external values on clear()", () => {
      manager.loadDeclarations("uniform float uSpeed;", [
        { name: "uSpeed", type: "float" },
      ]);
      manager.setValues([{ name: "uSpeed", type: "float" as const, value: 1 }]);

      manager.clear();

      expect(manager.getValues()).toEqual([]);
    });

    it("should accept empty array, clearing all values", () => {
      manager.loadDeclarations("uniform float uSpeed;", [
        { name: "uSpeed", type: "float" },
      ]);
      manager.setValues([{ name: "uSpeed", type: "float" as const, value: 1.0 }]);

      manager.setValues([]);

      expect(manager.getValues()).toEqual([]);
    });
  });

  describe("deep copy protection", () => {
    it("setValues does not allow external mutation of stored array values", () => {
      manager.loadDeclarations("uniform vec3 uColor;", [
        { name: "uColor", type: "vec3" },
      ]);

      const incoming = [{ name: "uColor", type: "vec3" as const, value: [1.0, 2.0, 3.0] }];
      manager.setValues(incoming);

      // Mutate the original array after the call
      (incoming[0].value as number[])[0] = 99.0;

      const stored = manager.getValues().find(v => v.name === "uColor");
      expect((stored?.value as number[])[0]).toBe(1.0); // unaffected
    });

    it("updateValues does not allow external mutation of stored array values", () => {
      manager.loadDeclarations("uniform vec3 uColor;", [
        { name: "uColor", type: "vec3" },
      ]);
      manager.setValues([{ name: "uColor", type: "vec3" as const, value: [1.0, 0.0, 0.0] }]);

      const incoming = { name: "uColor", type: "vec3" as const, value: [0.0, 1.0, 0.0] };
      manager.updateValues([incoming]);

      // Mutate the incoming value after the call
      (incoming.value as number[])[0] = 99.0;

      const stored = manager.getValues().find(v => v.name === "uColor");
      expect((stored?.value as number[])[0]).toBe(0.0); // unaffected
    });
  });

  describe("updateValues edge cases", () => {
    it("should apply last write when called twice on the same uniform", () => {
      manager.loadDeclarations("uniform float uVal;", [
        { name: "uVal", type: "float" },
      ]);
      manager.setValues([{ name: "uVal", type: "float" as const, value: 1.0 }]);

      manager.updateValues([{ name: "uVal", type: "float" as const, value: 5.0 }]);
      manager.updateValues([{ name: "uVal", type: "float" as const, value: 9.0 }]);

      expect(manager.getValues().find(v => v.name === "uVal")?.value).toBe(9.0);
    });
  });
});
