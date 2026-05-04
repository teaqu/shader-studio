# JavaScript Transpilation

Shader Studio can transpile GLSL shaders to JavaScript for debugging using the [`glsl-transpiler`](https://github.com/stackgl/glsl-transpiler) library. This lets you step through shader execution with the VS Code debugger — breakpoints, variable inspection, and line-by-line stepping.

## Running

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **Shader Studio: Transpile GLSL to JavaScript (for debugging)**.

You can run it on the active editor, or right-click a `.glsl`, `.frag`, or `.vert` file in the explorer and select the command.

## Output

A `.transpiled.js` file is generated next to the shader. For example, `shader.glsl` becomes `shader.transpiled.js`.

The output includes:

- Default ShaderToy uniforms (`iResolution`, `iTime`, `iMouse`, etc.) initialised with sensible defaults
- The transpiled shader code converted to JavaScript
- A call to `mainImage(fragColor, fragCoord)` at the bottom

You can then open the `.transpiled.js` file, set breakpoints, and run it with the VS Code Node.js debugger.
