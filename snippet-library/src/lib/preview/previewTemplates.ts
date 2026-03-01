import type { SnippetCategory } from '../types/Snippet';

/**
 * Strip VS Code snippet placeholders:
 * ${1:value} → value
 * ${1|one,two|} → one
 * $0, $1 etc → removed
 */
export function stripSnippetPlaceholders(code: string): string {
    // ${1:value} → value
    let result = code.replace(/\$\{\d+:([^}]+)\}/g, '$1');
    // ${1|one,two|} → one (choice placeholders)
    result = result.replace(/\$\{\d+\|([^,|}]+)[^}]*\}/g, '$1');
    // $0, $1 etc → empty
    result = result.replace(/\$\d+/g, '');
    return result;
}

// Shared raymarch infrastructure — three-point lighting, checker pattern, iMouse camera
const RAYMARCH_COMMON = `
vec3 calcNormal(vec3 p) {
    const float h = 0.0001;
    const vec2 k = vec2(1, -1);
    return normalize(
        k.xyy * map(p + k.xyy * h) +
        k.yyx * map(p + k.yyx * h) +
        k.yxy * map(p + k.yxy * h) +
        k.xxx * map(p + k.xxx * h)
    );
}

float rayMarch(vec3 ro, vec3 rd) {
    float t = 0.0;
    for (int i = 0; i < 128; i++) {
        vec3 p = ro + rd * t;
        float d = map(p);
        if (d < 0.001 || t > 100.0) break;
        t += d;
    }
    return t;
}

vec3 render(vec2 uv, vec3 baseColor, vec3 rimColor) {
    // iMouse camera with auto-orbit fallback (offset angle so thumbnail shows 3D depth)
    vec2 mo = iMouse.xy / iResolution.xy;
    float angleX = (iMouse.z > 0.0 ? mo.x * 6.28 : iTime * 0.5 + 0.8);
    float angleY = (iMouse.z > 0.0 ? mo.y * 3.14 - 1.57 : 0.6);
    vec3 ro = vec3(
        2.5 * cos(angleX) * cos(angleY),
        1.8 * sin(angleY) + 1.0,
        2.5 * sin(angleX) * cos(angleY)
    );
    vec3 ta = vec3(0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.8 * ww);

    float t = rayMarch(ro, rd);

    // Gradient background
    vec3 col = mix(vec3(0.08, 0.08, 0.12), vec3(0.15, 0.15, 0.22), uv.y * 0.5 + 0.5);

    if (t < 100.0) {
        vec3 p = ro + rd * t;
        vec3 n = calcNormal(p);

        // Three-point lighting
        vec3 keyLight = normalize(vec3(0.6, 0.8, -0.5));
        vec3 fillLight = normalize(vec3(-0.5, 0.3, 0.6));

        float diff = max(dot(n, keyLight), 0.0);
        float fill = max(dot(n, fillLight), 0.0) * 0.4;
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.5;
        float amb = 0.08;

        col = baseColor * (diff + fill + amb) + rimColor * rim;
    }

    col = pow(col, vec3(1.0 / 2.2));
    return col;
}
`;

type TemplateBuilder = (snippetCode: string, callExpr: string) => string;

const sdf2dTemplate: TemplateBuilder = (snippetCode, callExpr) => `
${snippetCode}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    vec2 p = uv;

    // Dark purple background
    vec3 bg = mix(vec3(0.06, 0.04, 0.10), vec3(0.12, 0.08, 0.18), uv.y * 0.5 + 0.5);

    // Grid at 0.5 spacing (resolution-aware thickness)
    float px = 1.5 / iResolution.y;
    float grid = smoothstep(px, 0.0, min(
        abs(mod(p.x + 0.25, 0.5) - 0.25),
        abs(mod(p.y + 0.25, 0.5) - 0.25)));
    bg += grid * 0.06;

    // Axes
    float axes = smoothstep(px * 1.5, 0.0, min(abs(p.x), abs(p.y)));
    bg += axes * 0.12;

    float d = ${callExpr};

    // Filled shape interior
    vec3 fillColor = vec3(0.55, 0.3, 0.85);
    float interior = 1.0 - smoothstep(-0.005, 0.005, d);

    // Thin border line
    float border = smoothstep(0.02, 0.0, abs(d));

    vec3 col = bg;
    col = mix(col, fillColor, interior);
    col = mix(col, vec3(0.85, 0.65, 1.0), border * 0.7);

    col = pow(col, vec3(1.0 / 2.2));
    fragColor = vec4(col, 1.0);
}
`;

