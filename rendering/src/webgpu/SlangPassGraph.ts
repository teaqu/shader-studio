import type { ComputePass, ConfigInput, ShaderConfig } from "@shader-studio/types";
import type {
  DispatchSpec,
  RenderPassChannel,
  RenderPassGraph,
  RenderPassName,
  RenderPassNode,
  StorageBindingNode,
} from "../types/PassGraph";
import { assignInputSlots } from "../util/InputSlotAssigner";
import { getNativeComputeEntryPoints } from "./SlangPrelude";
import { resolvePassGeometry } from "../types/Geometry";
import { parseSlangStructs } from "./slangStructSize";

export type {
  ChannelReadTiming,
  RenderPassChannel,
  RenderPassGraph,
  RenderPassName,
  RenderPassNode,
} from "../types/PassGraph";

export interface BuildSlangPassGraphOptions {
  imageCode: string;
  config: ShaderConfig | null;
  buffers: Record<string, string>;
  canvasWidth: number;
  canvasHeight: number;
  /** Limits granted by the active WebGPU device; omitted means portable WebGPU defaults. */
  computeWorkgroupLimits?: ComputeWorkgroupLimits;
  /** Maximum texture array layers for compute output; defaults to the WebGPU spec minimum of 256. */
  maxOutputLayers?: number;
  /** Maximum storage buffers per shader stage for the warning threshold; defaults to 8. */
  maxStorageBuffers?: number;
}

export interface ComputeWorkgroupLimits {
  maxInvocations: number;
  maxSizeX: number;
  maxSizeY: number;
  maxSizeZ: number;
}

export const BUILTIN_STORAGE_TYPES: ReadonlySet<string> = new Set([
  "float", "float2", "float3", "float4",
  "int", "int2", "int3", "int4",
  "uint", "uint2", "uint3", "uint4",
  "Atomic<uint>", "Atomic<int>",
  "float2x2", "float3x3", "float4x4",
]);

/** WGSL storage sizes for built-in element types. Used to auto-fill stride. */
export const BUILTIN_STORAGE_SIZES: ReadonlyMap<string, number> = new Map([
  ["float", 4], ["float2", 8], ["float3", 12], ["float4", 16],
  ["int", 4], ["int2", 8], ["int3", 12], ["int4", 16],
  ["uint", 4], ["uint2", 8], ["uint3", 12], ["uint4", 16],
  ["Atomic<uint>", 4], ["Atomic<int>", 4],
  ["float2x2", 16], ["float3x3", 48], ["float4x4", 64],
]);

const SPECIAL_PASS_NAMES = new Set(["common", "Image"]);
const MAX_TOTAL_STORAGE_BYTES = 256 * 1024 * 1024;
const PORTABLE_COMPUTE_WORKGROUP_LIMITS: ComputeWorkgroupLimits = {
  maxInvocations: 256,
  maxSizeX: 256,
  maxSizeY: 256,
  maxSizeZ: 64,
};
const TEXEL_WORKGROUP_SIZE: [number, number, number] = [8, 8, 1];
const COUNT_WORKGROUP_SIZE: [number, number, number] = [64, 1, 1];
/** Bounds synchronous iDispatch allocation and per-frame command encoding work. */
export const MAX_COMPUTE_DISPATCH_COUNT = 1024;

export function isComputePass(pass: unknown): pass is ComputePass {
  return isRecord(pass) && pass.type === "compute";
}

