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
  });
});
