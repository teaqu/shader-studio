import { parse } from '@shaderfrog/glsl-parser';
import { preprocess } from '@shaderfrog/glsl-parser/preprocessor/index.js';

export interface FunctionInfo {
  name: string | null;
  start: number;
  end: number;
}

export interface VarInfo {
  name: string;
  type: string;
}

export interface ScopedVarInfo extends VarInfo {
  declarationLine: number;
}

type StatementKind =
  | 'empty'
  | 'controlFlow'
  | 'return'
  | 'declaration'
  | 'assignment'
  | 'memberAssignment'
  | 'call'
  | 'unknown';

interface StatementInfo {
  text: string;
  trimmed: string;
  startLine: number;
  endLine: number;
  kind: StatementKind;
  declaredVar?: VarInfo;
  assignedVarName?: string;
  assignedExpression?: string;
  assignedValueType?: string;
  callName?: string;
}

interface Token {
  type: 'identifier' | 'keyword' | 'number' | 'operator' | 'punctuation';
  value: string;
}

interface ShaderScopeBinding {
  declaration?: {
    type?: string;
    location?: {
      start?: { line?: number };
      end?: { line?: number };
    };
    identifier?: { identifier?: string };
    specifier?: unknown;
    qualifier?: unknown[];
  };
}

interface ShaderScope {
  name: string;
  bindings: Record<string, ShaderScopeBinding>;
  location?: {
    start?: { line?: number };
    end?: { line?: number };
  };
}

interface ShaderFunctionNode {
  type: string;
  prototype?: {
    header?: {
      name?: { identifier?: string };
      returnType?: unknown;
      location?: {
        start?: { line?: number };
      };
    };
    parameters?: Array<{
      type?: string;
      identifier?: { identifier?: string };
      specifier?: unknown;
      qualifier?: Array<{ token?: string }>;
      location?: {
        start?: { line?: number };
      };
    }>;
  };
  body?: {
    rb?: {
      location?: {
        start?: { line?: number };
      };
    };
  };
  location?: {
    start?: { line?: number };
    end?: { line?: number };
  };
}

interface ParsedFunctionInfo {
  name: string;
  start: number;
  end: number;
  returnType: string | null;
}

interface ParsedDocument {
  source: string;
  originalLines: string[];
  effectiveLines: string[];
  originalToProcessed: number[];
  processedToOriginal: number[];
  parsedSuccessfully: boolean;
  scopes: ShaderScope[];
  functions: ParsedFunctionInfo[];
}

const GLSL_TYPES = new Set([
  'void',
  'float',
  'int',
  'bool',
  'vec2',
  'vec3',
  'vec4',
  'mat2',
  'mat3',
  'mat4',
  'sampler2D',
]);

const CONTROL_FLOW_KEYWORDS = new Set(['if', 'for', 'while', 'switch']);
const PARAMETER_QUALIFIERS = new Set(['in', 'out', 'inout', 'const']);
const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=']);
const DOC_CACHE = new Map<string, ParsedDocument>();

export class GlslParser {
  static findEnclosingFunction(lines: string[], lineNum: number): FunctionInfo {
    const document = GlslParser.getDocument(lines);
    const targetLine = GlslParser.resolveClosingBraceLine(document.effectiveLines, lineNum);

    for (const fn of document.functions) {
      if (targetLine >= fn.start && targetLine <= fn.end) {
        return { name: fn.name, start: fn.start, end: fn.end };
      }
    }

    return GlslParser.findEnclosingFunctionLegacy(lines, lineNum);
  }

  static getFullFunctionSignature(lines: string[], startLine: number): string {
    let sigText = lines[startLine] || '';
    let sigIdx = startLine;
    while (!sigText.includes(')') && sigIdx < lines.length - 1) {
      sigIdx++;
      sigText += ' ' + lines[sigIdx];
    }
    return sigText;
  }

  static buildVariableTypeMap(
    lines: string[],
    upToLine: number,
    functionInfo: FunctionInfo
  ): Map<string, string> {
    const document = GlslParser.getDocument(lines);
    const varTypes = new Map<string, string>();

    if (!functionInfo.name || functionInfo.start < 0) {
      for (let i = 0; i <= upToLine && i < document.effectiveLines.length; i++) {
        for (const declaration of GlslParser.extractDeclarationsFromLine(document.effectiveLines[i])) {
          varTypes.set(declaration.name, declaration.type);
        }
      }
      return varTypes;
    }

    if (!document.parsedSuccessfully) {
      return GlslParser.buildVariableTypeMapLegacy(document.effectiveLines, upToLine, functionInfo);
    }

    const visibleScopes = GlslParser.getVisibleScopes(document, functionInfo, upToLine);
    for (const scope of visibleScopes) {
      for (const [bindingName, binding] of Object.entries(scope.bindings)) {
        const declarationLine = GlslParser.getDeclarationOriginalLine(document, binding);
        if (declarationLine === null || declarationLine > upToLine) {
          continue;
        }

        const type = GlslParser.getBindingType(document, bindingName, binding, functionInfo.start);
        if (type) {
          varTypes.set(bindingName, type);
        }
      }
    }

    return varTypes;
  }