export function buildSlangPassGraph(options: BuildSlangPassGraphOptions): RenderPassGraph {
  const canvasWidth = Math.max(1, Math.round(options.canvasWidth));
  const canvasHeight = Math.max(1, Math.round(options.canvasHeight));
  const warnings: string[] = [];
  const errors: string[] = [];
  const config = options.config;

  if (!config?.passes) {
    return {
      passes: [createImagePass(options.imageCode, canvasWidth, canvasHeight, [], resolvePassGeometry(undefined), options.buffers["__shader_studio_vertex__:Image"])],
      storage: [],
      commonCode: "",
      warnings,
      errors,
    };
  }

  const commonCode = options.buffers.common?.trim() ?? "";
  const passEntries = Object.entries(config.passes).filter(([name, passConfig]) => {
    if (SPECIAL_PASS_NAMES.has(name) || passConfig === undefined) {
      return true;
    }
    if (!isRecord(passConfig) || Array.isArray(passConfig)) {
      errors.push(`${name}: Pass configuration must be an object`);
      return false;
    }
    return true;
  });
  const configuredBufferNames = new Set(
    passEntries
      .filter(([name, passConfig]) => !SPECIAL_PASS_NAMES.has(name) && passConfig !== undefined)
      .map(([name]) => name),
  );
  // Collect all Slang source files so we can parse struct definitions and
  // auto-infer strides for custom types without needing compilation first.
  const allSources = [options.imageCode, commonCode, ...Object.values(options.buffers).filter((v): v is string => typeof v === "string")];
  const parsedStructs = parseSlangStructs(allSources);
  const outputLayersByPass = resolveOutputLayersByPass(passEntries, errors, options.maxOutputLayers ?? 256);
  const storage = resolveStorage(config.storage, warnings, errors, options.maxStorageBuffers ?? 8, parsedStructs);
  warnOnCustomStorageReferencesInCommon(storage, commonCode, warnings);
  const storageNames = new Set(storage.map(({ name }) => name));
  const computePasses: RenderPassNode[] = [];
  const renderPasses: RenderPassNode[] = [];

  for (const [name, passConfig] of passEntries) {
    if (SPECIAL_PASS_NAMES.has(name) || passConfig === undefined) {
      continue;
    }

    const path = "path" in passConfig ? passConfig.path : undefined;
    const source = options.buffers[name] ?? "";
    if (source.trim() === "") {
      const pathInfo = path ? ` (path: "${path}")` : "";
      errors.push(`${name}: Buffer file not found or is empty${pathInfo}`);
      continue;
    }

    const resolution = resolvePassResolution({
      passName: name,
      passConfig,
      canvasWidth,
      canvasHeight,
      errors,
    });
    const inputs = passConfig.inputs ?? {};
    const channels = resolveChannels({
      passName: name,
      inputs,
      configuredBufferNames,
      outputLayersByPass,
      warnings,
      errors,
    });

    if (isComputePass(passConfig)) {
      const computeConfig = passConfig as ComputePass;
      const dispatch = resolveDispatch(name, computeConfig.dispatch, storageNames, channels, errors);
      const defaultWorkgroupSize = dispatch.mode === "count" ? COUNT_WORKGROUP_SIZE : TEXEL_WORKGROUP_SIZE;
      const nativeEntries = getNativeComputeEntryPoints(source);
      const requestedEntryPoint = computeConfig.entryPoint;
      const nativeEntryPoint = requestedEntryPoint
        ? nativeEntries.find(({ name }) => name === requestedEntryPoint)
        : nativeEntries.length === 1 ? nativeEntries[0] : undefined;
      if (!nativeEntryPoint) {
        if (requestedEntryPoint) {
          errors.push(`${name}: entry point "${requestedEntryPoint}" was not found in its compute source`);
        } else if (nativeEntries.length > 1) {
          errors.push(`${name}: compute source has multiple entry points; select one in the config UI`);
        } else {
          errors.push(`${name}: compute source must declare a native \`[shader("compute")]\` entry point`);
        }
        continue;
      }
      const dispatchCount = resolveDispatchCount(name, computeConfig.dispatchCount, errors);
      const dispatchOnce = resolveDispatchOnce(name, computeConfig.dispatchOnce, errors);
      if (dispatchOnce && dispatchCount > 1) {
        errors.push(`${name}: dispatchOnce cannot be combined with dispatchCount greater than 1`);
      }

      computePasses.push({
        name,
        source,
        path,
        kind: "compute",
        geometry: "fullscreen",
        output: "none",
        outputLayers: outputLayersByPass.get(name) ?? 1,
        dispatch,
        dispatchCount,
        dispatchOnce,
        workgroupSize: resolveWorkgroupSize(
          name,
          nativeEntryPoint?.workgroupSize,
          defaultWorkgroupSize,
          options.computeWorkgroupLimits ?? PORTABLE_COMPUTE_WORKGROUP_LIMITS,
          errors,
        ),
        entryPoint: nativeEntryPoint.name,
        width: resolution.width,
        height: resolution.height,
        channels,
      });
      continue;
    }

    renderPasses.push({
      name,
      source,
      geometry: resolvePassGeometry(passConfig),
      ...resolveModelGeometry(passConfig),
      vertexSrc: options.buffers[`__shader_studio_vertex__:${name}`],
      path,
      kind: "render",
      output: "texture",
      outputLayers: 1,
      dispatchCount: 1,
      dispatchOnce: false,
      workgroupSize: [...TEXEL_WORKGROUP_SIZE],
      width: resolution.width,
      height: resolution.height,
      channels,
    });
  }

  const imageConfig = config.passes.Image;
  const imageChannels = resolveChannels({
    passName: "Image",
    inputs: imageConfig?.inputs ?? {},
    configuredBufferNames,
    outputLayersByPass,
    warnings,
    errors,
  });
  const imagePass = createImagePass(options.imageCode, canvasWidth, canvasHeight, imageChannels, resolvePassGeometry(imageConfig), options.buffers["__shader_studio_vertex__:Image"], resolveModelGeometry(imageConfig));
  const passes = [...computePasses, ...renderPasses, imagePass];
  const sampledBufferSources = new Set(passes.flatMap((pass) => pass.channels
    .filter((channel) => channel.kind === "buffer")
    .map((channel) => channel.source)));
  for (const pass of computePasses) {
    pass.output = sampledBufferSources.has(pass.name) ? "texture" : "none";
  }
  assignChannelReadTiming(passes);

  return { passes, storage, commonCode, warnings, errors };
}

