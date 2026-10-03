declare module "virtual:shader-fixture-corpus" {
  import type { ShaderProgram, ShaderLanguage } from "./ShaderCanvasHarness";

  interface ShaderFixtureProject extends ShaderProgram {
    name: string;
    language: ShaderLanguage;
    slangSourcePath?: string;
    slangSourcePaths?: Record<string, string>;
  }

  const projects: ShaderFixtureProject[];
  export default projects;
}

declare module "virtual:wgsl-source-corpus" {
  const sources: Array<{ name: string; source: string }>;
  export default sources;
}