  static buildVariableLineMap(
    lines: string[],
    upToLine: number,
    functionInfo: FunctionInfo,
    knownVars?: Map<string, string>,
  ): Map<string, number> {
    const document = GlslParser.getDocument(lines);
    const varLines = new Map<string, number>();

    if (!document.parsedSuccessfully) {
      return GlslParser.buildVariableLineMapLegacy(document.effectiveLines, upToLine, functionInfo, knownVars);
    }

    if (functionInfo.name && functionInfo.start >= 0) {
      const visibleScopes = GlslParser.getVisibleScopes(document, functionInfo, upToLine);
      for (const scope of visibleScopes) {
        for (const [bindingName, binding] of Object.entries(scope.bindings)) {
          const declarationLine = GlslParser.getDeclarationOriginalLine(document, binding);
          if (declarationLine !== null && declarationLine <= upToLine) {
            varLines.set(bindingName, declarationLine);
          }
        }
      }
    }

    const varNames = knownVars ? new Set(knownVars.keys()) : new Set(varLines.keys());
    const scanStart = functionInfo.start >= 0 ? functionInfo.start : 0;

    for (let i = scanStart; i <= upToLine && i < document.effectiveLines.length; i++) {
      const line = document.effectiveLines[i];

      for (const declaration of GlslParser.extractDeclarationsFromLine(line)) {
        if (!knownVars || knownVars.has(declaration.name)) {
          varLines.set(declaration.name, i);
        }
        varNames.add(declaration.name);
      }

      const assignment = GlslParser.extractAssignedVariable(line);
      if (assignment && varNames.has(assignment.name)) {
        varLines.set(assignment.name, i);
      }
    }

    return varLines;
  }

  static getGlobalVariables(lines: string[]): ScopedVarInfo[] {
    const document = GlslParser.getDocument(lines);
    const globals: ScopedVarInfo[] = [];

    for (let i = 0; i < document.effectiveLines.length; i++) {
      if (GlslParser.isInsideFunction(document.functions, i)) {
        continue;
      }

      for (const declaration of GlslParser.extractDeclarationsFromLine(document.effectiveLines[i])) {
        globals.push({
          ...declaration,
          declarationLine: i,
        });
      }
    }

    return globals;
  }

  static getUsedGlobalVariables(lines: string[], functionInfo: FunctionInfo): ScopedVarInfo[] {
    const globals = GlslParser.getGlobalVariables(lines);
    if (!functionInfo.name || functionInfo.start < 0) {
      return globals;
    }

    const localNames = new Set(
      GlslParser.buildVariableTypeMap(lines, functionInfo.end, functionInfo).keys(),
    );
    const usedIdentifiers = new Set<string>();

    for (let i = functionInfo.start; i <= functionInfo.end && i < lines.length; i++) {
      for (const token of GlslParser.tokenize(GlslParser.stripLineComments(lines[i]))) {
        if (token.type === 'identifier') {
          usedIdentifiers.add(token.value);
        }
      }
    }

    return globals.filter((globalVar) =>
      usedIdentifiers.has(globalVar.name) && !localNames.has(globalVar.name),
    );
  }