function createImagePass(
  source: string,
  width: number,
  height: number,
  channels: RenderPassChannel[],
  geometry: ReturnType<typeof resolvePassGeometry>,
  vertexSrc?: string,
  modelGeometry: { modelPath?: string; modelMesh?: string } = {},
): RenderPassNode {
  return {
    name: "Image",
    source,
    geometry,
    ...modelGeometry,
    vertexSrc,
    kind: "render",
    output: "canvas",
    outputLayers: 1,
    dispatchCount: 1,
    dispatchOnce: false,
    workgroupSize: [...TEXEL_WORKGROUP_SIZE],
    width,
    height,
    channels,
  };
}

function resolveModelGeometry(pass: { geometry?: { type: string; path?: string; mesh?: string; resolved_path?: string } } | undefined): { modelPath?: string; modelMesh?: string } {
  if (pass?.geometry?.type !== "model") {
    return {};
  }
  return { modelPath: pass.geometry.resolved_path ?? pass.geometry.path, modelMesh: pass.geometry.mesh };
}

function resolveOutputLayersByPass(
  passEntries: [string, ShaderConfig["passes"][string]][],
  errors: string[],
  maxLayers: number,
): Map<string, number> {
  const outputLayers = new Map<string, number>();
  for (const [name, passConfig] of passEntries) {
    if (SPECIAL_PASS_NAMES.has(name) || passConfig === undefined) {
      continue;
    }
    if (!isComputePass(passConfig)) {
      outputLayers.set(name, 1);
      continue;
    }

    const configuredLayers = (passConfig as ComputePass).outputLayers;
    if (configuredLayers === undefined) {
      outputLayers.set(name, 1);
    } else if (Number.isInteger(configuredLayers) && configuredLayers >= 1 && configuredLayers <= maxLayers) {
      outputLayers.set(name, configuredLayers);
    } else {
      errors.push(`${name}: outputLayers must be an integer from 1 to ${maxLayers}`);
      outputLayers.set(name, 1);
    }
  }
  return outputLayers;
}

