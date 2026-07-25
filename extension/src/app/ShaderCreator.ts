import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { NEW_SLANG_FILE_LANGUAGE_VERSION } from "@shader-studio/types";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";

const SLANG_RESERVED_MODULE_NAMES = new Set([
  // Declaration, control-flow, and storage words in syntaxes/slang.tmLanguage.json.
  "associatedtype", "break", "case", "centroid", "class", "const", "continue", "default", "differentiable",
  "discard", "do", "each", "else", "enum", "expand", "extension", "extern", "false", "for", "func", "generic", "globallycoherent",
  "groupshared", "if", "implementing", "import", "in", "inline", "inout", "interface", "internal",
  "let", "linear", "module", "mutating", "namespace", "no_diff", "nointerpolation", "nonmutating",
  "operator", "out", "precise", "private", "property", "public", "ref", "return", "sample", "static",
  "struct", "switch", "This", "this", "true", "typealias", "typedef", "uniform", "using", "var", "volatile",
  "where", "while", "none", "null",
  // Concrete built-in types in syntaxes/slang.tmLanguage.json.
  "bool", "bool2", "bool3", "bool4", "ByteAddressBuffer", "Buffer", "ConstantBuffer", "double",
  "double2", "double3", "double4", "float", "float16_t", "float32_t", "float64_t", "float2", "float3",
  "float4", "half", "half2", "half3", "half4", "int", "int8_t", "int16_t", "int32_t", "int64_t",
  "int2", "int3", "int4", "matrix", "ParameterBlock", "RaytracingAccelerationStructure", "RWBuffer",
  "RWByteAddressBuffer", "RWStructuredBuffer", "RWTexture1D", "RWTexture1DArray", "RWTexture2D",
  "RWTexture2DArray", "RWTexture3D", "SamplerComparisonState", "SamplerState", "StructuredBuffer",
  "Texture1D", "Texture1DArray", "Texture2D", "Texture2DArray", "Texture3D", "Texture3DArray",
  "TextureCube", "TextureCubeArray", "uint", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "uint2",
  "uint3", "uint4", "vector", "void",
]);

function sanitizeSlangModuleName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9_]/g, "_") || "shader";
  const isMatrixType = /^(?:bool|half|float|double|float(?:16|32|64)_t|int|uint|(?:u?int)(?:8|16|32|64)_t)[2-4]x[2-4]$/.test(sanitized);
  return /^[0-9]/.test(sanitized) || isMatrixType || SLANG_RESERVED_MODULE_NAMES.has(sanitized)
    ? `_${sanitized}`
    : sanitized;
}

/** Test seam for the pure identifier normalization contract. */
export const __testOnly = { sanitizeSlangModuleName };

export class ShaderCreator {
  private logger: Logger;
  private glslFileTracker: GlslFileTracker;

  constructor(logger: Logger, glslFileTracker: GlslFileTracker) {
    this.logger = logger;
    this.glslFileTracker = glslFileTracker;
  }

  private getGlslShaderTemplate(): string {
    return `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));

    // Output to screen
    fragColor = vec4(col,1.0);
}`;
  }

  private getShaderTemplate(filePath: string): string {
    if (!filePath.toLowerCase().endsWith(".slang")) {
      return this.getGlslShaderTemplate();
    }

    const moduleName = sanitizeSlangModuleName(
      path.basename(filePath, path.extname(filePath)),
    );
    return `#language slang ${NEW_SLANG_FILE_LANGUAGE_VERSION}
module ${moduleName};

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    return float4(uv, 0.0, 1.0);
}`;
  }

  private getDefaultUri(): vscode.Uri {
    const lastViewedFile = this.glslFileTracker.getLastViewedGlslFile();
    if (lastViewedFile) {
      return vscode.Uri.file(path.join(path.dirname(lastViewedFile), "shadertoy.glsl"));
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, "shadertoy.glsl"));
    }

    return vscode.Uri.file("shadertoy.glsl");
  }

  async create(): Promise<void> {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: this.getDefaultUri(),
        filters: { "GLSL Shader": ["glsl"], "Slang Shader": ["slang"] },
        title: "New Shader",
      });

      // User cancelled
      if (!uri) {
        return;
      }

      const filePath = uri.fsPath;

      // Create a basic shader template
      const shaderTemplate = this.getShaderTemplate(filePath);

      // Write the shader file
      fs.writeFileSync(filePath, shaderTemplate);

      // Open the newly created file
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: false,
      });

      this.logger.info(`Created new shader file: ${filePath}`);
      vscode.window.showInformationMessage(
        `Created new shader file: ${path.basename(filePath)}`,
      );
    } catch (error) {
      this.logger.error(`Failed to create new shader: ${error}`);
      vscode.window.showErrorMessage(`Failed to create new shader: ${error}`);
    }
  }
}
