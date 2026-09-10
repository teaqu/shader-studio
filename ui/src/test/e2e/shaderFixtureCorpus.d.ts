declare module "virtual:shader-fixture-corpus" {
  import type { ShaderConfig } from "@shader-studio/types";

  interface ShaderFixtureProject {
    name: string;
    language: "glsl" | "slang" | "wgsl";
    path?: string;
    image: string;
    buffers?: Record<string, string>;
    config?: ShaderConfig | null;
    customUniformDeclarations?: string;
    customUniformInfo?: { name: string; type: string }[];
    customUniformValues?: { name: string; type: string; value: number | number[] | boolean }[];
    slangSourcePath?: string;
    slangSourcePaths?: Record<string, string>;
  }

  const projects: ShaderFixtureProject[];
  export default projects;
}

declare module "virtual:shader-corpus-files" {
  /** Raw corpus text files, workspace-relative, for seeding a VirtualWorkspace. */
  interface CorpusFile {
    path: string;
    contents: string;
  }

  const files: CorpusFile[];
  export default files;
}
