import type { Color, ColorInformation, ColorPresentation, Position, Range } from "vscode-languageserver-protocol";
import type { ShaderLanguage } from "./protocol";

const NUMBER_SOURCE = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;

export function findLiteralConstructorColors(
  source: string,
  constructors: readonly string[],
): ColorInformation[] {
  if (constructors.length === 0) {
    return [];
  }
  const names = constructors.map(escapeRegExp).join("|");
  const pattern = new RegExp(`\\b(?:${names})\\s*\\(([^()]*)\\)`, "g");
  const results: ColorInformation[] = [];
  for (const match of source.matchAll(pattern)) {
    const components = match[1]?.split(",").map((part) => part.trim()) ?? [];
    if ((components.length !== 3 && components.length !== 4)
      || components.some((part) => !new RegExp(`^(?:${NUMBER_SOURCE})$`).test(part))) {
      continue;
    }
    const values = components.map(Number);
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    results.push({
      color: { red: values[0], green: values[1], blue: values[2], alpha: values[3] ?? 1 },
      range: { start: positionAt(source, start), end: positionAt(source, end) },
    });
  }
  return results;
}

/**
 * Rewrites the constructor under `range` with `color`, keeping the arity the
 * source already uses: editing a `vec3`/`float3` must not turn it into a
 * `vec4`/`float4`. `source` is the current document text; without it the
 * four-component form is the only safe guess.
 */
export function createLiteralColorPresentations(
  language: ShaderLanguage,
  color: Color,
  range: Range,
  source?: string,
): ColorPresentation[] {
  const components = componentCountAt(source, range) ?? 4;
  const constructor = `${language === "slang" ? "float" : "vec"}${components}`;
  const channels = components === 3
    ? [color.red, color.green, color.blue]
    : [color.red, color.green, color.blue, color.alpha];
  const label = `${constructor}(${channels.map(formatColorComponent).join(", ")})`;
  return [{ label, textEdit: { range, newText: label } }];
}

function componentCountAt(source: string | undefined, range: Range): 3 | 4 | undefined {
  if (source === undefined) {
    return undefined;
  }
  const start = offsetAt(source, range.start);
  const end = offsetAt(source, range.end);
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const match = /^(?:vec|float)([34])\s*\(/.exec(source.slice(start, end).trim());
  return match?.[1] === "3" ? 3 : match?.[1] === "4" ? 4 : undefined;
}

function offsetAt(source: string, position: Position): number | undefined {
  const lines = source.split("\n");
  if (position.line < 0 || position.line >= lines.length) {
    return undefined;
  }
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }
  return offset + position.character;
}

function positionAt(source: string, offset: number): Position {
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 };
}

function formatColorComponent(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return Number.isInteger(clamped) ? clamped.toFixed(1) : String(Number(clamped.toFixed(6)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
