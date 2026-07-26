import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";

interface SaveFilePayload {
  data: string;
  defaultName: string;
  filters: Record<string, string[]>;
}

interface ExportSlangImageOptions {
  engine: Pick<RenderingEngine, "compileImageTarget">;
  path: string;
  saveFile: (payload: SaveFilePayload) => void;
  reportError: (message: string) => void;
}

export function hlslExportPath(sourcePath: string): string {
  if (!sourcePath) {
    return "shader.hlsl";
  }
  return /\.slang$/i.test(sourcePath)
    ? sourcePath.replace(/\.slang$/i, ".hlsl")
    : `${sourcePath}.hlsl`;
}

export async function exportSlangImageToHlsl({
  engine,
  path,
  saveFile,
  reportError,
}: ExportSlangImageOptions): Promise<boolean> {
  if (!engine.compileImageTarget) {
    reportError("HLSL export is unavailable for the current shader");
    return false;
  }

  try {
    const result = await engine.compileImageTarget("HLSL");
    if (!result.success) {
      for (const error of result.errors) {
        reportError(error);
      }
      return false;
    }
    saveFile({
      data: bytesToBase64(new TextEncoder().encode(result.code)),
      defaultName: hlslExportPath(path),
      filters: { "HLSL files": ["hlsl"] },
    });
    return true;
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
