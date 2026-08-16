import {
  parseGlslDocument,
  type GlslAnalysisDocument,
  type GlslScope,
  type GlslSymbol,
} from '@shader-studio/glsl-analysis';

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
  | 'variableExpression'
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
  expressionVarName?: string;
  callName?: string;
}

interface Token {
  type: 'identifier' | 'keyword' | 'number' | 'operator' | 'punctuation';
  value: string;
}

interface ParsedFunctionInfo {
  name: string;
  start: number;
  end: number;
  returnType: string | null;
}

interface ParsedDocument {
  effectiveLines: string[];
  originalToProcessed: readonly number[];
  parsedSuccessfully: boolean;
  analysis: GlslAnalysisDocument;
  functions: ParsedFunctionInfo[];
}

// Type keywords recognized as GLSL declaration specifiers.
const GLSL_TYPES = new Set([
  'void',
  'float',
  'int',
  'uint',
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
        if (GlslParser.isInsideFunction(document.functions, i)) {
          continue;
        }
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
      for (const symbol of GlslParser.getScopeVariables(document, scope)) {
        const declarationLine = GlslParser.getCompatibilityDeclarationLine(symbol);
        if (declarationLine > upToLine) {
          continue;
        }

        const type = GlslParser.getCompatibilitySymbolType(document, symbol, functionInfo.start);
        if (type) {
          varTypes.set(symbol.name, type);
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
        for (const symbol of GlslParser.getScopeVariables(document, scope)) {
          const declarationLine = GlslParser.getCompatibilityDeclarationLine(symbol);
          if (declarationLine <= upToLine) {
            varLines.set(symbol.name, declarationLine);
          }
        }
      }
    }

    const varNames = knownVars ? new Set(knownVars.keys()) : new Set(varLines.keys());
    const scanStart = functionInfo.start >= 0 ? functionInfo.start : 0;

    for (let i = scanStart; i <= upToLine && i < document.effectiveLines.length; i++) {
      if (!functionInfo.name && GlslParser.isInsideFunction(document.functions, i)) {
        continue;
      }

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

  /** Returns declaration locations only; later assignments do not move them. */
  static buildVariableDeclarationLineMap(
    lines: string[],
    upToLine: number,
    functionInfo: FunctionInfo,
    knownVars?: Map<string, string>,
  ): Map<string, number> {
    const document = GlslParser.getDocument(lines);
    const declarationLines = new Map<string, number>();

    if (document.parsedSuccessfully && functionInfo.name && functionInfo.start >= 0) {
      for (const scope of GlslParser.getVisibleScopes(document, functionInfo, upToLine)) {
        for (const symbol of GlslParser.getScopeVariables(document, scope)) {
          const declarationLine = GlslParser.getCompatibilityDeclarationLine(symbol);
          if (
            declarationLine <= upToLine
            && (!knownVars || knownVars.has(symbol.name))
          ) {
            declarationLines.set(symbol.name, declarationLine);
          }
        }
      }
      return declarationLines;
    }

    if (functionInfo.name && functionInfo.start >= 0) {
      for (const parameter of GlslParser.parseFunctionParametersLegacy(lines, functionInfo.start)) {
        if (!knownVars || knownVars.has(parameter.name)) {
          declarationLines.set(parameter.name, functionInfo.start);
        }
      }
    }

    const scanStart = functionInfo.start >= 0 ? functionInfo.start : 0;
    for (let lineIndex = scanStart; lineIndex <= upToLine && lineIndex < document.effectiveLines.length; lineIndex++) {
      if (!functionInfo.name && GlslParser.isInsideFunction(document.functions, lineIndex)) {
        continue;
      }
      for (const declaration of GlslParser.extractDeclarationsFromLine(document.effectiveLines[lineIndex])) {
        if (!knownVars || knownVars.has(declaration.name)) {
          declarationLines.set(declaration.name, lineIndex);
        }
      }
    }

    return declarationLines;
  }

  static getGlobalVariables(lines: string[], upToLine?: number): ScopedVarInfo[] {
    const document = GlslParser.getDocument(lines);
    const globals: ScopedVarInfo[] = [];
    const maxLine = upToLine === undefined
      ? document.effectiveLines.length - 1
      : Math.min(upToLine, document.effectiveLines.length - 1);

    for (let i = 0; i <= maxLine; i++) {
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
  ): VarInfo | null {
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

    switch (statement.kind) {
      case 'return':
        if (functionReturnType) {
          return { name: '_dbgReturn', type: functionReturnType };
        }
        break;

      case 'declaration':
        if (statement.declaredVar) {
          return statement.declaredVar;
        }
        break;

      case 'assignment':
      case 'memberAssignment':
        if (statement.assignedVarName) {
          const varType = varTypes.get(statement.assignedVarName);
          if (varType) {
            if (
              statement.kind === 'memberAssignment' &&
              !GLSL_TYPES.has(varType) &&
              statement.assignedExpression &&
              statement.assignedValueType
            ) {
              return { name: statement.assignedExpression, type: statement.assignedValueType };
            }
            return { name: statement.assignedVarName, type: varType };
          }
        }
        break;

      case 'variableExpression':
        if (statement.expressionVarName) {
          const varType = varTypes.get(statement.expressionVarName);
          if (varType) {
            return { name: statement.expressionVarName, type: varType };
          }
        }
        break;

      case 'call':
        if (statement.callName && lines) {
          const returnType = GlslParser.findFunctionReturnType(lines, statement.callName);
          if (returnType && returnType !== 'void') {
            return { name: '_dbgCall', type: returnType };
          }
        }
        break;
    }

    return null;
  }

  static shouldClimbForNearestDebuggableLine(
    lineContent: string,
    lines?: string[],
    lineIndex?: number,
  ): boolean {
    const statement = GlslParser.getStatementInfo(lineContent, lines, lineIndex);

    if (statement.kind === 'empty' || statement.kind === 'controlFlow') {
      return true;
    }

    if (statement.trimmed === '{' || statement.trimmed === '}') {
      return true;
    }

    if (statement.kind === 'call' && statement.callName && lines) {
      return GlslParser.findFunctionReturnType(lines, statement.callName) === 'void';
    }

    return false;
  }

  static shouldSurfaceCompileErrorForLine(
    lineContent: string,
    lines?: string[],
    lineIndex?: number,
  ): boolean {
    const statement = GlslParser.getStatementInfo(lineContent, lines, lineIndex);

    if (statement.kind === 'empty') {
      return false;
    }

    if (statement.kind === 'controlFlow') {
      return !GlslParser.isStandaloneControlFlowHeader(statement.trimmed);
    }

    if (statement.trimmed === '{' || statement.trimmed === '}') {
      return false;
    }

    const tokens = GlslParser.tokenize(statement.trimmed);
    if (tokens.length === 0) {
      return false;
    }

    if (GlslParser.hasUnbalancedGrouping(tokens)) {
      return true;
    }

    const assignmentIndex = GlslParser.findTopLevelAssignmentOperatorIndex(tokens);
    if (assignmentIndex > 0) {
      const rhsTokens = tokens.slice(assignmentIndex + 1).filter((token) => token.value !== ';');
      if (rhsTokens.length === 0) {
        return true;
      }
    }

    if (
      tokens[0]?.type === 'keyword' &&
      CONTROL_FLOW_KEYWORDS.has(tokens[0].value) &&
      !GlslParser.isStandaloneControlFlowHeader(statement.trimmed)
    ) {
      return true;
    }

    if (
      tokens[0]?.type === 'identifier' &&
      tokens[1]?.value === '(' &&
      !GlslParser.isStandaloneFunctionCallTokens(tokens)
    ) {
      return true;
    }

    return false;
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
    const analysis = parseGlslDocument('debug:///shader.glsl', source, 'fragment');
    const processedLines = analysis.processedSource.split('\n');

    const effectiveLines = new Array(originalLines.length).fill('');
    for (let processedLine = 0; processedLine < processedLines.length; processedLine++) {
      const originalLine = analysis.processedToOriginal[processedLine];
      if (originalLine >= 0 && originalLine < effectiveLines.length) {
        effectiveLines[originalLine] = processedLines[processedLine];
      }
    }

    const document: ParsedDocument = {
      effectiveLines,
      originalToProcessed: analysis.originalToProcessed,
      parsedSuccessfully: analysis.parsedSuccessfully,
      analysis,
      functions: GlslParser.extractFunctions(analysis),
    };

    DOC_CACHE.set(source, document);
    return document;
  }

  private static extractFunctions(analysis: GlslAnalysisDocument): ParsedFunctionInfo[] {
    const functions: ParsedFunctionInfo[] = [];
    const claimedScopes = new Set<string>();

    for (const symbol of analysis.symbols) {
      if (symbol.kind !== 'function') {
        continue;
      }

      const scope = analysis.scopes
        .filter(candidate =>
          candidate.kind === 'function' &&
          candidate.name === symbol.name &&
          !claimedScopes.has(candidate.id) &&
          candidate.range.start.line >= symbol.definition.start.line
        )
        .sort((left, right) => left.range.start.line - right.range.start.line)[0];
      if (!scope) {
        continue;
      }

      claimedScopes.add(scope.id);
      functions.push({
        name: symbol.name,
        start: symbol.definition.start.line,
        end: scope.range.end.line,
        returnType: symbol.typeName && GLSL_TYPES.has(symbol.typeName) ? symbol.typeName : null,
      });
    }

    return functions;
  }

  private static isInsideFunction(functions: ParsedFunctionInfo[], line: number): boolean {
    return functions.some((fn) => line >= fn.start && line <= fn.end);
  }

  private static getVisibleScopes(document: ParsedDocument, functionInfo: FunctionInfo, upToLine: number): GlslScope[] {
    const processedLine = GlslParser.resolveProcessedLine(document, upToLine, functionInfo.start);

    return document.analysis.scopes
      .filter(scope => scope.name !== 'global')
      .map(scope => {
        const start = scope.range.start.line;
        const end = scope.range.end.line;
        return { scope, start, end };
      })
      .filter(entry =>
        entry.start >= functionInfo.start &&
        entry.end <= functionInfo.end &&
        processedLine >= GlslParser.resolveProcessedLine(document, entry.start, functionInfo.start) &&
        processedLine <= GlslParser.resolveProcessedLine(document, entry.end, functionInfo.start)
      )
      .sort((a, b) => a.start! - b.start!)
      .map(entry => entry.scope);
  }

  private static getScopeVariables(document: ParsedDocument, scope: GlslScope): GlslSymbol[] {
    const symbolIds = new Set(scope.symbolIds);
    return document.analysis.symbols.filter(symbol =>
      symbolIds.has(symbol.id) &&
      (symbol.kind === 'variable' || symbol.kind === 'parameter')
    );
  }

  private static getCompatibilityDeclarationLine(symbol: GlslSymbol): number {
    return symbol.kind === 'parameter'
      ? symbol.definition.start.line
      : symbol.declaration.start.line;
  }

  private static getCompatibilitySymbolType(
    document: ParsedDocument,
    symbol: GlslSymbol,
    functionStart: number,
  ): string | null {
    if (symbol.kind === 'parameter') {
      return symbol.typeName && GLSL_TYPES.has(symbol.typeName) ? symbol.typeName : null;
    }

    const declarationLine = symbol.declaration.start.line;
    if (declarationLine < 0 || declarationLine >= document.effectiveLines.length) {
      return null;
    }

    const signatureLine = declarationLine === functionStart
      ? GlslParser.getFullFunctionSignature(document.effectiveLines, functionStart)
      : document.effectiveLines[declarationLine];

    return GlslParser.extractDeclarationsFromLine(signatureLine)
      .find(declaration => declaration.name === symbol.name)?.type ?? null;
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

  private static resolveClosingBraceLine(lines: string[], lineNum: number): number {
    const strippedCursor = GlslParser.stripLineComments(lines[lineNum] ?? '').trim();
    return strippedCursor === '}' && lineNum > 0 ? lineNum - 1 : lineNum;
  }

  private static stripLineComments(line: string | undefined | null): string {
    if (!line) {
      return '';
    }
    const commentIndex = line.indexOf('//');
    return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
  }

  private static findEnclosingFunctionLegacy(lines: string[], lineNum: number): FunctionInfo {
    const functionDeclPattern = /(?:void|float|int|uint|bool|vec[234]|mat[234]|sampler2D)\s+(\w+)\s*\(/;

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
        if (functionEnd !== -1) {
          break;
        }
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
        if (char === '{') {
          braceDepth--;
        }
        if (char === '}') {
          braceDepth++;
        }
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
        if (functionEnd !== -1) {
          break;
        }
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
      const match = signature.match(new RegExp(`^\\s*(float|vec[234]|mat[234]|void|int|uint|bool|sampler2D)\\s+${funcName}\\s*\\(`));
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

  /**
   * Extracts the parameter names from the top-level mainImage function.
   * Returns { fragColorName, fragCoordName } defaulting to the standard names
   * if the function isn't found or its signature is non-standard.
   */
  static getMainImageParameterNames(
    lines: string[],
  ): { fragColorName: string; fragCoordName: string } {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^void\s+mainImage\s*\(/.test(trimmed)) {
        const params = GlslParser.parseFunctionParametersLegacy(lines, i);
        const outParam = params.find((p) => p.type === 'vec4');
        const inParam = params.find((p) => p.type === 'vec2');
        if (outParam || inParam) {
          return {
            fragColorName: outParam?.name ?? 'fragColor',
            fragCoordName: inParam?.name ?? 'fragCoord',
          };
        }
      }
    }
    return { fragColorName: 'fragColor', fragCoordName: 'fragCoord' };
  }

  private static extractDeclarationsFromLine(line: string): VarInfo[] {
    const stripped = GlslParser.stripLineComments(line).trim();
    if (!stripped) {
      return [];
    }

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
    if (!stripped) {
      return null;
    }

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
      GlslParser.isStandaloneFunctionCallTokens(tokens) &&
      tokens[0].type === 'identifier' &&
      !GLSL_TYPES.has(tokens[0].value)
    ) {
      return {
        ...base,
        kind: 'call',
        callName: tokens[0].value,
      };
    }

    if (
      tokens.length === 2 &&
      tokens[0].type === 'identifier' &&
      tokens[1].value === ';' &&
      !GLSL_TYPES.has(tokens[0].value)
    ) {
      return {
        ...base,
        kind: 'variableExpression',
        expressionVarName: tokens[0].value,
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

  private static isStandaloneFunctionCallTokens(tokens: Token[]): boolean {
    if (tokens.length < 4) {
      return false;
    }

    if (tokens[0].type !== 'identifier' || tokens[1].value !== '(' || tokens[tokens.length - 1].value !== ';') {
      return false;
    }

    let parenDepth = 0;
    let closeParenIndex = -1;
    for (let i = 1; i < tokens.length; i++) {
      const value = tokens[i].value;
      if (value === '(') {
        parenDepth++;
      } else if (value === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          closeParenIndex = i;
          break;
        }
        if (parenDepth < 0) {
          return false;
        }
      }
    }

    return closeParenIndex === tokens.length - 2;
  }

  private static hasUnbalancedGrouping(tokens: Token[]): boolean {
    const openToClose = new Map([
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]);
    const closingTokens = new Set([')', ']', '}']);
    const stack: string[] = [];

    for (const token of tokens) {
      if (openToClose.has(token.value)) {
        stack.push(token.value);
        continue;
      }

      if (!closingTokens.has(token.value)) {
        continue;
      }

      const open = stack.pop();
      if (!open || openToClose.get(open) !== token.value) {
        return true;
      }
    }

    return stack.length > 0;
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
          if (lhsTokens[index].value === '[') {
            depth++;
          }
          if (lhsTokens[index].value === ']') {
            depth--;
          }
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
      if (token.value === '(') {
        parenDepth++;
      }
      if (token.value === ')') {
        parenDepth--;
      }
      if (token.value === '[') {
        bracketDepth++;
      }
      if (token.value === ']') {
        bracketDepth--;
      }

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
        while (j < source.length && /[\d.]/.test(source[j])) {
          j++;
        }
        tokens.push({ type: 'number', value: source.slice(i, j) });
        i = j;
        continue;
      }

      if (/[A-Za-z_]/.test(char)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) {
          j++;
        }
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
      if (text[i] === '(') {
        depth++;
      }
      if (text[i] === ')') {
        depth--;
      }
      if (depth === 0) {
        return i;
      }
    }

    return -1;
  }
}