const sdf3dTemplate: TemplateBuilder = (snippetCode, callExpr) => `
${snippetCode}

float map(vec3 p) {
    return ${callExpr};
}

${RAYMARCH_COMMON}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    vec3 col = render(uv, vec3(0.3, 0.55, 0.9), vec3(0.5, 0.7, 1.0));
    fragColor = vec4(col, 1.0);
}
`;

const mathTemplate: TemplateBuilder = (snippetCode, callExpr) => `
${snippetCode}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = uv;

    float v = ${callExpr};
    vec3 col = vec3(v);

    fragColor = vec4(col, 1.0);
}
`;

const coordinatesTemplate: TemplateBuilder = (snippetCode, callExpr) => `
${snippetCode}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    vec2 p = uv;

    vec2 tc = ${callExpr};

    // Color-code coordinates with grid overlay
    vec3 col = vec3(tc * 0.5 + 0.5, 0.5);
    float grid = smoothstep(0.02, 0.0, min(fract(tc.x * 4.0), fract(tc.y * 4.0)));
    col = mix(col, vec3(1.0), grid * 0.3);

    fragColor = vec4(col, 1.0);
}
`;

const categoryTemplates: Partial<Record<SnippetCategory, TemplateBuilder>> = {
    'sdf-2d': sdf2dTemplate,
    'sdf-3d': sdf3dTemplate,
    'math': mathTemplate,
    'coordinates': coordinatesTemplate,
    'custom': sdf2dTemplate,
};

/**
 * Build a full preview shader for a snippet.
 * Returns null if the snippet can't be previewed (no call expression, no template, no example).
 */
export function buildPreviewShader(
    body: string[],
    call: string | undefined,
    category: SnippetCategory,
    example?: string[],
    prefix?: string,
): string | null {
    const rawCode = body.join('\n');
    const code = stripSnippetPlaceholders(rawCode);

    // Priority 1: example field — complete self-contained shader or preview code
    if (example && example.length > 0) {
        const exampleCode = stripSnippetPlaceholders(example.join('\n'));
        if (exampleCode.includes('mainImage')) {
            return exampleCode;
        }
        // For custom snippets, try last-line preview on example (which includes the preview line)
        if (category === 'custom') {
            const preview = buildLastLinePreview(exampleCode);
            if (preview) return preview;
        }
    }

    // If the snippet body itself contains mainImage, treat it as a complete shader
    if (code.includes('mainImage')) {
        return code;
    }

    // No call expression → try debugger-style last-line preview for custom snippets
    if (!call) {
        if (category === 'custom') {
            return buildLastLinePreview(code);
        }
        return null;
    }

    const template = categoryTemplates[category];
    if (!template) {
        return null;
    }

    return template(code, call);
}

/**
 * Detect a variable declaration or assignment on a line and return its name and type.
 * Mirrors the logic from the debug library's GlslParser.detectVariableAndType.
 */
function detectVariableAndType(line: string): { name: string; type: string } | null {
    // Variable declarations: float x = ..., vec3 col = ...
    const declPatterns = [
        /\s*(vec4)\s+(\w+)\s*=/,
        /\s*(vec3)\s+(\w+)\s*=/,
        /\s*(vec2)\s+(\w+)\s*=/,
        /\s*(float)\s+(\w+)\s*=/,
        /\s*(mat2)\s+(\w+)\s*=/,
        /\s*(mat3)\s+(\w+)\s*=/,
        /\s*(mat4)\s+(\w+)\s*=/,
        /\s*(int)\s+(\w+)\s*=/,
        /\s*(bool)\s+(\w+)\s*=/,
    ];

    for (const pattern of declPatterns) {
        const match = line.match(pattern);
        if (match) {
            return { name: match[2], type: match[1] };
        }
    }

    return null;
}

/**
 * Generate a fragColor assignment that visualizes a variable as vec4.
 * Mirrors CodeGenerator.generateReturnStatementForVar from the debug library.
 */