function resolveStorage(
  storageConfig: ShaderConfig["storage"],
  warnings: string[],
  errors: string[],
  maxStorageBuffers: number,
  parsedStructs: Map<string, { size: number; alignment: number }>,
): StorageBindingNode[] {
  const storage: StorageBindingNode[] = [];
  let totalBytes = 0;

  for (const [name, declaration] of Object.entries(storageConfig ?? {})) {
    let valid = true;
    if (!isPositiveInteger(declaration?.count)) {
      errors.push(`Storage ${name}: count must be a positive integer`);
      valid = false;
    }
    const elementType = typeof declaration?.elementType === "string" ? declaration.elementType.trim() : "";
    if (elementType === "") {
      errors.push(`Storage ${name}: elementType is required`);
      valid = false;
    }
    const builtinSize = BUILTIN_STORAGE_SIZES.get(elementType);
    const isBuiltin = BUILTIN_STORAGE_TYPES.has(elementType);

    // Stride is always auto-inferred: from the built-in table for known
    // Slang types, or from parsed struct definitions in source files.
    let stride: number;
    const parsedSize = builtinSize ?? parsedStructs.get(elementType)?.size;
    if (parsedSize !== undefined) {
      stride = parsedSize;
    } else {
      errors.push(`Storage ${name}: cannot determine stride for type "${elementType}" — is the struct defined in a source file?`);
      valid = false;
      stride = 0;
    }

    if (!valid) {
      continue;
    }

    storage.push({
      name,
      binding: storage.length,
      elementType,
      builtin: isBuiltin,
      count: declaration.count,
      stride,
    });
    totalBytes += declaration.count * stride;
  }

  if (storage.length > maxStorageBuffers) {
    warnings.push(
      `Storage uses ${storage.length} buffers but the device supports at most ${maxStorageBuffers}; consider packing buffers`,
    );
  }
  if (totalBytes > MAX_TOTAL_STORAGE_BYTES) {
    errors.push("Total storage size exceeds 256 MiB");
  }
  return storage;
}

function warnOnCustomStorageReferencesInCommon(
  storage: StorageBindingNode[],
  commonCode: string,
  warnings: string[],
): void {
  const identifiers = collectLikelyStorageAccesses(commonCode);
  for (const node of storage) {
    if (node.builtin || !identifiers.has(node.name)) {
      continue;
    }
    warnings.push(
      `Storage "${node.name}" uses custom type "${node.elementType}" and is declared after common, ` +
      `so common cannot reference it; move helpers that access "${node.name}" into a pass source file`,
    );
  }
}

interface SlangToken {
  kind: "identifier" | "symbol";
  text: string;
}

function collectLikelyStorageAccesses(source: string): Set<string> {
  const tokens = collectSlangTokens(source);
  const locallyDeclared = new Set<string>();
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === "identifier" && hasLikelyDeclarationPrefix(tokens, index)) {
      locallyDeclared.add(token.text);
    }
  }

  const identifiers = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      token.kind !== "identifier" ||
      locallyDeclared.has(token.text) ||
      tokens[index + 1]?.text !== "["
    ) {
      continue;
    }
    const previous = tokens[index - 1];
    if (previous?.text === "." || previous?.text === "->") {
      continue;
    }
    if (hasLikelyDeclarationPrefix(tokens, index)) {
      continue;
    }
    identifiers.add(token.text);
  }
  return identifiers;
}

function hasLikelyDeclarationPrefix(tokens: SlangToken[], index: number): boolean {
  const previous = tokens[index - 1];
  if (previous?.text === ",") {
    return isTopLevelDeclarationComma(tokens, index - 1);
  }
  return hasBasicDeclarationPrefix(tokens, index);
}

