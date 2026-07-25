export const SUPPORTED_SLANG_LANGUAGE_VERSIONS = ["legacy", "2025", "2026", "latest"] as const;

export interface SlangRootHeader {
  header: string;
  body: string;
  language: string;
  diagnostics: { line: number; message: string }[];
}

const isSupported = (value: string): boolean =>
  (SUPPORTED_SLANG_LANGUAGE_VERSIONS as readonly string[]).includes(value);
const newlineStyle = (source: string) => source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
const placeholders = (source: string) => source.replace(/[^\r\n]+/g, "");

function skipTrivia(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length) {
    const whitespace = source.slice(cursor).match(/^[ \t\r\n]+/);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    if (source.startsWith("//", cursor)) {
      const newline = source.slice(cursor).search(/\r\n|\n|\r/);
      cursor += newline < 0 ? source.length - cursor : newline;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const end = source.indexOf("*/", cursor + 2);
      if (end < 0) {
        return cursor;
      }
      cursor = end + 2;
      continue;
    }
    break;
  }
  return cursor;
}

function replaceRanges(source: string, ranges: Array<[number, number]>): string {
  let result = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    result += source.slice(cursor, start);
    result += placeholders(source.slice(start, end));
    cursor = end;
  }
  return result + source.slice(cursor);
}

/** Splits leading Slang compiler declarations from user source without moving lines. */
export function splitSlangRootHeader(source: string): SlangRootHeader {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const content = bom ? source.slice(1) : source;
  const directiveStart = skipTrivia(content, 0);
  const directive = content.slice(directiveStart).match(/^#language[ \t]+slang[ \t]+([^ \t\r\n]+)[ \t]*(\r\n|\n|\r|$)/);
  if (!directive) {
    return { header: `${bom}#language slang legacy${newlineStyle(content)}`, body: content, language: "legacy", diagnostics: [] };
  }

  const directiveEnd = directiveStart + directive[0].length;
  const moduleStart = skipTrivia(content, directiveEnd);
  const module = content.slice(moduleStart).match(/^module[ \t]+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*[ \t]*;(?:\r\n|\n|\r|$)/);
  const moduleEnd = module ? moduleStart + module[0].length : undefined;
  const ranges: Array<[number, number]> = [[directiveStart, directiveEnd]];
  if (moduleEnd !== undefined) {
    ranges.push([moduleStart, moduleEnd]);
  }
  const version = directive[1];
  const header = `${bom}${content.slice(directiveStart, directiveEnd)}${module ? content.slice(moduleStart, moduleEnd) : ""}`;
  const diagnostics = isSupported(version) ? [] : [{
    line: content.slice(0, directiveStart).split(/\r\n|\n|\r/).length - 1,
    message: `Unsupported Slang language version "${version}"; expected legacy, 2025, 2026, or latest`,
  }];
  return { header, body: replaceRanges(content, ranges), language: version, diagnostics };
}