function generateVec4Assignment(type: string, varName: string): string {
    switch (type) {
        case 'float':
            return `fragColor = vec4(vec3(${varName}), 1.0);`;
        case 'vec2':
            return `fragColor = vec4(${varName}, 0.0, 1.0);`;
        case 'vec3':
            return `fragColor = vec4(${varName}, 1.0);`;
        case 'vec4':
            return `fragColor = ${varName};`;
        case 'mat2':
            return `fragColor = vec4(${varName}[0], ${varName}[1]);`;
        case 'mat3':
            return `fragColor = vec4(${varName}[0], 1.0);`;
        case 'mat4':
            return `fragColor = ${varName}[0];`;
        case 'int':
            return `fragColor = vec4(vec3(float(${varName})), 1.0);`;
        case 'bool':
            return `fragColor = vec4(vec3(${varName} ? 1.0 : 0.0), 1.0);`;
        default:
            return `fragColor = vec4(1.0, 0.0, 1.0, 1.0);`;
    }
}

/**
 * Scan source lines for a function definition and return its return type.
 */
function findFunctionReturnType(lines: string[], funcName: string): string | null {
    const pattern = new RegExp(`^\\s*(float|vec[234]|mat[234]|void|int|bool)\\s+${funcName}\\s*\\(`);
    for (const line of lines) {
        const match = line.match(pattern);
        if (match) return match[1];
    }
    return null;
}

/**
 * Split code into top-level function definitions (which must go outside mainImage)
 * and loose statements (which go inside mainImage).
 * GLSL doesn't allow nested function definitions.
 */
function splitFunctionsAndStatements(code: string): { functions: string; statements: string } {
    const lines = code.split('\n');
    const funcLines: string[] = [];
    const stmtLines: string[] = [];
    let inFunction = false;
    let braceDepth = 0;

    for (const line of lines) {
        if (!inFunction) {
            // Detect function definition start: returnType funcName(...)
            const funcMatch = line.match(/^\s*(?:float|vec[234]|mat[234]|void|int|bool)\s+\w+\s*\(/);
            if (funcMatch && (line.includes('{') || line.trim().endsWith(')'))) {
                inFunction = true;
                braceDepth = 0;
                for (const ch of line) {
                    if (ch === '{') braceDepth++;
                    if (ch === '}') braceDepth--;
                }
                funcLines.push(line);
                if (braceDepth === 0 && line.includes('{')) {
                    inFunction = false;
                }
                continue;
            }
        }

        if (inFunction) {
            for (const ch of line) {
                if (ch === '{') braceDepth++;
                if (ch === '}') braceDepth--;
            }
            funcLines.push(line);
            if (braceDepth <= 0) {
                inFunction = false;
            }
        } else {
            stmtLines.push(line);
        }
    }

    return {
        functions: funcLines.join('\n'),
        statements: stmtLines.join('\n'),
    };
}

/**
 * Build a preview shader by wrapping all code in a mainImage and visualizing
 * the last non-empty line's variable as a vec4 color output.
 * Similar to the debugger's wrapOneLinerForDebugging / wrapFunctionForDebugging.
 */
function buildLastLinePreview(code: string): string | null {
    const lines = code.split('\n');

    // Find the last non-empty, non-comment line
    let lastLine = '';
    for (let i = lines.length - 1; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (trimmed && !trimmed.startsWith('//')) {
            lastLine = trimmed;
            break;
        }
    }

    if (!lastLine) return null;

    // Try to detect a variable and type on the last line
    let varInfo = detectVariableAndType(lastLine);

    // If no variable declaration, try standalone function call: funcName(...);
    if (!varInfo) {
        const funcCallMatch = lastLine.match(/^\s*(\w+)\s*\(/);
        if (funcCallMatch) {
            const funcName = funcCallMatch[1];
            const returnType = findFunctionReturnType(lines, funcName);
            if (returnType && returnType !== 'void') {
                // Rewrite the last line to capture the result
                const callExpr = lastLine.replace(/;$/, '');
                const rewrittenLine = `${returnType} _dbgCall = ${callExpr};`;
                // Replace the last line in the code
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i].trim() === lastLine) {
                        lines[i] = rewrittenLine;
                        break;
                    }
                }
                code = lines.join('\n');
                varInfo = { name: '_dbgCall', type: returnType };
            }
        }
    }

    if (!varInfo) return null;

    const assignment = generateVec4Assignment(varInfo.type, varInfo.name);

    // Split functions (go outside mainImage) from statements (go inside)
    const { functions, statements } = splitFunctionsAndStatements(code);

    const funcBlock = functions.trim() ? functions + '\n\n' : '';
    const stmtBlock = statements.split('\n').map(l => '    ' + l).join('\n');

    return `${funcBlock}void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
${stmtBlock}
    ${assignment}
}`;
}
