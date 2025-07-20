export type Pass = {
  name: string;
  shaderSrc: string;
  inputs: Record<string, any>;
  path?: string;
}
