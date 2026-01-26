declare module 'glsl-transpiler' {
  function glslTranspiler(): (src: string) => string;
  export = glslTranspiler;
}