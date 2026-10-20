import { parseScriptUniformType } from '@shader-studio/types';
import type { CustomUniform } from './CustomUniformManager';
/** Integer/array additions shared by live rendering and variable capture. */
export function uploadTypedScriptUniform(gl: WebGL2RenderingContext, program: WebGLProgram, uniform: CustomUniform): boolean {
  const shape = parseScriptUniformType(uniform.type);
  if (!shape || (!shape.length && shape.base !== 'int' && shape.base !== 'uint')) {
    return false;
  }
  const location = gl.getUniformLocation(program, uniform.name + (shape.length ? '[0]' : ''));
  if (location === null) {
    return true;
  }
  if (shape.length) {
    const values = uniform.value as number[];
    if (shape.base === 'uint') {
      gl.uniform1uiv(location, new Uint32Array(values));
    } else if (shape.base === 'int') {
      gl.uniform1iv(location, new Int32Array(values));
    } else {
      gl.uniform1fv(location, values);
    }
  } else if (shape.base === 'uint') {
    gl.uniform1ui(location, uniform.value as number);
  } else {
    gl.uniform1i(location, uniform.value as number);
  }
  return true;
}