function hasBasicDeclarationPrefix(tokens: SlangToken[], index: number): boolean {
  const previous = tokens[index - 1];
  return (previous?.kind === "identifier" && previous.text !== "return") ||
    previous?.text === ":" ||
    previous?.text === ">" ||
    previous?.text === "*" ||
    previous?.text === "&";
}

function isTopLevelDeclarationComma(tokens: SlangToken[], commaIndex: number): boolean {
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let statementStart = 0;
  for (let index = commaIndex - 1; index >= 0; index--) {
    const token = tokens[index];
    if (token.text === ")") {
      parenthesisDepth++;
    } else if (token.text === "(") {
      if (parenthesisDepth === 0) {
        if (tokens[index - 1]?.text === "for") {
          statementStart = index + 1;
          break;
        }
        return false;
      }
      parenthesisDepth--;
    } else if (token.text === "]") {
      bracketDepth++;
    } else if (token.text === "[") {
      if (bracketDepth === 0) {
        return false;
      }
      bracketDepth--;
    } else if (token.text === "}") {
      braceDepth++;
    } else if (token.text === "{") {
      if (braceDepth === 0) {
        statementStart = index + 1;
        break;
      }
      braceDepth--;
    } else if (
      token.text === ";" &&
      parenthesisDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      statementStart = index + 1;
      break;
    }
  }

  for (let index = statementStart; index < commaIndex; index++) {
    if (tokens[index].kind === "identifier" && hasBasicDeclarationPrefix(tokens, index)) {
      return true;
    }
  }
  return false;
}

/**
 * This deliberately recognizes only indexed buffer access (`name[...]`).
 * A declaration-like identifier pair suppresses that name for the whole scan
 * instead of attempting scope analysis. This may miss unusual valid uses, but
 * keeping this advisory quiet is more useful than warning on shadowed values,
 * declarations, type names, or unrelated members.
 * Preprocessor branches are followed only for literal `0` and `1`; unknown
 * conditional groups are suppressed wholesale rather than guessing.
 */
function collectSlangTokens(source: string): SlangToken[] {
  const tokens: SlangToken[] = [];
  let index = 0;
  let atLineStart = true;
  const conditionalStack: PreprocessorConditional[] = [];
  while (index < source.length) {
    if (atLineStart) {
      let firstNonWhitespace = index;
      while (source[firstNonWhitespace] === " " || source[firstNonWhitespace] === "\t") {
        firstNonWhitespace++;
      }
      if (source[firstNonWhitespace] === "#") {
        const firstLineEnd = source.indexOf("\n", firstNonWhitespace);
        const directive = source.slice(
          firstNonWhitespace,
          firstLineEnd === -1 ? source.length : firstLineEnd,
        );
        const match = directive.match(/^#\s*([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
        const name = match?.[1];
        const argument = match?.[2].trim() ?? "";
        updatePreprocessorConditionals(conditionalStack, name, argument);
        index = endOfPreprocessorDirective(source, firstNonWhitespace);
        continue;
      }
      index = firstNonWhitespace;
      if (index >= source.length) {
        break;
      }
    }

    const current = source[index];
    const next = source[index + 1];
    if (current === "\n" || current === "\r") {
      index++;
      atLineStart = true;
      continue;
    }
    if (current === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index++;
      }
      continue;
    }
    if (current === "/" && next === "*") {
      const commentStart = index;
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index++;
      }
      index = Math.min(source.length, index + 2);
      if (source.slice(commentStart, index).includes("\n")) {
        atLineStart = true;
      }
      continue;
    }
    if (current === "\"" || current === "'") {
      atLineStart = false;
      const quote = current;
      index++;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === quote) {
          index++;
          break;
        } else {
          index++;
        }
      }
      continue;
    }
    if (isIdentifierStart(current)) {
      atLineStart = false;
      const start = index++;
      while (index < source.length && isIdentifierPart(source[index])) {
        index++;
      }
      if (isPreprocessorActive(conditionalStack)) {
        tokens.push({ kind: "identifier", text: source.slice(start, index) });
      }
      continue;
    }
    if (current === "-" && next === ">") {
      atLineStart = false;
      if (isPreprocessorActive(conditionalStack)) {
        tokens.push({ kind: "symbol", text: "->" });
      }
      index += 2;
      continue;
    }
    if (!/\s/.test(current)) {
      atLineStart = false;
      if (isPreprocessorActive(conditionalStack)) {
        tokens.push({ kind: "symbol", text: current });
      }
    }
    index++;
  }
  return tokens;
}

