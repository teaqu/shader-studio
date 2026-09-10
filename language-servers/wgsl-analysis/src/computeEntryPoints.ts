import { tokenizeWgsl } from "./tokenizer.js";

export interface WgslComputeEntryPoint {
  name: string;
  workgroupSize: [number, number, number];
}

/** Finds shader-owned compute entries and their literal workgroup dimensions. */
export function getWgslComputeEntryPoints(source: string): WgslComputeEntryPoint[] {
  const tokens = tokenizeWgsl(source);
  const entries: WgslComputeEntryPoint[] = [];

  for (let fnIndex = 0; fnIndex < tokens.length; fnIndex += 1) {
    if (tokens[fnIndex]?.text !== "fn" || tokens[fnIndex + 1]?.kind !== "identifier") {
      continue;
    }
    const attributes = attributesBeforeFunction(tokens, fnIndex);
    if (!attributes.compute || attributes.invalidWorkgroup) {
      continue;
    }
    entries.push({
      name: tokens[fnIndex + 1]!.text,
      workgroupSize: attributes.workgroupSize ?? [1, 1, 1],
    });
  }
  return entries;
}

function attributesBeforeFunction(
  tokens: ReturnType<typeof tokenizeWgsl>,
  fnIndex: number,
): { compute: boolean; workgroupSize?: [number, number, number]; invalidWorkgroup: boolean } {
  let start = fnIndex - 1;
  while (start >= 0 && tokens[start]?.text !== "}" && tokens[start]?.text !== ";") {
    start -= 1;
  }

  let compute = false;
  let workgroupSize: [number, number, number] | undefined;
  let invalidWorkgroup = false;
  for (let index = start + 1; index < fnIndex; index += 1) {
    if (tokens[index]?.kind !== "attribute") {
      continue;
    }
    const name = tokens[index + 1]?.text;
    if (name === "compute") {
      compute = true;
    } else if (name === "workgroup_size") {
      const parsed = parseWorkgroupSize(tokens, index + 2);
      if (parsed === undefined) {
        invalidWorkgroup = true;
      } else {
        workgroupSize = parsed.size;
        index = parsed.endIndex - 1;
      }
    }
  }
  return { compute, workgroupSize, invalidWorkgroup };
}

function parseWorkgroupSize(
  tokens: ReturnType<typeof tokenizeWgsl>,
  startIndex: number,
): { size: [number, number, number]; endIndex: number } | undefined {
  if (tokens[startIndex]?.text !== "(") {
    return undefined;
  }
  const dimensions: number[] = [];
  let index = startIndex + 1;
  while (dimensions.length < 3) {
    const token = tokens[index];
    if (!token || token.kind !== "intLiteral" || !/^\d+$/.test(token.text)) {
      return undefined;
    }
    const dimension = Number(token.text);
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      return undefined;
    }
    dimensions.push(dimension);
    index += 1;
    if (tokens[index]?.text !== ",") {
      break;
    }
    index += 1;
  }
  if (tokens[index]?.text !== ")") {
    return undefined;
  }
  return {
    size: [dimensions[0]!, dimensions[1] ?? 1, dimensions[2] ?? 1],
    endIndex: index + 1,
  };
}