  static detectVariableAndType(
    lineContent: string,
    varTypes: Map<string, string>,
    functionReturnType?: string,
    lines?: string[],
    lineIndex?: number,
    log: boolean = true,
  ): VarInfo | null {
    if (log) {
      console.log('[ShaderDebug] === DETECT VARIABLE ===');
      console.log('[ShaderDebug] Line:', lineContent);
      console.log('[ShaderDebug] Available vars in scope:', Array.from(varTypes.keys()));
    }

    let statementLines = lines;
    let statementLineContent = lineContent;
    if (lines) {
      const document = GlslParser.getDocument(lines);
      statementLines = document.effectiveLines;
      if (lineIndex !== undefined && lineIndex >= 0 && lineIndex < document.effectiveLines.length) {
        statementLineContent = document.effectiveLines[lineIndex];
      }
    }

    const statement = GlslParser.getStatementInfo(statementLineContent, statementLines, lineIndex);
    if (log && statement.startLine !== statement.endLine) {
      console.log(
        `[ShaderDebug] Multi-line statement detected (lines ${statement.startLine}-${statement.endLine}), combined:`,
        statement.text
      );
    }

    switch (statement.kind) {
      case 'return':
        if (functionReturnType) {
          if (log) {
            console.log('[ShaderDebug] ✓ Matched return statement, type:', functionReturnType);
          }
          return { name: '_dbgReturn', type: functionReturnType };
        }
        break;

      case 'declaration':
        if (statement.declaredVar) {
          if (log) {
            console.log(`[ShaderDebug] ✓ Matched declaration: ${statement.declaredVar.name} (${statement.declaredVar.type})`);
          }
          return statement.declaredVar;
        }
        break;

      case 'assignment':
      case 'memberAssignment':
        if (statement.assignedVarName) {
          const varType = varTypes.get(statement.assignedVarName);
          const kindLabel = statement.kind === 'memberAssignment' ? 'member assignment' : 'assignment';
          if (log) {
            console.log(
              `[ShaderDebug] Trying ${kindLabel}: found var '${statement.assignedVarName}', type: ${varType || 'NOT IN SCOPE'}`
            );
          }
          if (varType) {
            if (
              statement.kind === 'memberAssignment' &&
              !GLSL_TYPES.has(varType) &&
              statement.assignedExpression &&
              statement.assignedValueType
            ) {
              if (log) {
                console.log(
                  `[ShaderDebug] ✓ Matched ${kindLabel} expression: ${statement.assignedExpression} (${statement.assignedValueType})`
                );
              }
              return { name: statement.assignedExpression, type: statement.assignedValueType };
            }
            if (log) {
              console.log(`[ShaderDebug] ✓ Matched ${kindLabel}: ${statement.assignedVarName} (${varType})`);
            }
            return { name: statement.assignedVarName, type: varType };
          }
        }
        break;

      case 'call':
        if (statement.callName && lines) {
          const returnType = GlslParser.findFunctionReturnType(lines, statement.callName);
          if (returnType && returnType !== 'void') {
            if (log) {
              console.log(`[ShaderDebug] ✓ Matched standalone function call: ${statement.callName}() returns ${returnType}`);
            }
            return { name: '_dbgCall', type: returnType };
          }
        }
        break;
    }

    if (log) {
      console.log('[ShaderDebug] ✗ Could not detect variable/type');
    }
    return null;
  }

  static findFunctionReturnType(lines: string[], funcName: string): string | null {
    const document = GlslParser.getDocument(lines);
    const fn = document.functions.find(candidate => candidate.name === funcName);
    return fn?.returnType ?? GlslParser.findFunctionReturnTypeLegacy(lines, funcName);
  }

  private static getDocument(lines: string[]): ParsedDocument {
    const source = lines.join('\n');
    const cached = DOC_CACHE.get(source);
    if (cached) {
      return cached;
    }

    const originalLines = [...lines];
    const processedSource = GlslParser.preprocessSource(source);
    const processedLines = processedSource.split('\n');
    const { originalToProcessed, processedToOriginal } = GlslParser.buildLineMapping(originalLines, processedLines);

    const effectiveLines = new Array(originalLines.length).fill('');
    for (let processedLine = 0; processedLine < processedLines.length; processedLine++) {
      const originalLine = processedToOriginal[processedLine];
      if (originalLine >= 0 && originalLine < effectiveLines.length) {
        effectiveLines[originalLine] = processedLines[processedLine];
      }
    }

    let ast: { scopes?: ShaderScope[]; program?: ShaderFunctionNode[] } = {};
    let parsedSuccessfully = true;
    try {
      ast = parse(processedSource, {
        includeLocation: true,
        quiet: true,
        stage: 'either',
      }) as { scopes?: ShaderScope[]; program?: ShaderFunctionNode[] };
    } catch {
      ast = {};
      parsedSuccessfully = false;
    }

    const document: ParsedDocument = {
      source,
      originalLines,
      effectiveLines,
      originalToProcessed,
      processedToOriginal,
      parsedSuccessfully,
      scopes: ast.scopes ?? [],
      functions: GlslParser.extractFunctions(ast.program ?? [], processedToOriginal),
    };

    DOC_CACHE.set(source, document);
    return document;
  }

  private static preprocessSource(source: string): string {
    if (!/^\s*#/m.test(source)) {
      return source;
    }

    try {
      return preprocess(source);
    } catch {
      return source;
    }
  }