interface PreprocessorConditional {
  active: boolean;
  branchTaken: boolean;
  suppressEntireGroup: boolean;
}

function updatePreprocessorConditionals(
  stack: PreprocessorConditional[],
  directive: string | undefined,
  argument: string,
): void {
  if (directive === "if") {
    const condition = literalPreprocessorCondition(argument);
    stack.push({
      active: condition === true,
      branchTaken: condition === true,
      suppressEntireGroup: condition === undefined,
    });
    return;
  }
  if (directive === "ifdef" || directive === "ifndef") {
    stack.push({ active: false, branchTaken: false, suppressEntireGroup: true });
    return;
  }
  if (directive === "endif") {
    stack.pop();
    return;
  }

  const current = stack[stack.length - 1];
  if (!current || (directive !== "else" && directive !== "elif")) {
    return;
  }
  if (current.suppressEntireGroup || current.branchTaken) {
    current.active = false;
    return;
  }
  if (directive === "else") {
    current.active = true;
    current.branchTaken = true;
    return;
  }

  const condition = literalPreprocessorCondition(argument);
  if (condition === undefined) {
    current.active = false;
    current.suppressEntireGroup = true;
  } else {
    current.active = condition;
    current.branchTaken = condition;
  }
}

function literalPreprocessorCondition(argument: string): boolean | undefined {
  const match = argument.match(/^([01])(?:\s|\/\/.*|\/\*.*?\*\/)*$/);
  return match ? match[1] === "1" : undefined;
}

function isPreprocessorActive(stack: PreprocessorConditional[]): boolean {
  return stack.every((conditional) => conditional.active);
}

function endOfPreprocessorDirective(source: string, directiveStart: number): number {
  let lineStart = directiveStart;
  while (lineStart < source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (!line.endsWith("\\") || newline === -1) {
      return newline === -1 ? source.length : newline + 1;
    }
    lineStart = newline + 1;
  }
  return source.length;
}

function isIdentifierStart(value: string): boolean {
  return value === "_" ||
    (value >= "a" && value <= "z") ||
    (value >= "A" && value <= "Z");
}

function isIdentifierPart(value: string): boolean {
  return isIdentifierStart(value) || (value >= "0" && value <= "9");
}

function resolveDispatch(
  passName: string,
  dispatch: unknown,
  storageNames: Set<string>,
  channels: RenderPassChannel[],
  errors: string[],
): DispatchSpec {
  if (dispatch === undefined) {
    return { mode: "texel" };
  }
  if (!isRecord(dispatch) || Array.isArray(dispatch)) {
    errors.push(`${passName}: invalid dispatch shape`);
    return { mode: "texel" };
  }

  const keys = Object.keys(dispatch);
  if (keys.length === 1 && keys[0] === "count") {
    if (isPositiveInteger(dispatch.count)) {
      return { mode: "count", count: dispatch.count };
    }
    errors.push(`${passName}: dispatch count must be a positive integer`);
    return { mode: "texel" };
  }

  if (keys.length === 3 && keys.includes("x") && keys.includes("y") && keys.includes("z")) {
    if (isPositiveInteger(dispatch.x) && isPositiveInteger(dispatch.y) && isPositiveInteger(dispatch.z)) {
      return { mode: "workgroups", x: dispatch.x, y: dispatch.y, z: dispatch.z };
    }
    errors.push(`${passName}: dispatch x, y, and z must be positive integers`);
    return { mode: "texel" };
  }

  if (keys.length === 1 && keys[0] === "cover") {
    if (typeof dispatch.cover === "string" && storageNames.has(dispatch.cover)) {
      return { mode: "cover-storage", name: dispatch.cover };
    }
    if (typeof dispatch.cover === "string" && channels.some(({ key }) => key === dispatch.cover)) {
      return { mode: "cover-channel", key: dispatch.cover };
    }
    errors.push(`${passName}: dispatch cover target "${String(dispatch.cover)}" was not found`);
    return { mode: "texel" };
  }

  errors.push(`${passName}: invalid dispatch shape`);
  return { mode: "texel" };
}

