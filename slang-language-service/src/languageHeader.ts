import type { SlangLanguageVersion } from "./types";

export const SUPPORTED_SLANG_LANGUAGE_VERSIONS = ["legacy", "2025", "2026", "latest"] as const;

export interface SlangRootHeader {
  header: string;
  body: string;
  language: string;
  diagnostics: Array<{ line: number; message: string }>;
}

const DIRECTIVE_PATTERN = /#language[\t ]+slang[\t ]+([^\s]+)[^\r\n]*(?:\r\n|\r|\n|$)/y;
const MODULE_PATTERN = /module[\t ]+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*[\t ]*;[\t ]*(?:\r\n|\r|\n|$)/y;

function skipTrivia(source: string, start: number): number {
  let cursor = start;

  while (cursor < source.length) {
    const whitespace = /^[\t \r\n]+/.exec(source.slice(cursor));
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }

    if (source.startsWith("//", cursor)) {
      const newline = /\r\n|\r|\n/.exec(source.slice(cursor + 2));
      cursor = newline === null
        ? source.length
        : cursor + 2 + newline.index + newline[0].length;
      continue;
    }

    if (source.startsWith("/*", cursor)) {
      const end = source.indexOf("*/", cursor + 2);
      if (end === -1) {
        return source.length;
      }
      cursor = end + 2;
      continue;
    }

    break;
  }

  return cursor;
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r\n|\r|\n/).length - 1;
}

function newlineStyle(source: string): string {
  return /\r\n/.test(source) ? "\r\n" : /\r/.test(source) ? "\r" : "\n";
}

function onlyNewlines(value: string): string {
  return value.match(/\r\n|\r|\n/g)?.join("") ?? "";
}

function isSupportedLanguage(language: string): language is SlangLanguageVersion {
  return (SUPPORTED_SLANG_LANGUAGE_VERSIONS as readonly string[]).includes(language);
}

export function splitSlangRootHeader(source: string): SlangRootHeader {
  const directiveStart = skipTrivia(source, 0);
  DIRECTIVE_PATTERN.lastIndex = directiveStart;
  const directive = DIRECTIVE_PATTERN.exec(source);

  if (!directive) {
    return {
      header: `#language slang legacy${newlineStyle(source)}`,
      body: source,
      language: "legacy",
      diagnostics: [],
    };
  }

  const language = directive[1];
  const extracted = [{ start: directiveStart, end: DIRECTIVE_PATTERN.lastIndex }];
  let header = directive[0];
  const moduleStart = skipTrivia(source, DIRECTIVE_PATTERN.lastIndex);
  MODULE_PATTERN.lastIndex = moduleStart;
  const moduleDeclaration = MODULE_PATTERN.exec(source);

  if (moduleDeclaration) {
    extracted.push({ start: moduleStart, end: MODULE_PATTERN.lastIndex });
    header += moduleDeclaration[0];
  }

  let body = "";
  let previousEnd = 0;
  for (const span of extracted) {
    body += source.slice(previousEnd, span.start);
    body += onlyNewlines(source.slice(span.start, span.end));
    previousEnd = span.end;
  }
  body += source.slice(previousEnd);

  const diagnostics = isSupportedLanguage(language)
    ? []
    : [{
      line: lineNumberAt(source, directiveStart),
      message: `Unsupported Slang language version "${language}"; expected ${SUPPORTED_SLANG_LANGUAGE_VERSIONS.slice(0, -1).join(", ")}, or ${SUPPORTED_SLANG_LANGUAGE_VERSIONS.at(-1)}`,
    }];

  return { header, body, language, diagnostics };
}
