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

export function createLiteralColorPresentations(
  language: ShaderLanguage,
  color: Color,
  range: Range,
): ColorPresentation[] {
  const constructor = language === "slang" ? "float4" : "vec4";
  const values = [color.red, color.green, color.blue, color.alpha].map(formatColorComponent);
  const label = `${constructor}(${values.join(", ")})`;
  return [{ label, textEdit: { range, newText: label } }];
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