function resolveDispatchCount(passName: string, dispatchCount: unknown, errors: string[]): number {
  if (dispatchCount === undefined) {
    return 1;
  }
  if (isPositiveInteger(dispatchCount)) {
    if (dispatchCount <= MAX_COMPUTE_DISPATCH_COUNT) {
      return dispatchCount;
    }
    errors.push(
      `${passName}: dispatchCount must be at most ${MAX_COMPUTE_DISPATCH_COUNT}`,
    );
    return 1;
  }
  errors.push(`${passName}: dispatchCount must be a positive integer`);
  return 1;
}

function resolveDispatchOnce(passName: string, dispatchOnce: unknown, errors: string[]): boolean {
  if (dispatchOnce === undefined) {
    return false;
  }
  if (typeof dispatchOnce === "boolean") {
    return dispatchOnce;
  }
  errors.push(`${passName}: dispatchOnce must be a boolean`);
  return false;
}

function resolveWorkgroupSize(
  passName: string,
  workgroupSize: unknown,
  fallback: [number, number, number],
  limits: ComputeWorkgroupLimits,
  errors: string[],
): [number, number, number] {
  if (workgroupSize === undefined) {
    return [...fallback];
  }
  if (!Array.isArray(workgroupSize) || workgroupSize.length !== 3) {
    errors.push(`${passName}: workgroupSize must contain exactly 3 dimensions`);
    return [...fallback];
  }
  if (!workgroupSize.every(isPositiveInteger)) {
    errors.push(`${passName}: workgroupSize dimensions must be positive integers`);
    return [...fallback];
  }
  const [x, y, z] = workgroupSize;
  if (x > limits.maxSizeX || y > limits.maxSizeY || z > limits.maxSizeZ) {
    errors.push(
      `${passName}: workgroupSize dimensions exceed device limits ` +
      `[${limits.maxSizeX}, ${limits.maxSizeY}, ${limits.maxSizeZ}]`,
    );
    return [...fallback];
  }
  if (x * y * z > limits.maxInvocations) {
    errors.push(`${passName}: workgroupSize product must be at most ${limits.maxInvocations}`);
    return [...fallback];
  }
  return [x, y, z];
}

function assignChannelReadTiming(passes: RenderPassNode[]): void {
  const passIndex = new Map(passes.map((pass, index) => [pass.name, index]));
  for (const [consumerIndex, pass] of passes.entries()) {
    for (const channel of pass.channels) {
      if (channel.kind !== "buffer") {
        continue;
      }
      const sourceIndex = passIndex.get(channel.source);
      channel.readFrom = sourceIndex !== undefined && sourceIndex < consumerIndex
        ? "current-frame"
        : "previous-frame";
    }
  }
}

/**
 * Resolve a pass's render resolution from its config (fixed width/height,
 * canvas-relative scale, or the canvas size when unconfigured). Exported so
 * the engine can recompute pass sizes on canvas resize exactly the way
 * buildSlangPassGraph does at compile time.
 */