  private static buildLineMapping(originalLines: string[], processedLines: string[]) {
    if (originalLines.join('\n') === processedLines.join('\n')) {
      const originalToProcessed = originalLines.map((_, index) => index);
      const processedToOriginal = processedLines.map((_, index) => index);
      return { originalToProcessed, processedToOriginal };
    }

    const originalNorm = originalLines.map(line => GlslParser.normalizeLine(line));
    const processedNorm = processedLines.map(line => GlslParser.normalizeLine(line));
    const dp: number[][] = Array.from({ length: originalNorm.length + 1 }, () =>
      new Array(processedNorm.length + 1).fill(0)
    );

    for (let i = originalNorm.length - 1; i >= 0; i--) {
      for (let j = processedNorm.length - 1; j >= 0; j--) {
        if (originalNorm[i] === processedNorm[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    const originalToProcessed = new Array(originalNorm.length).fill(-1);
    const processedToOriginal = new Array(processedNorm.length).fill(-1);

    let i = 0;
    let j = 0;
    while (i < originalNorm.length && j < processedNorm.length) {
      if (originalNorm[i] === processedNorm[j]) {
        originalToProcessed[i] = j;
        processedToOriginal[j] = i;
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }

    return { originalToProcessed, processedToOriginal };
  }

  private static extractFunctions(program: ShaderFunctionNode[], processedToOriginal: number[]): ParsedFunctionInfo[] {
    const functions: ParsedFunctionInfo[] = [];

    for (const node of program) {
      if (node.type !== 'function') {
        continue;
      }

      const name = node.prototype?.header?.name?.identifier;
      if (!name) {
        continue;
      }

      const startProcessedLine = (node.location?.start?.line ?? node.prototype?.header?.location?.start?.line ?? 1) - 1;
      const endProcessedLine = (node.body?.rb?.location?.start?.line ?? node.location?.end?.line ?? startProcessedLine + 1) - 1;
      functions.push({
        name,
        start: GlslParser.mapProcessedLine(processedToOriginal, startProcessedLine),
        end: GlslParser.mapProcessedLine(processedToOriginal, endProcessedLine),
        returnType: GlslParser.extractTypeName(node.prototype?.header?.returnType),
      });
    }

    return functions;
  }

  private static mapProcessedLine(processedToOriginal: number[], processedLine: number): number {
    if (processedLine < 0) {
      return -1;
    }
    if (processedLine < processedToOriginal.length && processedToOriginal[processedLine] !== -1) {
      return processedToOriginal[processedLine];
    }

    for (let i = processedLine; i >= 0; i--) {
      if (i < processedToOriginal.length && processedToOriginal[i] !== -1) {
        return processedToOriginal[i];
      }
    }

    return processedLine;
  }

  private static isInsideFunction(functions: ParsedFunctionInfo[], line: number): boolean {
    return functions.some((fn) => line >= fn.start && line <= fn.end);
  }

  private static getVisibleScopes(document: ParsedDocument, functionInfo: FunctionInfo, upToLine: number): ShaderScope[] {
    const processedLine = GlslParser.resolveProcessedLine(document, upToLine, functionInfo.start);

    return document.scopes
      .filter(scope => scope.name !== 'global')
      .map(scope => {
        const start = GlslParser.scopeStartLine(document, scope);
        const end = GlslParser.scopeEndLine(document, scope);
        return { scope, start, end };
      })
      .filter(entry =>
        entry.start !== null &&
        entry.end !== null &&
        entry.start >= functionInfo.start &&
        entry.end <= functionInfo.end &&
        processedLine >= GlslParser.resolveProcessedLine(document, entry.start, functionInfo.start) &&
        processedLine <= GlslParser.resolveProcessedLine(document, entry.end, functionInfo.start)
      )
      .sort((a, b) => a.start! - b.start!)
      .map(entry => entry.scope);
  }

  private static resolveProcessedLine(document: ParsedDocument, originalLine: number, floorLine = 0): number {
    if (originalLine >= 0 && originalLine < document.originalToProcessed.length) {
      const direct = document.originalToProcessed[originalLine];
      if (direct !== -1) {
        return direct;
      }
    }

    for (let line = originalLine; line >= floorLine; line--) {
      if (line >= 0 && line < document.originalToProcessed.length) {
        const mapped = document.originalToProcessed[line];
        if (mapped !== -1) {
          return mapped;
        }
      }
    }

    return Math.max(0, Math.min(originalLine, document.effectiveLines.length - 1));
  }

  private static scopeStartLine(document: ParsedDocument, scope: ShaderScope): number | null {
    const processedLine = scope.location?.start?.line;
    if (!processedLine) {
      return null;
    }
    return GlslParser.mapProcessedLine(document.processedToOriginal, processedLine - 1);
  }

  private static scopeEndLine(document: ParsedDocument, scope: ShaderScope): number | null {
    const processedLine = scope.location?.end?.line;
    if (!processedLine) {
      return null;
    }
    return GlslParser.mapProcessedLine(document.processedToOriginal, processedLine - 1);
  }

  private static getDeclarationOriginalLine(document: ParsedDocument, binding: ShaderScopeBinding): number | null {
    const processedLine = binding.declaration?.location?.start?.line;
    if (!processedLine) {
      return null;
    }
    return GlslParser.mapProcessedLine(document.processedToOriginal, processedLine - 1);
  }

  private static getBindingType(
    document: ParsedDocument,
    bindingName: string,
    binding: ShaderScopeBinding,
    functionStart: number,
  ): string | null {
    const declaration = binding.declaration;
    if (!declaration) {
      return null;
    }

    if (declaration.type === 'parameter_declaration') {
      return GlslParser.extractTypeName(declaration.specifier);
    }

    const declarationLine = GlslParser.getDeclarationOriginalLine(document, binding);
    if (declarationLine === null || declarationLine < 0 || declarationLine >= document.effectiveLines.length) {
      return null;
    }

    const signatureLine = declarationLine === functionStart
      ? GlslParser.getFullFunctionSignature(document.effectiveLines, functionStart)
      : document.effectiveLines[declarationLine];

    for (const declarationInfo of GlslParser.extractDeclarationsFromLine(signatureLine)) {
      if (declarationInfo.name === bindingName) {
        return declarationInfo.type;
      }
    }

    return null;
  }

  private static extractTypeName(typeNode: unknown): string | null {
    const specifier =
      (typeNode as { specifier?: { specifier?: { token?: string } } })?.specifier?.specifier?.token ??
      (typeNode as { specifier?: { token?: string } })?.specifier?.token;
    return specifier && GLSL_TYPES.has(specifier) ? specifier : null;
  }

  private static resolveClosingBraceLine(lines: string[], lineNum: number): number {
    const strippedCursor = GlslParser.stripLineComments(lines[lineNum] ?? '').trim();
    return strippedCursor === '}' && lineNum > 0 ? lineNum - 1 : lineNum;
  }

  private static normalizeLine(line: string): string {
    return GlslParser.stripLineComments(line).trim().replace(/\s+/g, ' ');
  }

  private static stripLineComments(line: string | undefined | null): string {
    if (!line) {
      return '';
    }
    const commentIndex = line.indexOf('//');
    return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
  }

  private static findEnclosingFunctionLegacy(lines: string[], lineNum: number): FunctionInfo {
    const functionDeclPattern = /(?:void|float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|sampler2D)\s+(\w+)\s*\(/;

    const currentLine = lines[lineNum] ?? '';
    const currentMatch = currentLine.match(functionDeclPattern);
    if (currentMatch) {
      const functionStart = lineNum;
      let braceDepth = 0;
      let functionEnd = -1;
      let foundStart = false;

      for (let i = functionStart; i < lines.length; i++) {
        const strippedLine = GlslParser.stripLineComments(lines[i]);
        for (const char of strippedLine) {
          if (char === '{') {
            braceDepth++;
            foundStart = true;
          }
          if (char === '}') {
            braceDepth--;
            if (foundStart && braceDepth === 0) {
              functionEnd = i;
              break;
            }
          }
        }
        if (functionEnd !== -1) break;
      }

      return {
        name: currentMatch[1],
        start: functionStart,
        end: functionEnd,
      };
    }

    let braceDepth = 0;
    let functionStart = -1;
    let functionName: string | null = null;

    const strippedCursor = GlslParser.stripLineComments(lines[lineNum] ?? '').trim();
    const startLine = (strippedCursor === '}' && lineNum > 0) ? lineNum - 1 : lineNum;

    for (let i = startLine; i >= 0; i--) {
      const strippedForBraces = GlslParser.stripLineComments(lines[i]);
      for (const char of strippedForBraces) {
        if (char === '{') braceDepth--;
        if (char === '}') braceDepth++;
      }

      if (braceDepth < 0) {
        const funcMatch = lines[i].match(functionDeclPattern);
        if (funcMatch) {
          functionName = funcMatch[1];
          functionStart = i;
          break;
        }
      }
    }

    let functionEnd = -1;
    if (functionStart !== -1) {
      braceDepth = 0;
      let foundStart = false;
      for (let i = functionStart; i < lines.length; i++) {
        const strippedLine = GlslParser.stripLineComments(lines[i]);
        for (const char of strippedLine) {
          if (char === '{') {
            braceDepth++;
            foundStart = true;
          }
          if (char === '}') {
            braceDepth--;
            if (foundStart && braceDepth === 0) {
              functionEnd = i;
              break;
            }
          }
        }
        if (functionEnd !== -1) break;
      }
    }

    return {
      name: functionName,
      start: functionStart,
      end: functionEnd,
    };
  }

  private static buildVariableTypeMapLegacy(
    lines: string[],
    upToLine: number,
    functionInfo: FunctionInfo
  ): Map<string, string> {
    const varTypes = new Map<string, string>();

    if (functionInfo.name && functionInfo.start >= 0) {
      for (const param of GlslParser.parseFunctionParametersLegacy(lines, functionInfo.start)) {
        varTypes.set(param.name, param.type);
      }
    }

    const scanStart = functionInfo.start >= 0 ? functionInfo.start : 0;
    for (let i = scanStart; i <= upToLine && i < lines.length; i++) {
      for (const declaration of GlslParser.extractDeclarationsFromLine(lines[i])) {
        varTypes.set(declaration.name, declaration.type);
      }
    }

    return varTypes;
  }

  private static buildVariableLineMapLegacy(
    lines: string[],
    upToLine: number,
    functionInfo: FunctionInfo,
    knownVars?: Map<string, string>,
  ): Map<string, number> {
    const varLines = new Map<string, number>();

    if (functionInfo.name && functionInfo.start >= 0) {
      for (const param of GlslParser.parseFunctionParametersLegacy(lines, functionInfo.start)) {
        varLines.set(param.name, functionInfo.start);
      }
    }

    const varNames = knownVars ? new Set(knownVars.keys()) : new Set(varLines.keys());
    const scanStart = functionInfo.start >= 0 ? functionInfo.start : 0;

    for (let i = scanStart; i <= upToLine && i < lines.length; i++) {
      const line = lines[i];

      for (const declaration of GlslParser.extractDeclarationsFromLine(line)) {
        varLines.set(declaration.name, i);
        varNames.add(declaration.name);
      }

      const assignment = GlslParser.extractAssignedVariable(line);
      if (assignment && varNames.has(assignment.name)) {
        varLines.set(assignment.name, i);
      }
    }

    return varLines;
  }

  private static findFunctionReturnTypeLegacy(lines: string[], funcName: string): string | null {
    for (let i = 0; i < lines.length; i++) {
      const signature = GlslParser.getFullFunctionSignature(lines, i);
      const match = signature.match(new RegExp(`^\\s*(float|vec[234]|mat[234]|void|int|bool|sampler2D)\\s+${funcName}\\s*\\(`));
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  private static parseFunctionParametersLegacy(lines: string[], startLine: number): VarInfo[] {
    const parameters: VarInfo[] = [];
    const signature = GlslParser.getFullFunctionSignature(lines, startLine);
    const paramsMatch = signature.match(/\(([^)]*)\)/);
    if (!paramsMatch || !paramsMatch[1].trim()) {
      return parameters;
    }

    for (const pair of paramsMatch[1].split(',').map(p => p.trim())) {
      const tokens = GlslParser.tokenize(pair);
      const declaration = GlslParser.parseDeclarationTokens(tokens);
      if (declaration) {
        parameters.push(declaration);
      }
    }

    return parameters;
  }

  private static extractDeclarationsFromLine(line: string): VarInfo[] {
    const stripped = GlslParser.stripLineComments(line).trim();
    if (!stripped) return [];

    const declarations: VarInfo[] = [];

    const statementTokens = GlslParser.tokenize(stripped);
    const statementDeclaration = GlslParser.parseDeclarationTokens(statementTokens);
    if (statementDeclaration) {
      declarations.push(statementDeclaration);
    }

    if (stripped.startsWith('for')) {
      const openParen = stripped.indexOf('(');
      const closeParen = GlslParser.findMatchingParen(stripped, openParen);
      if (openParen >= 0 && closeParen > openParen) {
        const header = stripped.slice(openParen + 1, closeParen);
        const initializer = header.split(';', 1)[0]?.trim() ?? '';
        if (initializer) {
          const initTokens = GlslParser.tokenize(initializer);
          const initDeclaration = GlslParser.parseDeclarationTokens(initTokens);
          if (initDeclaration) {
            declarations.push(initDeclaration);
          }
        }
      }
    }

    return declarations;
  }

  private static extractAssignedVariable(line: string): { name: string; member: boolean } | null {
    const stripped = GlslParser.stripLineComments(line).trim();
    if (!stripped) return null;

    const tokens = GlslParser.tokenize(stripped);
    const assignmentIndex = GlslParser.findTopLevelAssignmentOperatorIndex(tokens);
    if (assignmentIndex <= 0) {
      return null;
    }

    const lhsTokens = tokens.slice(0, assignmentIndex);
    const assignedVar = GlslParser.extractAssignedRootIdentifier(lhsTokens);
    if (assignedVar) {
      return assignedVar;
    }

    return null;
  }

  private static getStatementInfo(
    lineContent: string,
    lines?: string[],
    lineIndex?: number,
  ): StatementInfo {
    const fallback = GlslParser.classifyStatement(lineContent, 0, 0);
    if (!lines || lineIndex === undefined || lineIndex < 0 || lineIndex >= lines.length) {
      return fallback;
    }

    const currentTrimmed = GlslParser.stripLineComments(lines[lineIndex] ?? lineContent).trim();
    if (!currentTrimmed) {
      return GlslParser.classifyStatement(lineContent, lineIndex, lineIndex);
    }

    if (GlslParser.isStandaloneControlFlowHeader(currentTrimmed)) {
      return GlslParser.classifyStatement(lines[lineIndex], lineIndex, lineIndex);
    }

    let startLine = lineIndex;
    while (startLine > 0) {
      const prev = GlslParser.stripLineComments(lines[startLine - 1]).trim();
      if (!prev || prev.endsWith(';') || prev.endsWith('{') || prev.endsWith('}')) {
        break;
      }
      if (GlslParser.isStandaloneControlFlowHeader(prev)) {
        break;
      }
      startLine--;
    }

    let endLine = lineIndex;
    while (endLine < lines.length - 1) {
      const current = GlslParser.stripLineComments(lines[endLine]).trim();
      if (current.endsWith(';')) {
        break;
      }
      if (endLine > lineIndex && (current.endsWith('{') || current.endsWith('}'))) {
        endLine--;
        break;
      }
      endLine++;
      const next = GlslParser.stripLineComments(lines[endLine]).trim();
      if (!next) {
        endLine--;
        break;
      }
    }

    const statementLines = lines.slice(startLine, endLine + 1);
    const statementText = statementLines.join(' ');
    return GlslParser.classifyStatement(statementText, startLine, endLine);
  }

  private static classifyStatement(text: string, startLine: number, endLine: number): StatementInfo {
    const strippedText = GlslParser.stripLineComments(text);
    const trimmed = strippedText.trim();

    const base: StatementInfo = {
      text,
      trimmed,
      startLine,
      endLine,
      kind: 'unknown',
    };

    if (!trimmed) {
      return { ...base, kind: 'empty' };
    }

    const tokens = GlslParser.tokenize(trimmed);
    if (tokens.length === 0) {
      return { ...base, kind: 'empty' };
    }

    const firstToken = tokens[0];
    if (firstToken.type === 'keyword' && firstToken.value === 'return') {
      return { ...base, kind: 'return' };
    }

    if (firstToken.type === 'keyword' && CONTROL_FLOW_KEYWORDS.has(firstToken.value)) {
      return { ...base, kind: 'controlFlow' };
    }

    const declaration = GlslParser.parseDeclarationTokens(tokens);
    if (declaration) {
      return {
        ...base,
        kind: 'declaration',
        declaredVar: declaration,
      };
    }

    const assignmentIndex = GlslParser.findTopLevelAssignmentOperatorIndex(tokens);
    if (assignmentIndex > 0) {
      const lhsTokens = tokens.slice(0, assignmentIndex);
      const assignedVar = GlslParser.extractAssignedRootIdentifier(lhsTokens);
      if (assignedVar) {
        const rhsTokens = tokens.slice(assignmentIndex + 1);
        return {
          ...base,
          kind: assignedVar.member ? 'memberAssignment' : 'assignment',
          assignedVarName: assignedVar.name,
          assignedExpression: GlslParser.tokensToExpression(lhsTokens),
          assignedValueType: GlslParser.inferExpressionType(rhsTokens),
        };
      }
    }

    if (
      tokens.length >= 2 &&
      tokens[0].type === 'identifier' &&
      tokens[1].value === '(' &&
      !GLSL_TYPES.has(tokens[0].value)
    ) {
      return {
        ...base,
        kind: 'call',
        callName: tokens[0].value,
      };
    }

    return base;
  }

  private static parseDeclarationTokens(tokens: Token[]): VarInfo | null {
    let index = 0;
    while (index < tokens.length && tokens[index].type === 'keyword' && PARAMETER_QUALIFIERS.has(tokens[index].value)) {
      index++;
    }

    const typeToken = tokens[index];
    const nameToken = tokens[index + 1];
    if (!typeToken || !nameToken) {
      return null;
    }

    const isTypeToken = typeToken.type === 'identifier' || typeToken.type === 'keyword';
    if (!isTypeToken || nameToken.type !== 'identifier') {
      return null;
    }

    const nextToken = tokens[index + 2];
    if (nextToken && !['=', ';', ',', ')'].includes(nextToken.value)) {
      return null;
    }

    return {
      name: nameToken.value,
      type: typeToken.value,
    };
  }

  private static extractAssignedRootIdentifier(lhsTokens: Token[]): { name: string; member: boolean } | null {
    if (lhsTokens.length === 1 && lhsTokens[0].type === 'identifier') {
      return { name: lhsTokens[0].value, member: false };
    }

    if (lhsTokens.length === 0 || lhsTokens[0].type !== 'identifier') {
      return null;
    }

    let index = 1;
    let sawAccessor = false;
    while (index < lhsTokens.length) {
      const token = lhsTokens[index];
      if (token.value === '.') {
        if (index + 1 >= lhsTokens.length || lhsTokens[index + 1].type !== 'identifier') {
          return null;
        }
        sawAccessor = true;
        index += 2;
        continue;
      }

      if (token.value === '[') {
        sawAccessor = true;
        let depth = 1;
        index++;
        while (index < lhsTokens.length && depth > 0) {
          if (lhsTokens[index].value === '[') depth++;
          if (lhsTokens[index].value === ']') depth--;
          index++;
        }
        if (depth !== 0) {
          return null;
        }
        continue;
      }

      return null;
    }

    return sawAccessor ? { name: lhsTokens[0].value, member: true } : null;
  }

  private static tokensToExpression(tokens: Token[]): string {
    return tokens.map(token => token.value).join('');
  }

  private static inferExpressionType(tokens: Token[]): string | undefined {
    if (tokens.length === 0) {
      return undefined;
    }

    const first = tokens[0];
    if ((first.type === 'identifier' || first.type === 'keyword') && GLSL_TYPES.has(first.value)) {
      return first.value;
    }

    return undefined;
  }

  private static findTopLevelAssignmentOperatorIndex(tokens: Token[]): number {
    let parenDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.value === '(') parenDepth++;
      if (token.value === ')') parenDepth--;
      if (token.value === '[') bracketDepth++;
      if (token.value === ']') bracketDepth--;

      if (parenDepth === 0 && bracketDepth === 0 && token.type === 'operator' && ASSIGNMENT_OPERATORS.has(token.value)) {
        return i;
      }
    }

    return -1;
  }

  private static tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < source.length) {
      const char = source[i];

      if (/\s/.test(char)) {
        i++;
        continue;
      }

      const twoCharOp = source.slice(i, i + 2);
      if (['+=', '-=', '*=', '/=', '==', '!=', '<=', '>=', '&&', '||', '++', '--'].includes(twoCharOp)) {
        tokens.push({ type: 'operator', value: twoCharOp });
        i += 2;
        continue;
      }

      if ('=+-*/<>!&|'.includes(char)) {
        tokens.push({ type: 'operator', value: char });
        i++;
        continue;
      }

      if ('(){}[];,.?:'.includes(char)) {
        tokens.push({ type: 'punctuation', value: char });
        i++;
        continue;
      }

      if (/\d/.test(char) || (char === '.' && /\d/.test(source[i + 1] ?? ''))) {
        let j = i + 1;
        while (j < source.length && /[\d.]/.test(source[j])) j++;
        tokens.push({ type: 'number', value: source.slice(i, j) });
        i = j;
        continue;
      }

      if (/[A-Za-z_]/.test(char)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
        const value = source.slice(i, j);
        const type = (GLSL_TYPES.has(value) || CONTROL_FLOW_KEYWORDS.has(value) || value === 'return' || PARAMETER_QUALIFIERS.has(value))
          ? 'keyword'
          : 'identifier';
        tokens.push({ type, value });
        i = j;
        continue;
      }

      i++;
    }

    return tokens;
  }

  private static isStandaloneControlFlowHeader(trimmed: string): boolean {
    if (!/^(for|if|while|switch)\s*\(/.test(trimmed)) {
      return false;
    }
    const openParen = trimmed.indexOf('(');
    const closeParen = GlslParser.findMatchingParen(trimmed, openParen);
    return closeParen !== -1;
  }

  private static findMatchingParen(text: string, openIndex: number): number {
    if (openIndex < 0 || text[openIndex] !== '(') {
      return -1;
    }

    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') depth--;
      if (depth === 0) {
        return i;
      }
    }

    return -1;
  }
}
