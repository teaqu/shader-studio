declare module "virtual:shader-fixture-corpus" {
  import type { ShaderLanguage } from "./ShaderCanvasHarness";

  /** The generated corpus deliberately includes invalid and cross-language
   * configurations, so its inspection contract is broader than ShaderConfig. */
  interface CorpusInput {
    type: string;
    source?: string;
    path?: string;
    [key: string]: unknown;
  }

  interface CorpusPass {
    entryPoints?: { vertex?: string; fragment?: string; compute?: string };
    outputs?: string[];
    type?: string;
    path?: string;
    vertex?: string;
    geometry?: { type?: string };
    inputs?: Record<string, CorpusInput>;
    [key: string]: unknown;
  }

  interface CorpusConfig {
    passes?: Record<string, CorpusPass>;
    storage?: Record<string, unknown>;
    script?: string;
  }

  interface ShaderFixtureProject {
    name: string;
    language: ShaderLanguage;
    path?: string;
    image: string;
    buffers?: Record<string, string>;
    config?: CorpusConfig | null;
    customUniformDeclarations?: string;
    customUniformInfo?: { name: string; type: string }[];
    customUniformValues?: { name: string; type: string; value: number | number[] | boolean }[];
    slangSourcePath?: string;
    slangSourcePaths?: Record<string, string>;
  }

  const projects: ShaderFixtureProject[];
  export default projects;
}

declare module "*.wgsl?raw" { const source: string; export default source; }
declare module "*.slang?raw" { const source: string; export default source; }
