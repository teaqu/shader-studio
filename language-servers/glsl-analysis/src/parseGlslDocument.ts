import type { ShaderStage } from "@shader-studio/types";
import { parse } from "@shaderfrog/glsl-parser";
import {
  preprocess
} from "@shaderfrog/glsl-parser/preprocessor/index.js";
import { normalizeProgram } from "./GlslDocumentNormalizer.js";
import { freezeDocument } from "./GlslDocumentQueries.js";
import type { ParserProgram } from "./GlslParserAst.js";
import { stripComments } from "./GlslParserAst.js";
import { createDiagnostic } from "./GlslSourceMapping.js";
import type {
  GlslAnalysisDocument,
  GlslParseDiagnostic
} from "./model.js";
import { buildGlslLineMapping } from "./sourceMap.js";

export { symbolAtPosition,visibleSymbolsAtPosition } from "./GlslDocumentQueries.js";
export function parseGlslDocument(
  uri: string,
  source: string,
  stage: ShaderStage,
): GlslAnalysisDocument {
  const originalLines = source.split("\n");
  const diagnostics: GlslParseDiagnostic[] = [];
  let processedSource = source;

  if (/^\s*#/m.test(source)) {
    try {
      processedSource = preprocess(source);
    } catch (error) {
      diagnostics.push(createDiagnostic("preprocess", error, originalLines));
    }
  }

  const processedLines = processedSource.split("\n");
  const lineMapping = buildGlslLineMapping(originalLines, processedLines);
  let parsed: ParserProgram = {};
  let parsedSuccessfully = true;

  try {
    // Common/helper files may contain no declarations. The third-party parser
    // requires at least one, even after preprocessing removes inactive code.
    // Keep normal source maps and macro indexing for these valid empty files.
    // Only complete comments are stripped; an unterminated comment still
    // reaches the parser and reports its real syntax error.
    const activeSource = stripComments(processedSource).trim();
    if (activeSource.length > 0) {
      parsed = parse(processedSource, {
        includeLocation: true,
        quiet: true,
        stage: parserStage(stage),
      }) as unknown as ParserProgram;
    }
  } catch (error) {
    parsedSuccessfully = false;
    diagnostics.push(createDiagnostic(
      "syntax",
      error,
      originalLines,
      processedLines,
      lineMapping.processedToOriginal,
    ));
  }

  const { symbols, scopes, unresolvedReferences } = normalizeProgram(
    parsed,
    originalLines,
    processedLines,
    lineMapping.processedToOriginal,
  );

  return freezeDocument({
    uri,
    source,
    processedSource,
    stage,
    parsedSuccessfully,
    symbols,
    scopes,
    diagnostics,
    unresolvedReferences,
    originalToProcessed: [...lineMapping.originalToProcessed],
    processedToOriginal: [...lineMapping.processedToOriginal],
  });
}

function parserStage(stage: ShaderStage): "vertex" | "fragment" | "either" {
  if (stage === "vertex" || stage === "fragment") {
    return stage;
  }
  return "either";
}
