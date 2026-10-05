import { getShaderSourceFunctions } from "@shader-studio/types";

/** Native fragment-output and device-limit checks shared by MRT pipelines. */
export function validateMrtPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  outputCount: number,
  source: string,
  fragmentEntryPoint: string | undefined,
): string | undefined {
  if (outputCount <= 1) {
    return undefined;
  }
  const limits = device.limits;
  const attachmentLimit = limits?.maxColorAttachments ?? 8;
  if (outputCount > attachmentLimit) {
    return `MRT requests ${outputCount} colour attachments but this device supports ${attachmentLimit}`;
  }
  const byteLimit = limits?.maxColorAttachmentBytesPerSample ?? 32;
  const bytes = outputCount * colorAttachmentBytes(format);
  if (bytes > byteLimit) {
    return `MRT attachments require ${bytes} bytes per sample but this device supports ${byteLimit}`;
  }
  return validateNativeOutputs(source, fragmentEntryPoint, outputCount);
}

export function nativeFragmentWritesDepth(source: string, fragmentEntryPoint: string | undefined): boolean {
  const output = nativeFragmentOutput(source, fragmentEntryPoint);
  return output !== undefined && /@builtin\(frag_depth\)/.test(output);
}

function colorAttachmentBytes(format: GPUTextureFormat): number {
  return format === "rgba32float" ? 16 : 8;
}

function validateNativeOutputs(source: string, entryPoint: string | undefined, outputCount: number): string | undefined {
  const output = nativeFragmentOutput(source, entryPoint);
  if (output === undefined) {
    return "MRT requires a selected native fragment entry point with contiguous vec4 colour outputs";
  }
  const locations = [...output.matchAll(/@location\((\d+)\)\s*(?:[A-Za-z_]\w*\s*:\s*)?vec4(?:<\s*f32\s*>)?f?\b/g)]
    .map((match) => Number(match[1])).sort((a, b) => a - b);
  if (locations.length !== outputCount || locations.some((location, index) => location !== index)) {
    return `MRT fragment output must declare contiguous @location(0..${outputCount - 1}) vec4 colours`;
  }
  return undefined;
}

function nativeFragmentOutput(source: string, entryPoint: string | undefined): string | undefined {
  if (!entryPoint) {
    return undefined;
  }
  const entry = getShaderSourceFunctions(source, "wgsl").find(fn => fn.name === entryPoint && fn.stage === "fragment");
  if (!entry) {
    return undefined;
  }
  const header = source.slice(entry.start, entry.bodyStart - 1);
  const arrow = header.lastIndexOf("->");
  if (arrow < 0) {
    return undefined;
  }
  const returnType = header.slice(arrow + 2).trim();
  if (returnType.startsWith("@location")) {
    return returnType;
  }
  const struct = new RegExp(`struct\\s+${escapeRegex(returnType.split(/\\s/)[0] ?? "")}\\s*\\{([\\s\\S]*?)\\}`, "m").exec(source);
  return struct?.[1];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