export function resolvePassResolution(options: {
  passName: RenderPassName;
  passConfig: ShaderConfig["passes"][string] | undefined;
  canvasWidth: number;
  canvasHeight: number;
  errors: string[];
}): { width: number; height: number } {
  const resolution = options.passConfig?.resolution;
  if (!resolution) {
    return { width: options.canvasWidth, height: options.canvasHeight };
  }

  if ("width" in resolution && "height" in resolution && resolution.width && resolution.height) {
    return {
      width: Math.max(1, Math.round(resolution.width * (resolution.scale ?? 1))),
      height: Math.max(1, Math.round(resolution.height * (resolution.scale ?? 1))),
    };
  }

  if ("scale" in resolution && typeof resolution.scale === "number") {
    return {
      width: Math.max(1, Math.round(options.canvasWidth * resolution.scale)),
      height: Math.max(1, Math.round(options.canvasHeight * resolution.scale)),
    };
  }

  options.errors.push(`${options.passName}: Invalid resolution settings`);
  return { width: options.canvasWidth, height: options.canvasHeight };
}

function resolveChannels(options: {
  passName: RenderPassName;
  inputs: Record<string, ConfigInput>;
  configuredBufferNames: Set<string>;
  outputLayersByPass: Map<string, number>;
  warnings: string[];
  errors: string[];
}): RenderPassChannel[] {
  const channels: RenderPassChannel[] = [];
  const validInputs: Record<string, ConfigInput> = {};

  for (const [key, input] of Object.entries(options.inputs)) {
    const numericName = /^iChannel(\d+)$/.exec(key);
    if (numericName && Number.parseInt(numericName[1], 10) > 15) {
      options.warnings.push(`${options.passName}: ignoring channel input "${key}" above slot 15`);
      continue;
    }
    validInputs[key] = input;
  }

  for (const { slot, key } of assignInputSlots(validInputs)) {
    const input = validInputs[key];

    if (input.type === "texture") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} texture input is missing a path`);
        continue;
      }
      channels.push({
        kind: "texture",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
        grayscale: input.grayscale,
      });
      continue;
    }

    if (input.type === "video") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} video input is missing a path`);
        continue;
      }
      channels.push({
        kind: "video",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
        muted: input.muted,
      });
      continue;
    }

    if (input.type === "cubemap") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} cubemap input is missing a path`);
        continue;
      }
      channels.push({
        kind: "cubemap",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
      });
      continue;
    }

    if (input.type === "audio") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} audio input is missing a path`);
        continue;
      }
      channels.push({
        kind: "audio",
        slot,
        key,
        path,
        muted: input.muted,
        startTime: input.startTime,
        endTime: input.endTime,
      });
      continue;
    }

    if (input.type === "keyboard") {
      channels.push({ kind: "keyboard", slot, key });
      continue;
    }

    if (input.type !== "buffer") {
      const unsupportedType = (input as { type?: unknown }).type;
      options.warnings.push(`${options.passName}: ${key} uses unsupported Slang/WebGPU input type "${String(unsupportedType)}"`);
      continue;
    }

    if (SPECIAL_PASS_NAMES.has(input.source)) {
      options.errors.push(`${options.passName}: ${key} source "${input.source}" is not a buffer pass`);
      continue;
    }
    if (!options.configuredBufferNames.has(input.source)) {
      options.errors.push(`${options.passName}: ${key} references missing buffer "${input.source}"`);
      continue;
    }

    const sourceLayers = options.outputLayersByPass.get(input.source) ?? 1;
    const layer = input.layer === undefined ? 0 : input.layer;
    if (!Number.isInteger(layer) || layer < 0 || layer >= sourceLayers) {
      options.errors.push(
        `${options.passName}: ${key} layer ${String(input.layer)} is invalid for source "${input.source}" with ${sourceLayers} layer(s)`,
      );
      continue;
    }

    channels.push({
      kind: "buffer",
      slot,
      key,
      source: input.source,
      readFrom: "previous-frame",
      ...(input.layer === undefined ? {} : { layer: input.layer }),
    });
  }

  return channels.sort((a, b) => a.slot - b.slot);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
