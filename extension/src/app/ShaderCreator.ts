import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { NEW_SLANG_FILE_LANGUAGE_VERSION } from "@shader-studio/types";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";

const SLANG_RESERVED_MODULE_NAMES = new Set([
  // Keywords and declaration modifiers.
  "__builtin", "__target_intrinsic", "asm", "break", "case", "catch", "cbuffer",
  "class", "const", "continue", "default", "defer", "discard", "do", "each", "else",
  "enum", "export", "extern", "false", "for", "foreach", "from", "get", "if", "import",
  "in", "inout", "interface", "let", "module", "namespace", "new", "nullptr", "out",
  "override", "private", "protected", "public", "ref", "return", "set", "shared", "sizeof",
  "static", "struct", "switch", "this", "throw", "true", "try", "typedef", "typealias",
  "union", "using", "var", "void", "while",
  // Scalar, vector, matrix, and resource types that are concrete built-ins.
  "bool", "double", "float", "half", "int", "int16_t", "int32_t", "int64_t", "int8_t",
  "uint", "uint16_t", "uint32_t", "uint64_t", "uint8_t",
  "bool2", "bool3", "bool4", "double2", "double3", "double4", "float2", "float3", "float4",
  "half2", "half3", "half4", "int2", "int3", "int4", "uint2", "uint3", "uint4",
  "float1x1", "float1x2", "float1x3", "float1x4", "float2x1", "float2x2", "float2x3",
  "float2x4", "float3x1", "float3x2", "float3x3", "float3x4", "float4x1", "float4x2",
  "float4x3", "float4x4", "SamplerComparisonState", "SamplerState", "Texture1D", "Texture1DArray",
  "Texture2D", "Texture2DArray", "Texture2DMS", "Texture2DMSArray", "Texture3D", "TextureCube",
  "TextureCubeArray", "RWTexture1D", "RWTexture1DArray", "RWTexture2D", "RWTexture2DArray",
  "RWTexture3D",
]);

function sanitizeSlangModuleName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9_]/g, "_") || "shader";
  return /^[0-9]/.test(sanitized) || SLANG_RESERVED_MODULE_NAMES.has(sanitized)
    ? `_${sanitized}`
    : sanitized;
}

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
