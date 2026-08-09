import { expectTypeOf, test } from "vitest";
import type { ShaderAuthoringEnvironment } from "../index";

test("ShaderAuthoringEnvironment identifies the authored document revision", () => {
  expectTypeOf<ShaderAuthoringEnvironment>().toMatchTypeOf<{
    documentUri: string;
    languageId: "glsl" | "slang";
    generation: number;
  }>();
});
