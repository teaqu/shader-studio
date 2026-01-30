import * as path from "path";
import * as fs from "fs";

// Use __non_webpack_require__ to bypass webpack bundling which breaks glsl-transpiler's stdlib
// Otherwise some files break with "Cannot find module" errors at runtime e.g. shaders with length()
// Load from vendor directory
// have directly in repo to avoid packaging issues for now.
declare const __non_webpack_require__: typeof require | undefined;

// Determine the correct path to vendor folder based on runtime context
// - Webpack bundle (dist/): __dirname is 'dist/', vendor at 'dist/vendor/'
// - TypeScript output (out/): __dirname is 'out/app/', vendor at 'src/vendor/' (relative to extension root)
function getGlslTranspilerPath(): string {
    if (typeof __non_webpack_require__ !== 'undefined') {
        // Webpack bundle - vendor is copied to dist/vendor/
        return path.join(__dirname, '..', 'vendor', 'glsl-transpiler');
    } else {
        // TypeScript output - vendor is in src/vendor/ (extension root)
        return path.join(__dirname, '..', '..', 'vendor', 'glsl-transpiler');
    }
}

const glslDepsPath = getGlslTranspilerPath();
// Use __non_webpack_require__ when available (webpack bundle), fallback to regular require (tests)
const glslTranspiler = (typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__(glslDepsPath) : require(glslDepsPath)).default;

export class GlslToJsTranspiler {
  static transpileFile(uri: { fsPath: string }): string | undefined {
    if (!uri.fsPath.endsWith(".glsl") && !uri.fsPath.endsWith(".frag") && !uri.fsPath.endsWith(".vert")) {
      throw new Error("Selected file is not a GLSL shader.");
    }
    const glslSource = fs.readFileSync(uri.fsPath, "utf8");
    // Parse uniforms and common buffer (simple regex, can be improved)
    const uniforms = Array.from(glslSource.matchAll(/uniform\s+([\w\d_]+)\s+([\w\d_]+)\s*;/g)).map(m => ({ type: m[1], name: m[2] }));
    const commonBuffer = Array.from(glslSource.matchAll(/buffer\s+([\w\d_]+)\s*\{([^}]*)\}/g)).map(m => ({ name: m[1], content: m[2] }));

    // Add default ShaderToy uniforms if not present
    const defaultUniforms = [
      { type: 'vec3', name: 'iResolution' },
      { type: 'float', name: 'iTime' },
      { type: 'float', name: 'iTimeDelta' },
      { type: 'float', name: 'iFrameRate' },
      { type: 'sampler2D', name: 'iChannel0' },
      { type: 'sampler2D', name: 'iChannel1' },
      { type: 'sampler2D', name: 'iChannel2' },
      { type: 'sampler2D', name: 'iChannel3' },
      { type: 'vec4', name: 'iMouse' },
      { type: 'int', name: 'iFrame' },
      { type: 'vec4', name: 'iDate' },
    ];
    const allUniforms = [
      ...defaultUniforms.filter(def => !uniforms.some(u => u.name === def.name)),
      ...uniforms
    ];

    // Transpile
    const transpile = glslTranspiler();
    const jsCode = transpile(glslSource);

    // Emit JS variable declarations for uniforms
    function jsUniformInit(type: string, name: string) {
      if (name === 'iResolution') return `let iResolution = [960, 540, 1];`;
      switch(type) {
        case 'vec3': return `let ${name} = [0,0,0];`;
        case 'vec4': return `let ${name} = [0,0,0,0];`;
        case 'float': return `let ${name} = 0.0;`;
        case 'int': return `let ${name} = 0;`;
        case 'sampler2D': return `let ${name} = null;`;
        default: return `let ${name};`;
      }
    }
    const uniformDecls = allUniforms.map(u => jsUniformInit(u.type, u.name)).join("\n");

    // Compose output with buffer info only, no uniform comments
    let output = `// Transpiled from GLSL\n`;
    if (commonBuffer.length) {
      output += `// Common Buffers:\n` + commonBuffer.map(b => `//   ${b.name}: ${b.content.trim().replace(/\n/g, " ")}`).join("\n") + "\n";
    }
    output += "\n" + uniformDecls + "\n" + jsCode + "\nlet fragColor = [0,0,0,0];\nlet fragCoord = [0,0];\nmainImage(fragColor, fragCoord);\n ";
    return output;
  }

  static writeTranspiledFile(uri: { fsPath: string }, output: string): string {
    const outPath = uri.fsPath.replace(/\.(glsl|frag|vert)$/i, ".transpiled.js");
    fs.writeFileSync(outPath, output, "utf8");
    return outPath;
  }
}
