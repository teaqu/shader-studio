import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";
import { NEW_SLANG_FILE_LANGUAGE_VERSION } from "@shader-studio/slang-language-service";

const SLANG_RESERVED_MODULE_NAMES = new Set([
  // Keep this list aligned with the keywords, modifiers, and built-in type names in the Slang grammar.
  "associatedtype", "break", "case", "class", "const", "continue", "default", "discard", "do", "else",
  "each", "enum", "expand", "extension", "extern", "false", "for", "func", "generic",
  "if", "implementing", "import", "in", "inline", "inout", "int", "interface", "internal", "let", "module", "namespace", "none",
  "null", "operator", "out", "private", "property", "public", "ref", "return", "static", "struct", "switch",
  "this", "This", "true", "typedef", "typealias", "uniform", "using", "var", "where", "while",
  "centroid", "differentiable", "globallycoherent", "groupshared", "mutating", "no_diff", "nointerpolation",
  "nonmutating", "precise", "sample", "linear", "volatile",
  "bool", "double", "float", "half", "int", "uint", "void",
  "bool2", "bool3", "bool4", "double2", "double3", "double4", "float2", "float3", "float4",
  "half2", "half3", "half4", "int2", "int3", "int4", "uint2", "uint3", "uint4",
  "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
  "vector", "matrix", "Buffer", "ByteAddressBuffer", "ConstantBuffer", "ParameterBlock",
  "RaytracingAccelerationStructure", "RWBuffer", "RWByteAddressBuffer", "RWStructuredBuffer",
  "RWTexture1D", "RWTexture1DArray", "RWTexture2D", "RWTexture2DArray", "RWTexture3D", "RWTexture3DArray",
  "SamplerComparisonState", "SamplerState", "StructuredBuffer", "Texture1D", "Texture1DArray",
  "Texture2D", "Texture2DArray", "Texture3D", "Texture3DArray", "TextureCube", "TextureCubeArray",
]);

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
    if (filePath.toLowerCase().endsWith(".slang")) {
      const basename = path.basename(filePath, path.extname(filePath))
        .replace(/[^a-zA-Z0-9_]/g, "_") || "shader";
      const moduleName = /^[0-9]/.test(basename) || SLANG_RESERVED_MODULE_NAMES.has(basename)
        ? `_${basename}`
        : basename;
      return `#language slang ${NEW_SLANG_FILE_LANGUAGE_VERSION}
module ${moduleName};

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    return float4(uv, 0.0, 1.0);
}`;
    }
    return this.getGlslShaderTemplate();
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
        filters: {
          "GLSL Shader": ["glsl"],
          "Slang Shader": ["slang"],
        },
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
