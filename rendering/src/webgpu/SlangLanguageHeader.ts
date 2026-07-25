import type { SlangLanguageVersion } from "@shader-studio/types";

export const SUPPORTED_SLANG_LANGUAGE_VERSIONS = ["legacy", "2025", "2026", "latest"] as const;

export interface SlangRootHeader {
  header: string;
  body: string;
  language: SlangLanguageVersion;
  diagnostics: { line: number; message: string }[];
}

const isSupported = (value: string): value is SlangLanguageVersion =>
  (SUPPORTED_SLANG_LANGUAGE_VERSIONS as readonly string[]).includes(value);

const newlineStyle = (source: string) => source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
const placeholder = (text: string) => text.replace(/[^\r\n]+/g, "");

/** Separates compiler directives which occur in leading trivia from executable source. */
export function parseSlangRootHeader(source: string): SlangRootHeader {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const content = bom ? source.slice(1) : source;
  let cursor = 0;
  while (cursor < content.length) {
    const whitespace = content.slice(cursor).match(/^[ \t\r\n]+/);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    if (content.startsWith("//", cursor)) {
      const end = content.slice(cursor).search(/\r\n|\n|\r/);
      cursor += end < 0 ? content.length - cursor : end;
      continue;
    }
    if (content.startsWith("/*", cursor)) {
      const end = content.indexOf("*/", cursor + 2);
      if (end < 0) {
        break;
      }
      cursor = end + 2;
      continue;
    }
    break;
  }

  const directive = content.slice(cursor).match(/^#language[ \t]+slang[ \t]+([^ \t\r\n]+)[ \t]*(\r\n|\n|\r|$)/);
  if (!directive) {
    return {
      header: `${bom}#language slang legacy${newlineStyle(content)}`,
      body: content,
      language: "legacy",
      diagnostics: [],
    };
  }
  const directiveEnd = cursor + directive[0].length;
  let headerEnd = directiveEnd;
  const module = content.slice(directiveEnd).match(/^[ \t]*(?:\r\n|\n|\r)?[ \t]*module\b[^;]*;(?:\r\n|\n|\r)?/);
  if (module) {
    headerEnd += module[0].length;
  }
  const version = directive[1];
  const header = `${bom}${content.slice(0, headerEnd)}`;
  const body = `${placeholder(content.slice(0, headerEnd))}${content.slice(headerEnd)}`;
  if (isSupported(version)) {
    return { header, body, language: version, diagnostics: [] };
  }
  return {
    header,
    body,
    language: "legacy",
    diagnostics: [{
      line: content.slice(0, cursor).split(/\r\n|\n|\r/).length,
      message: `Unsupported Slang language version "${version}"; expected one of: ${SUPPORTED_SLANG_LANGUAGE_VERSIONS.join(", ")}.`,
    }],
  };
}
