import type { ShaderStage } from "@shader-studio/types";
import { SHADER_STUDIO_BUILTIN_UNIFORMS, SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS } from "@shader-studio/types";
import type { Position, Range } from "vscode-languageserver-protocol";
import type {
  WgslAnalysisDocument,
  WgslInferenceContext,
  WgslParseDiagnostic,
  WgslScope,
  WgslStatementKind,
  WgslSymbol,
  WgslSymbolKind,
  WgslUnresolvedReference,
} from "./model.js";
import { tokenizeWgsl, type WgslToken } from "./tokenizer.js";
import { isBuiltinValueType, matrixType, parseWgslArrayType, parseWgslPointerType, resolveSwizzleType, vectorType, vectorTypeName } from "./wgslTypes.js";

export type WgslExpression =
  | { readonly kind: "identifier"; readonly name: string }
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly WgslExpression[] }
  | { readonly kind: "member"; readonly object: WgslExpression; readonly member: string }
  | { readonly kind: "index"; readonly object: WgslExpression; readonly index: WgslExpression }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: WgslExpression }
  | { readonly kind: "binary"; readonly operator: string; readonly left: WgslExpression; readonly right: WgslExpression };

interface MutableSymbol {
  id: string;
  name: string;
  kind: WgslSymbolKind;
  typeName?: string;
  signature?: string;
  declaration: Range;
  definition: Range;
  references: Range[];
  scopeId: string;
}

interface MutableScope {
  id: string;
  name: string;
  kind: WgslScope["kind"];
  parentId?: string;
  start: Position;
  end: Position;
  symbolIds: string[];
}

interface ScopeBindings {
  values: Map<string, MutableSymbol>;
  types: Map<string, MutableSymbol>;
  functions: Map<string, MutableSymbol[]>;
}

interface TypeText {
  readonly text: string;
}

const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);

/** Template heads that never name a user type (`array<…>`, `vec3<…>`, …). */
const WGSL_TYPE_CONSTRUCT_HEADS = new Set([
  "array", "atomic", "ptr",
  "vec2", "vec3", "vec4",
  "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
  "texture_1d", "texture_2d", "texture_2d_array", "texture_3d",
  "texture_cube", "texture_cube_array", "texture_multisampled_2d",
  "texture_storage_1d", "texture_storage_2d", "texture_storage_2d_array", "texture_storage_3d",
]);

/** Identifiers inside template lists that are never type references. */
const WGSL_TYPE_MODIFIERS = new Set([
  "function", "private", "storage", "uniform", "workgroup", "handle",
  "read", "write", "read_write",
]);

class WgslParser {
  private readonly source: string;
  private readonly tokens: WgslToken[];
  private readonly lineStarts: number[];
  private index = 0;
  private readonly pending: WgslToken[] = [];
  private symbols: MutableSymbol[] = [];
  private scopes: MutableScope[] = [];
  private statements: Array<{ kind: WgslStatementKind; start: Position; end: Position; scopeId: string }> = [];
  /**
   * Declarations in a `for` initializer. They are part of the loop statement,
   * not statements of their own, but their initializers still type the symbol.
   */
  private readonly forInitializerDeclarations: Array<{ start: Position; end: Position; scopeId: string }> = [];
  private scopeStack: Array<{ frame: MutableScope; bindings: ScopeBindings }> = [];
  private readonly unresolved = new Map<string, { name: string; kind: WgslUnresolvedReference["kind"]; ranges: Range[] }>();
  private readonly diagnostics: WgslParseDiagnostic[] = [];
  private nextId = 0;
  private readonly hostGlobalIds = new Set<string>();
  /** End offset of the last token consumed, where a statement ends. */
  private lastConsumedEnd = 0;

  constructor(source: string, private readonly context: WgslInferenceContext = {}) {
    this.source = source;
    this.tokens = tokenizeWgsl(source);
    this.lineStarts = buildLineStarts(source);
  }

  parseDocument(uri: string, stage: ShaderStage): WgslAnalysisDocument {
    this.beginScope("global", "global", { line: 0, character: 0 });
    this.seedHostGlobals(stage);
    while (!this.atEnd()) {
      if (this.checkText(";")) {
        this.advance();
        continue;
      }
      this.parseGlobalDeclaration();
    }
    const eof = this.positionAt(this.source.length);
    while (this.scopeStack.length > 0) {
      this.endScope(eof);
    }
    this.orderHostGlobalsLast();
    this.inferDeclarationTypes();
    const lines = this.source.split("\n");
    const identity = lines.map((_, line) => line);
    return {
      uri,
      source: this.source,
      processedSource: this.source,
      stage,
      parsedSuccessfully: this.diagnostics.length === 0,
      symbols: this.symbols.map((symbol) => ({ ...symbol, references: [...symbol.references] })),
      scopes: this.scopes.map((scope) => ({
        id: scope.id,
        name: scope.name,
        kind: scope.kind,
        ...(scope.parentId === undefined ? {} : { parentId: scope.parentId }),
        range: { start: { ...scope.start }, end: { ...scope.end } },
        symbolIds: [...scope.symbolIds],
      })),
      diagnostics: [...this.diagnostics],
      unresolvedReferences: [...this.unresolved.values()].map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        ranges: [...entry.ranges],
      })),
      statements: this.statements.map((statement) => ({
        kind: statement.kind,
        range: { start: { ...statement.start }, end: { ...statement.end } },
        scopeId: statement.scopeId,
      })),
      originalToProcessed: [...identity],
      processedToOriginal: [...identity],
      hostGlobalIds: new Set(this.hostGlobalIds),
    };
  }

  // -- token cursor ---------------------------------------------------------

  private peek(): WgslToken {
    if (this.pending.length > 0) {
      return this.pending[this.pending.length - 1]!;
    }
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): WgslToken {
    let token: WgslToken;
    if (this.pending.length > 0) {
      token = this.pending.pop()!;
    } else {
      token = this.tokens[this.index]!;
      if (this.index < this.tokens.length - 1) {
        this.index += 1;
      }
    }
    if (token.kind !== "eof") {
      this.lastConsumedEnd = token.offset + token.text.length;
    }
    return token;
  }

  private unget(token: WgslToken): void {
    this.pending.push(token);
  }

  private atEnd(): boolean {
    return this.peek().kind === "eof";
  }

  private checkText(text: string): boolean {
    return this.peek().text === text;
  }

  private checkKind(kind: WgslToken["kind"]): boolean {
    return this.peek().kind === kind;
  }

  private positionAt(offset: number): Position {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.lineStarts[mid]! <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return { line: low, character: offset - this.lineStarts[low]! };
  }

  private tokenStart(token: WgslToken): Position {
    return { line: token.line, character: token.character };
  }

  private tokenEnd(token: WgslToken): Position {
    return this.positionAt(token.offset + token.text.length);
  }

  private tokenRange(token: WgslToken): Range {
    return { start: this.tokenStart(token), end: this.tokenEnd(token) };
  }

  // -- scopes and symbols ----------------------------------------------------

  private beginScope(name: string, kind: WgslScope["kind"], start: Position): void {
    const parent = this.scopeStack[this.scopeStack.length - 1];
    const frame: MutableScope = {
      id: `wgsl:${this.nextId++}`,
      name,
      kind,
      ...(parent === undefined ? {} : { parentId: parent.frame.id }),
      start,
      end: start,
      symbolIds: [],
    };
    this.scopes.push(frame);
    this.scopeStack.push({
      frame,
      bindings: { values: new Map(), types: new Map(), functions: new Map() },
    });
  }

  private endScope(end: Position): void {
    const scope = this.scopeStack.pop();
    if (scope) {
      scope.frame.end = end;
    }
  }

  private currentBindings(): ScopeBindings {
    return this.scopeStack[this.scopeStack.length - 1]!.bindings;
  }

  private declareSymbol(
    name: string,
    kind: WgslSymbolKind,
    nameToken: WgslToken,
    options: { typeName?: string; signature?: string } = {},
  ): MutableSymbol {
    const frame = this.scopeStack[this.scopeStack.length - 1]!.frame;
    const symbol: MutableSymbol = {
      id: `wgsl:${this.nextId++}`,
      name,
      kind,
      ...(options.typeName === undefined ? {} : { typeName: options.typeName }),
      ...(options.signature === undefined ? {} : { signature: options.signature }),
      declaration: this.tokenRange(nameToken),
      definition: this.tokenRange(nameToken),
      references: [],
      scopeId: frame.id,
    };
    this.symbols.push(symbol);
    frame.symbolIds.push(symbol.id);
    const bindings = this.currentBindings();
    if (kind === "function") {
      const list = bindings.functions.get(name) ?? [];
      list.push(symbol);
      bindings.functions.set(name, list);
    } else if (kind === "type") {
      bindings.types.set(name, symbol);
    } else {
      bindings.values.set(name, symbol);
    }
    return symbol;
  }

  private recordValueReference(name: string, token: WgslToken, isCall: boolean): void {
    for (let depth = this.scopeStack.length - 1; depth >= 0; depth--) {
      const bindings = this.scopeStack[depth]!.bindings;
      // A call can target a user type (a construction like `Color(...)`)
      // as well as a function, so type bindings resolve first for calls.
      const symbol = isCall
        ? bindings.types.get(name) ?? bindings.functions.get(name)?.[0] ?? bindings.values.get(name)
        : bindings.values.get(name) ?? bindings.functions.get(name)?.[0] ?? bindings.types.get(name);
      if (symbol) {
        symbol.references.push(this.tokenRange(token));
        return;
      }
    }
    if (isCall && isBuiltinValueType(name)) {
      return;
    }
    this.recordUnresolved(name, isCall ? "function" : "variable", this.tokenRange(token));
  }

  private recordTypeReference(name: string, token: WgslToken): void {
    if (isBuiltinValueType(name) || WGSL_TYPE_CONSTRUCT_HEADS.has(name) || WGSL_TYPE_MODIFIERS.has(name)) {
      return;
    }
    for (let depth = this.scopeStack.length - 1; depth >= 0; depth--) {
      const symbol = this.scopeStack[depth]!.bindings.types.get(name);
      if (symbol) {
        symbol.references.push(this.tokenRange(token));
        return;
      }
    }
    this.recordUnresolved(name, "type", this.tokenRange(token));
  }

  /**
   * Declares the Shader Studio host globals (iTime, iResolution, ...) as
   * synthetic global variables so references resolve, hovers complete, and
   * type inference sees through them. Types come from the builtin-uniform
   * catalog filtered to this document's language and stage; user declarations
   * naturally shadow them through the scope bindings.
   */
  private seedHostGlobals(stage: ShaderStage): void {
    const global = this.scopeStack[0];
    if (!global) {
      return;
    }
    const origin = { line: 0, character: 0 };
    const declare = (name: string, typeName: string): void => {
      const symbol: MutableSymbol = {
        id: `wgsl:${this.nextId++}`,
        name,
        kind: "variable",
        scopeId: global.frame.id,
        typeName,
        declaration: { start: { ...origin }, end: { ...origin } },
        definition: { start: { ...origin }, end: { ...origin } },
        references: [],
      };
      this.symbols.push(symbol);
      global.bindings.values.set(name, symbol);
      global.frame.symbolIds.push(symbol.id);
      this.hostGlobalIds.add(symbol.id);
    };
    for (const entry of SHADER_STUDIO_BUILTIN_UNIFORMS) {
      if (!entry.languages.includes("wgsl") || (entry.stages !== undefined && !entry.stages.includes(stage))) {
        continue;
      }
      const typeName = wgslHostGlobalType(entry.slangType);
      if (typeName !== undefined) {
        declare(entry.name, typeName);
      }
    }
    for (const entry of SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS) {
      if (!entry.languages.includes("wgsl") || !entry.stages.some((allowed) => allowed === stage)) {
        continue;
      }
      const typeName = wgslHostGlobalType(entry.slangType);
      if (typeName !== undefined) {
        declare(entry.name, typeName);
      }
    }
  }

  /**
   * Moves synthetic host globals after user declarations in the global scope
   * so name-based visibility lists the user's shadowing declaration first.
   */
  private orderHostGlobalsLast(): void {
    const global = this.scopes.find((scope) => scope.parentId === undefined);
    if (!global || this.hostGlobalIds.size === 0) {
      return;
    }
    const userFirst = global.symbolIds.filter((id) => !this.hostGlobalIds.has(id));
    const syntheticsLast = global.symbolIds.filter((id) => this.hostGlobalIds.has(id));
    global.symbolIds = [...userFirst, ...syntheticsLast];
  }

  /**
   * Fills in types of unannotated `let`/`var`/`const` declarations from their
   * initializers. Only runs when the annotation is absent, so explicit types
   * are never rewritten; anything the conservative rules below cannot prove
   * stays undefined exactly as before.
   */
  private inferDeclarationTypes(): void {
    const visiting = new Set<string>();
    const inferSymbol = (symbol: MutableSymbol, depth: number): string | undefined => {
      if (symbol.typeName !== undefined) {
        return symbol.typeName;
      }
      if ((symbol.kind !== "variable" && symbol.kind !== "constant")
        || visiting.has(symbol.id) || depth > 16) {
        return undefined;
      }
      const statement = [
        ...this.statements.filter((candidate) => candidate.kind === "declaration"),
        ...this.forInitializerDeclarations,
      ].find((candidate) => candidate.scopeId === symbol.scopeId
        && containsDocumentRange(candidate, symbol.declaration));
      if (!statement) {
        return undefined;
      }
      const initializer = splitDeclarationInitializer(this.source, statement);
      const parsed = initializer ? parseWgslExpression(initializer) : undefined;
      if (!parsed) {
        return undefined;
      }
      visiting.add(symbol.id);
      try {
        const inferred = this.inferExpressionType(parsed, symbol, inferSymbol, depth + 1);
        if (inferred !== undefined) {
          symbol.typeName = inferred;
        }
        return inferred;
      } finally {
        visiting.delete(symbol.id);
      }
    };
    for (const symbol of this.symbols) {
      inferSymbol(symbol, 0);
    }
  }

  private resolveAliasType(typeName: string): string {
    const visited = new Set<string>();
    let resolved = typeName;
    while (!visited.has(resolved)) {
      visited.add(resolved);
      const alias = this.symbols.find(symbol => symbol.kind === "type" && symbol.name === resolved && symbol.typeName !== undefined);
      if (!alias?.typeName) {
        break;
      }
      resolved = alias.typeName;
    }
    return resolved;
  }

  private inferExpressionType(
    expression: WgslExpression,
    self: MutableSymbol,
    inferSymbol: (symbol: MutableSymbol, depth: number) => string | undefined,
    depth: number,
  ): string | undefined {
    switch (expression.kind) {
      case "identifier": {
        const target = this.resolveValueSymbol(expression.name, self);
        if (!target) {
          return this.context.valueType?.(expression.name);
        }
        return target.id === self.id ? undefined : inferSymbol(target, depth);
      }
      case "literal":
        return scalarLiteralType(expression.text);
      case "call": {
        if (isBuiltinValueType(expression.name)) {
          return expression.name;
        }
        const builtin = this.inferBuiltinCallType(expression, self, inferSymbol, depth);
        if (builtin !== undefined) {
          return builtin;
        }
        const callee = this.symbols.find((candidate) => candidate.kind === "function"
          && candidate.name === expression.name && candidate.typeName !== undefined);
        if (callee?.typeName !== undefined) {
          return callee.typeName;
        }
        const structType = this.symbols.find((candidate) => candidate.kind === "type"
          && candidate.name === expression.name);
        if (structType) {
          return structType.name;
        }
        const external = this.context.functionType?.(expression.name);
        return external !== undefined && isConcreteTypeName(external) ? external : undefined;
      }
      case "member": {
        const owner = this.inferExpressionType(expression.object, self, inferSymbol, depth);
        if (owner === undefined) {
          return undefined;
        }
        const resolved = this.resolveAliasType(owner);
        const typeScope = this.scopes.find(scope => scope.kind === "type" && scope.name === resolved);
        if (!typeScope) {
          return resolveSwizzleType(resolved, expression.member) ?? this.context.fieldType?.(resolved, expression.member);
        }
        return this.symbols.find(symbol => symbol.kind === "field" && symbol.scopeId === typeScope.id && symbol.name === expression.member)?.typeName;
      }
      case "index": {
        const owner = this.inferExpressionType(expression.object, self, inferSymbol, depth);
        if (owner === undefined) {
          return undefined;
        }
        const resolved = this.resolveAliasType(owner);
        const matrix = matrixType(resolved);
        return parseWgslArrayType(resolved)?.elementType ?? vectorType(resolved)?.componentType
          ?? (matrix ? vectorTypeName(matrix.componentType, matrix.rows) : undefined);
      }
      case "unary": {
        if (expression.operator === "!") {
          return "bool";
        }
        if (expression.operator === "-" || expression.operator === "+" || expression.operator === "~") {
          return this.inferExpressionType(expression.operand, self, inferSymbol, depth);
        }
        if (expression.operator === "*") {
          const pointer = this.inferExpressionType(expression.operand, self, inferSymbol, depth);
          return pointer === undefined ? undefined : parseWgslPointerType(this.resolveAliasType(pointer))?.elementType;
        }
        return undefined;
      }
      case "binary": {
        if (COMPARISON_OPERATORS.has(expression.operator)
          || expression.operator === "&&" || expression.operator === "||") {
          return "bool";
        }
        if (!ARITHMETIC_OPERATORS.has(expression.operator)) {
          return undefined;
        }
        const left = this.inferExpressionType(expression.left, self, inferSymbol, depth);
        const right = this.inferExpressionType(expression.right, self, inferSymbol, depth);
        if (left === undefined || right === undefined) {
          return undefined;
        }
        if (sameWgslType(left, right)) {
          return left;
        }
        // WGSL splats a scalar across a vector operand.
        if (isWgslScalarType(left) && vectorType(right) !== undefined) {
          return right;
        }
        if (isWgslScalarType(right) && vectorType(left) !== undefined) {
          return left;
        }
        return undefined;
      }
    }
  }

  /**
   * Result type of a builtin call from its arguments. Only covers builtins
   * whose result is fixed by their inputs: type-preserving unary math,
   * same-or-splatted multi-argument math, and component-reducing queries.
   * Anything else (sampling, packing, atomics, derivatives) stays undefined.
   */
  private inferBuiltinCallType(
    expression: { readonly name: string; readonly args: readonly WgslExpression[] },
    self: MutableSymbol,
    inferSymbol: (symbol: MutableSymbol, depth: number) => string | undefined,
    depth: number,
  ): string | undefined {
    const arguments_ = expression.args.map((argument) => this.inferExpressionType(argument, self, inferSymbol, depth + 1));
    if (TYPE_PRESERVING_BUILTINS.has(expression.name)) {
      return arguments_.length > 0 ? arguments_[0] : undefined;
    }
    if (expression.name === "arrayLength") {
      return "u32";
    }
    if (expression.name === "select") {
      const [falseValue, trueValue] = arguments_;
      return falseValue !== undefined && trueValue !== undefined && sameWgslType(falseValue, trueValue) ? falseValue : undefined;
    }
    if (expression.name === "dot" || expression.name === "length" || expression.name === "distance") {
      const vector = arguments_.length > 0 && arguments_[0] !== undefined
        ? vectorType(arguments_[0]!)
        : undefined;
      return vector?.componentType;
    }
    if (!VARIADIC_MATH_BUILTINS.has(expression.name)) {
      return undefined;
    }
    const defined = arguments_.filter((argument): argument is string => argument !== undefined);
    if (defined.length === 0 || defined.length !== arguments_.length) {
      return undefined;
    }
    if (defined.every((argument) => sameWgslType(argument, defined[0]!))) {
      return defined[0];
    }
    // WGSL splats scalar arguments across a vector one (mix, clamp, ...).
    const vectors = defined.filter((argument) => vectorType(argument) !== undefined);
    if (vectors.length > 0 && vectors.every((argument) => sameWgslType(argument, vectors[0]!))
      && defined.every((argument) => sameWgslType(argument, vectors[0]!) || isWgslScalarType(argument))) {
      return vectors[0];
    }
    return undefined;
  }

  /**
   * Innermost value with `name` declared before `self`'s own declaration, so
   * shadowing and forward references resolve the way the language does.
   */
  private resolveValueSymbol(name: string, self: MutableSymbol): MutableSymbol | undefined {
    let scopeId: string | undefined = self.scopeId;
    while (scopeId !== undefined) {
      const scope = this.scopes.find((candidate) => candidate.id === scopeId);
      let best: MutableSymbol | undefined;
      for (const symbol of this.symbols) {
        if (symbol.scopeId !== scopeId || symbol.name !== name || symbol.id === self.id) {
          continue;
        }
        if (symbol.kind !== "variable" && symbol.kind !== "parameter" && symbol.kind !== "constant") {
          continue;
        }
        if (comparePosition(symbol.declaration.end, self.declaration.start) > 0) {
          continue;
        }
        if (!best || comparePosition(best.declaration.end, symbol.declaration.end) < 0) {
          best = symbol;
        }
      }
      if (best) {
        return best;
      }
      scopeId = scope?.parentId;
    }
    return undefined;
  }

  /** True when only the EOF token remains. Public for parseWgslExpression. */
  isAtEnd(): boolean {
    return this.atEnd();
  }

  /**
   * Snapshots reference side effects so a speculative parse (template list vs.
   * relational operator) can roll back when its hypothesis fails.
   */
  private snapshotSideEffects(): {
    readonly unresolvedKeys: Set<string>;
    readonly unresolvedLengths: Map<string, number>;
    readonly symbolLengths: Map<MutableSymbol, number>;
    readonly diagnosticLength: number;
    } {
    return {
      unresolvedKeys: new Set(this.unresolved.keys()),
      unresolvedLengths: new Map([...this.unresolved].map(([key, entry]) => [key, entry.ranges.length])),
      symbolLengths: new Map(this.symbols.map((symbol) => [symbol, symbol.references.length])),
      diagnosticLength: this.diagnostics.length,
    };
  }

  private restoreSideEffects(snapshot: ReturnType<WgslParser["snapshotSideEffects"]>): void {
    for (const key of [...this.unresolved.keys()]) {
      if (!snapshot.unresolvedKeys.has(key)) {
        this.unresolved.delete(key);
      } else {
        this.unresolved.get(key)!.ranges.length = snapshot.unresolvedLengths.get(key) ?? 0;
      }
    }
    for (const [symbol, length] of snapshot.symbolLengths) {
      symbol.references.length = length;
    }
    this.diagnostics.length = snapshot.diagnosticLength;
  }

  private recordUnresolved(name: string, kind: WgslUnresolvedReference["kind"], range: Range): void {
    const key = `${kind}:${name}`;
    const entry = this.unresolved.get(key);
    if (entry) {
      entry.ranges.push(range);
    } else {
      this.unresolved.set(key, { name, kind, ranges: [range] });
    }
  }

  private error(message: string, token: WgslToken): void {
    this.diagnostics.push({ code: "syntax", message, range: this.tokenRange(token), severity: 1 });
  }

  /**
   * Skips to the next `;` at brace depth 0 (consumed), an unbalanced `}`, or
   * EOF. Paren depth is ignored: a `;` inside unbalanced parens still ends the
   * broken statement instead of swallowing the rest of the document.
   */
  private recoverToStatementEnd(): void {
    let depth = 0;
    while (!this.atEnd()) {
      const token = this.peek();
      if (token.text === "{") {
        depth += 1;
      } else if (token.text === "}") {
        if (depth === 0) {
          return;
        }
        depth -= 1;
      } else if (token.text === ";" && depth === 0) {
        this.advance();
        return;
      }
      this.advance();
    }
  }

  // -- attributes and types ---------------------------------------------------

  private skipAttributes(): void {
    while (this.checkKind("attribute")) {
      this.advance();
      if (this.checkKind("identifier") || this.checkKind("keyword")) {
        this.advance();
      }
      if (this.checkText("(")) {
        this.skipBalanced("(", ")");
      }
    }
  }

  private skipBalanced(open: string, close: string): void {
    if (!this.checkText(open)) {
      return;
    }
    this.advance();
    let depth = 1;
    while (!this.atEnd() && depth > 0) {
      // Count characters so fused tokens (`>>`, `<<=`) cannot wedge the depth.
      for (const char of this.advance().text) {
        if (char === open) {
          depth += 1;
        } else if (char === close) {
          depth -= 1;
        }
      }
    }
  }

  /** Parses a type starting at an identifier, recording type references. */
  private parseType(): TypeText | undefined {
    const first = this.peek();
    if (first.kind !== "identifier" && first.kind !== "keyword") {
      this.error(`Expected a type but found '${first.text}'.`, first);
      return undefined;
    }
    this.advance();
    if (first.kind === "identifier") {
      this.recordTypeReference(first.text, first);
    }
    let endOffset = first.offset + first.text.length;
    if (this.checkText("<")) {
      const argsEnd = this.parseTemplateArgs();
      if (argsEnd === undefined) {
        return { text: this.source.slice(first.offset, endOffset) };
      }
      endOffset = argsEnd;
    }
    return { text: this.source.slice(first.offset, endOffset) };
  }

  /**
   * Parses `<...>` after the opening bracket was peeked. Returns the end offset
   * of the closing bracket, splitting a `>>` token when it closes nesting.
   */
  private parseTemplateArgs(): number | undefined {
    this.advance();
    let depth = 1;
    while (!this.atEnd() && depth > 0) {
      const token = this.advance();
      if (token.text === "<") {
        depth += 1;
      } else if (token.text === ">") {
        depth -= 1;
        if (depth === 0) {
          return token.offset + 1;
        }
      } else if (token.text === ">>") {
        depth -= 1;
        if (depth === 0) {
          // A fused `>>` closes one level here and leaves one `>` behind.
          this.unget({
            kind: "punctuation",
            text: ">",
            offset: token.offset + 1,
            line: token.line,
            character: token.character + 1,
          });
          return token.offset + 1;
        }
        depth -= 1;
        if (depth <= 0) {
          // Both brackets close nesting: the list ends after the second one.
          return token.offset + 2;
        }
      } else if (token.kind === "identifier") {
        this.recordTypeReference(token.text, token);
      }
    }
    this.error("Unterminated template argument list.", this.peek());
    return undefined;
  }

  // -- global declarations ----------------------------------------------------

  private parseGlobalDeclaration(): void {
    this.skipAttributes();
    if (this.atEnd()) {
      return;
    }
    const token = this.peek();
    // Statement recovery leaves an unmatched brace for its enclosing block.
    // At module scope there is no block to consume it.
    if (token.text === "}") {
      this.error("Unexpected '}' at global scope.", token);
      this.advance();
      return;
    }
    if (token.kind !== "keyword" && token.kind !== "identifier") {
      this.error(`Unexpected '${token.text}' at global scope.`, token);
      this.recoverToStatementEnd();
      return;
    }
    switch (token.text) {
      case "enable":
      case "requires":
      case "diagnostic":
      case "const_assert":
        this.skipToSemicolon();
        return;
      case "struct":
        this.parseStructDeclaration();
        return;
      case "alias":
        this.parseAliasDeclaration();
        return;
      case "var":
      case "let":
      case "const":
      case "override":
        this.parseVariableDeclaration();
        return;
      case "fn":
        this.parseFunctionDeclaration();
        return;
      default:
        this.error(`Unexpected '${token.text}' at global scope.`, token);
        this.recoverToStatementEnd();
    }
  }

  private skipToSemicolon(): void {
    while (!this.atEnd() && !this.checkText(";") && !this.checkText("}")) {
      const token = this.advance();
      if (token.text === "(" || token.text === "{") {
        this.skipBalanced(token.text, token.text === "(" ? ")" : "}");
      }
    }
    if (this.checkText(";")) {
      this.advance();
    }
  }

  private parseStructDeclaration(): void {
    const structToken = this.advance();
    const nameToken = this.peek();
    if (nameToken.kind !== "identifier") {
      this.error("Expected a struct name.", nameToken);
      this.recoverToStatementEnd();
      return;
    }
    this.advance();
    this.declareSymbol(nameToken.text, "type", nameToken);
    this.beginScope(nameToken.text, "type", this.tokenStart(structToken));
    if (!this.checkText("{")) {
      this.error("Expected '{' after the struct name.", this.peek());
      this.endScope(this.tokenStart(this.peek()));
      this.recoverToStatementEnd();
      return;
    }
    this.advance();
    while (!this.atEnd() && !this.checkText("}")) {
      this.skipAttributes();
      const memberToken = this.peek();
      if (memberToken.kind !== "identifier") {
        if (!this.checkText("}")) {
          this.error(`Unexpected '${memberToken.text}' in struct '${nameToken.text}'.`, memberToken);
          this.recoverToStatementEnd();
        }
        continue;
      }
      this.advance();
      if (!this.checkText(":")) {
        this.error("Expected ':' after the struct member name.", this.peek());
        this.recoverToStatementEnd();
        continue;
      }
      this.advance();
      this.skipAttributes();
      const memberType = this.parseType();
      this.declareSymbol(
        memberToken.text,
        "field",
        memberToken,
        memberType === undefined ? {} : { typeName: memberType.text },
      );
      if (this.checkText(",")) {
        this.advance();
      } else if (!this.checkText("}")) {
        this.error("Expected ',' or '}' in the struct body.", this.peek());
        this.recoverToStatementEnd();
      }
    }
    if (this.checkText("}")) {
      const end = this.advance();
      this.endScope(this.tokenEnd(end));
    } else {
      this.error(`Unterminated struct '${nameToken.text}'.`, this.peek());
      this.endScope(this.positionAt(this.source.length));
    }
  }

  private parseAliasDeclaration(): void {
    this.advance();
    const nameToken = this.peek();
    if (nameToken.kind !== "identifier") {
      this.error("Expected a name after 'alias'.", nameToken);
      this.recoverToStatementEnd();
      return;
    }
    this.advance();
    if (!this.checkText("=")) {
      this.error("Expected '=' in the alias declaration.", this.peek());
      this.recoverToStatementEnd();
      return;
    }
    this.advance();
    const aliased = this.parseType();
    this.declareSymbol(
      nameToken.text,
      "type",
      nameToken,
      aliased === undefined ? {} : { typeName: aliased.text },
    );
    if (!this.checkText(";")) {
      this.error("Expected ';' after the alias declaration.", this.peek());
    } else {
      this.advance();
    }
  }

  private parseVariableDeclaration(): void {
    const keyword = this.advance();
    if (this.checkText("<")) {
      this.skipBalanced("<", ">");
    }
    const nameToken = this.peek();
    if (nameToken.kind !== "identifier") {
      this.error(`Expected a variable name after '${keyword.text}'.`, nameToken);
      this.recoverToStatementEnd();
      return;
    }
    this.advance();
    let typeName: string | undefined;
    if (this.checkText(":")) {
      this.advance();
      this.skipAttributes();
      typeName = this.parseType()?.text;
    }
    if (this.checkText("=")) {
      this.advance();
      this.parseExpression();
    }
    const kind: WgslSymbolKind = keyword.text === "const" ? "constant" : "variable";
    this.declareSymbol(
      nameToken.text,
      kind,
      nameToken,
      typeName === undefined ? {} : { typeName },
    );
    if (!this.checkText(";")) {
      this.error(`Expected ';' after the '${nameToken.text}' declaration.`, this.peek());
      this.recoverToStatementEnd();
    } else {
      this.advance();
    }
  }

  private parseFunctionDeclaration(): void {
    const fnToken = this.advance();
    const nameToken = this.peek();
    if (nameToken.kind !== "identifier") {
      this.error("Expected a function name after 'fn'.", nameToken);
      this.recoverToStatementEnd();
      return;
    }
    this.advance();
    const symbol = this.declareSymbol(nameToken.text, "function", nameToken);
    this.beginScope(nameToken.text, "function", this.tokenStart(fnToken));
    if (!this.checkText("(")) {
      this.error("Expected '(' after the function name.", this.peek());
    } else {
      this.advance();
      this.parseParameterList();
      if (!this.checkText(")")) {
        this.error("Expected ')' after the parameter list.", this.peek());
      } else {
        this.advance();
      }
    }
    let returnType: string | undefined;
    if (this.checkText("->")) {
      this.advance();
      this.skipAttributes();
      returnType = this.parseType()?.text;
    }
    const parameters = this.scopeStack[this.scopeStack.length - 1]!.frame.symbolIds
      .map((id) => this.symbols.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is MutableSymbol => candidate?.kind === "parameter")
      .map((parameter) => parameter.typeName ?? "unknown");
    symbol.signature = `${nameToken.text}(${parameters.join(", ")})${returnType === undefined ? "" : ` -> ${returnType}`}`;
    if (returnType !== undefined) {
      symbol.typeName = returnType;
    }
    if (!this.checkText("{")) {
      this.error(`Expected '{' to start the '${nameToken.text}' body.`, this.peek());
      this.endScope(this.tokenStart(this.peek()));
      this.recoverToStatementEnd();
      return;
    }
    const bodyEnd = this.parseBlock();
    this.endScope(bodyEnd);
  }

  private parseParameterList(): void {
    // An unmatched brace ends a broken signature. Its caller reports the
    // missing ')' and module recovery consumes the brace on the next pass.
    while (!this.atEnd() && !this.checkText(")") && !this.checkText("}")) {
      this.skipAttributes();
      const nameToken = this.peek();
      if (nameToken.kind !== "identifier") {
        this.error("Expected a parameter name.", nameToken);
        this.recoverToStatementEnd();
        if (this.checkText(",")) {
          this.advance();
        }
        continue;
      }
      this.advance();
      if (!this.checkText(":")) {
        this.error(`Expected ':' after parameter '${nameToken.text}'.`, this.peek());
        this.recoverToStatementEnd();
        continue;
      }
      this.advance();
      this.skipAttributes();
      const parameterType = this.parseType();
      this.declareSymbol(
        nameToken.text,
        "parameter",
        nameToken,
        parameterType === undefined ? {} : { typeName: parameterType.text },
      );
      if (this.checkText(",")) {
        this.advance();
      } else if (!this.checkText(")")) {
        this.error("Expected ',' or ')' in the parameter list.", this.peek());
        this.recoverToStatementEnd();
      }
    }
  }

  // -- statements -------------------------------------------------------------

  /** Parses `{ ... }` in a child block scope. Returns the end position. */
  private parseBlock(): Position {
    const open = this.advance();
    this.beginScope("block", "block", this.tokenStart(open));
    while (!this.atEnd() && !this.checkText("}")) {
      this.parseStatement();
    }
    if (this.checkText("}")) {
      const end = this.advance();
      const endPosition = this.tokenEnd(end);
      this.endScope(endPosition);
      return endPosition;
    }
    this.error("Unterminated block.", this.peek());
    const eof = this.positionAt(this.source.length);
    this.endScope(eof);
    return eof;
  }

  private parseStatement(): void {
    this.skipAttributes();
    if (this.atEnd()) {
      return;
    }
    const token = this.peek();
    if (token.text === "{") {
      this.recordStatement("block", () => {
        this.parseBlock();
      });
      return;
    }
    if (token.text === ";") {
      this.advance();
      return;
    }
    // An expression statement can also start with '*' (assignment through a
    // dereferenced pointer) or '(' (a parenthesized call target). Both fall
    // through to the default branch, which parses an expression statement.
    if (token.kind !== "keyword" && token.kind !== "identifier" && token.text !== "*" && token.text !== "(") {
      this.error(`Unexpected '${token.text}' in statement position.`, token);
      this.recoverToStatementEnd();
      return;
    }
    switch (token.text) {
      case "var":
      case "let":
      case "const":
      case "override":
        this.recordStatement("declaration", () => {
          this.parseVariableDeclaration();
        });
        return;
      case "if":
        this.recordStatement("if", () => {
          this.parseIfStatement();
        });
        return;
      case "switch":
        this.recordStatement("switch", () => {
          this.parseSwitchStatement();
        });
        return;
      case "loop":
        this.recordStatement("loop", () => {
          this.parseLoopStatement();
        });
        return;
      case "for":
        this.recordStatement("for", () => {
          this.parseForStatement();
        });
        return;
      case "while":
        this.recordStatement("while", () => {
          this.advance();
          this.parseExpression();
          if (this.checkText("{")) {
            this.parseBlock();
          } else {
            this.error("Expected '{' after the while condition.", this.peek());
            this.recoverToStatementEnd();
          }
        });
        return;
      case "return":
        this.recordStatement("return", () => {
          this.advance();
          if (!this.checkText(";")) {
            this.parseExpression();
          }
          this.expectSemicolon("return");
        });
        return;
      case "break":
        this.recordStatement("break", () => {
          this.advance();
          if (this.checkText("if")) {
            this.advance();
            this.parseExpression();
          }
          this.expectSemicolon("break");
        });
        return;
      case "continue":
        this.recordStatement("continue", () => {
          this.advance();
          this.expectSemicolon("continue");
        });
        return;
      case "discard":
        this.recordStatement("discard", () => {
          this.advance();
          this.expectSemicolon("discard");
        });
        return;
      case "const_assert":
        this.recordStatement("const_assert", () => {
          this.advance();
          this.parseExpression();
          this.expectSemicolon("const_assert");
        });
        return;
      default:
        this.parseExpressionOrAssignmentStatement();
    }
  }

  /**
   * Records a statement range in source order. The placeholder is pushed before
   * parsing so an outer control-flow statement precedes its nested statements.
   */
  private recordStatement(kind: WgslStatementKind, parse: () => void): void {
    const start = this.tokenStart(this.peek());
    const scopeId = this.scopeStack[this.scopeStack.length - 1]!.frame.id;
    const entry = { kind, start, end: start, scopeId };
    this.statements.push(entry);
    parse();
    entry.end = this.statementEnd();
  }

  /** End of the most recently consumed token: never a following comment or line. */
  private statementEnd(): Position {
    return this.positionAt(this.lastConsumedEnd);
  }

  private expectSemicolon(context: string): void {
    if (!this.checkText(";")) {
      this.error(`Expected ';' after ${context}.`, this.peek());
      this.recoverToStatementEnd();
    } else {
      this.advance();
    }
  }

  private parseIfStatement(): void {
    this.advance();
    this.parseExpression();
    if (this.checkText("{")) {
      this.parseBlock();
    } else {
      this.error("Expected '{' after the if condition.", this.peek());
      this.recoverToStatementEnd();
      return;
    }
    while (this.checkText("else")) {
      this.advance();
      if (this.checkText("if")) {
        this.advance();
        this.parseExpression();
        if (this.checkText("{")) {
          this.parseBlock();
        } else {
          this.error("Expected '{' after the else-if condition.", this.peek());
          this.recoverToStatementEnd();
          return;
        }
      } else if (this.checkText("{")) {
        this.parseBlock();
        return;
      } else {
        this.error("Expected 'if' or '{' after 'else'.", this.peek());
        this.recoverToStatementEnd();
        return;
      }
    }
  }

  private parseSwitchStatement(): void {
    this.advance();
    this.parseExpression();
    if (!this.checkText("{")) {
      this.error("Expected '{' after the switch scrutinee.", this.peek());
      this.recoverToStatementEnd();
      return;
    }
    this.advance();
    while (!this.atEnd() && !this.checkText("}")) {
      const clause = this.peek();
      if (clause.text !== "case" && clause.text !== "default") {
        this.error(`Expected 'case' or 'default' but found '${clause.text}'.`, clause);
        this.recoverToStatementEnd();
        continue;
      }
      this.advance();
      if (clause.text === "case") {
        // `case_selectors`: expressions or `default`, with an optional trailing comma.
        this.parseCaseSelector();
        while (this.checkText(",")) {
          this.advance();
          if (this.checkText(":") || this.checkText("{")) {
            break;
          }
          this.parseCaseSelector();
        }
      }
      // The colon before a clause body is optional in WGSL.
      if (this.checkText(":")) {
        this.advance();
      } else if (!this.checkText("{")) {
        this.error("Expected ':' or '{' after the case selectors.", this.peek());
        this.recoverToStatementEnd();
        continue;
      }
      if (this.checkText("{")) {
        this.parseBlock();
      } else {
        // Lenient: accept bare statements up to the next clause.
        this.beginScope("block", "block", this.tokenStart(this.peek()));
        while (!this.atEnd() && !this.checkText("}") && this.peek().text !== "case" && this.peek().text !== "default") {
          this.parseStatement();
        }
        this.endScope(this.tokenStart(this.peek()));
      }
    }
    if (this.checkText("}")) {
      this.advance();
    } else {
      this.error("Unterminated switch statement.", this.peek());
    }
  }

  private parseCaseSelector(): void {
    if (this.checkText("default")) {
      this.advance();
      return;
    }
    this.parseExpression();
  }

  private parseLoopStatement(): void {
    this.advance();
    if (!this.checkText("{")) {
      this.error("Expected '{' after 'loop'.", this.peek());
      this.recoverToStatementEnd();
      return;
    }
    const open = this.advance();
    this.beginScope("block", "block", this.tokenStart(open));
    while (!this.atEnd() && !this.checkText("}") && this.peek().text !== "continuing") {
      this.parseStatement();
    }
    if (this.checkText("continuing")) {
      this.advance();
      if (this.checkText("{")) {
        this.parseBlock();
      } else if (this.checkText("break")) {
        this.advance();
        if (this.checkText("if")) {
          this.advance();
          this.parseExpression();
        }
        this.expectSemicolon("break if");
      } else {
        this.error("Expected '{' or 'break if' after 'continuing'.", this.peek());
        this.recoverToStatementEnd();
      }
    }
    if (this.checkText("}")) {
      const end = this.advance();
      this.endScope(this.tokenEnd(end));
    } else {
      this.error("Unterminated loop statement.", this.peek());
      this.endScope(this.positionAt(this.source.length));
    }
  }

  private parseForStatement(): void {
    this.advance();
    if (!this.checkText("(")) {
      this.error("Expected '(' after 'for'.", this.peek());
      this.recoverToStatementEnd();
      return;
    }
    const open = this.advance();
    this.beginScope("block", "block", this.tokenStart(open));
    // Initializer clause: empty, a declaration, or an assignment/call.
    if (this.checkText(";")) {
      this.advance();
    } else if (this.peek().text === "var" || this.peek().text === "let" || this.peek().text === "const") {
      const start = this.tokenStart(this.peek());
      const scopeId = this.scopeStack[this.scopeStack.length - 1]!.frame.id;
      this.parseVariableDeclaration();
      this.forInitializerDeclarations.push({ start, end: this.statementEnd(), scopeId });
    } else {
      this.parseAssignmentExpression();
      this.expectSemicolon("for initializer");
    }
    // Condition clause (may be empty).
    if (!this.checkText(";")) {
      this.parseExpression();
    }
    this.expectSemicolon("for condition");
    // Update clause (may be empty).
    if (!this.checkText(")")) {
      this.parseAssignmentExpression();
    }
    if (!this.checkText(")")) {
      this.error("Expected ')' after the for update clause.", this.peek());
    } else {
      this.advance();
    }
    if (this.checkText("{")) {
      this.parseBlock();
    } else {
      this.error("Expected '{' for the for body.", this.peek());
      this.recoverToStatementEnd();
    }
    this.endScope(this.tokenStart(this.peek()));
  }

  /** An assignment, phony assignment, call, or bare expression statement. */
  private parseExpressionOrAssignmentStatement(): void {
    const startToken = this.peek();
    const start = this.tokenStart(startToken);
    const scopeId = this.scopeStack[this.scopeStack.length - 1]!.frame.id;
    if (startToken.text === "_") {
      this.advance();
      if (!this.checkText("=")) {
        this.error("Expected '=' after '_'.", this.peek());
        this.recoverToStatementEnd();
        return;
      }
      this.advance();
      this.parseExpression();
      this.expectSemicolon("assignment");
      this.statements.push({ kind: "assignment", start, end: this.statementEnd(), scopeId });
      return;
    }
    const expression = this.parseAssignmentExpression();
    this.expectSemicolon("expression");
    const kind = expression?.kind === "call"
      ? "call"
      : expression?.kind === "binary" && ASSIGNMENT_OPERATORS.has(expression.operator)
        ? "assignment"
        : expression?.kind === "unary" && (expression.operator === "++" || expression.operator === "--")
          ? "assignment"
          : "expression";
    this.statements.push({ kind, start, end: this.statementEnd(), scopeId });
  }

  /**
   * An expression that may be an assignment. The left side can be an
   * identifier, a member or index access chain, or a pointer dereference.
   */
  private parseAssignmentExpression(): WgslExpression | undefined {
    const expression = this.parseExpression();
    const isAssignable = expression?.kind === "identifier"
      || expression?.kind === "member"
      || expression?.kind === "index"
      || (expression?.kind === "unary" && expression.operator === "*");
    if (isAssignable && ASSIGNMENT_OPERATORS.has(this.peek().text)) {
      const operator = this.advance().text;
      const rhs = this.parseExpression();
      if (!rhs) {
        this.error(`Expected a value after '${operator}'.`, this.peek());
        return expression;
      }
      return { kind: "binary", operator, left: expression, right: rhs };
    }
    // WGSL only permits postfix increment/decrement as complete statements or
    // as the update clause of a for loop. Keep them out of parsePostfix so an
    // expression such as `let value = i++` remains a syntax error.
    if (isAssignable && (this.checkText("++") || this.checkText("--"))) {
      return { kind: "unary", operator: this.advance().text, operand: expression };
    }
    return expression;
  }

  // -- expressions --------------------------------------------------------------

  /** Entry point for expression parsing. Public for parseWgslExpression. */
  parseExpression(): WgslExpression | undefined {
    return this.parseLogicalOr();
  }

  private parseBinaryLevel(
    parseOperand: () => WgslExpression | undefined,
    operators: ReadonlySet<string>,
  ): WgslExpression | undefined {
    let left = parseOperand();
    while (left && operators.has(this.peek().text)) {
      const operator = this.advance().text;
      const right = parseOperand();
      if (!right) {
        this.error(`Expected an operand after '${operator}'.`, this.peek());
        return left;
      }
      left = { kind: "binary", operator, left, right };
    }
    return left;
  }

  private parseLogicalOr(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseLogicalAnd(), new Set(["||"]));
  }

  private parseLogicalAnd(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseBitwiseOr(), new Set(["&&"]));
  }

  private parseBitwiseOr(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseBitwiseXor(), new Set(["|"]));
  }

  private parseBitwiseXor(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseBitwiseAnd(), new Set(["^"]));
  }

  private parseBitwiseAnd(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseEquality(), new Set(["&"]));
  }

  private parseEquality(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseRelational(), new Set(["==", "!="]));
  }

  private parseRelational(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseShift(), new Set(["<", ">", "<=", ">="]));
  }

  private parseShift(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseAdditive(), new Set(["<<", ">>"]));
  }

  private parseAdditive(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseMultiplicative(), new Set(["+", "-"]));
  }

  private parseMultiplicative(): WgslExpression | undefined {
    return this.parseBinaryLevel(() => this.parseUnary(), new Set(["*", "/", "%"]));
  }

  private parseUnary(): WgslExpression | undefined {
    const token = this.peek();
    if (token.text === "-" || token.text === "!" || token.text === "~" || token.text === "*" || token.text === "&") {
      this.advance();
      const operand = this.parseUnary();
      if (!operand) {
        this.error(`Expected an operand after '${token.text}'.`, this.peek());
        return undefined;
      }
      return { kind: "unary", operator: token.text, operand };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): WgslExpression | undefined {
    let expression = this.parsePrimary();
    while (expression) {
      if (this.checkText(".")) {
        this.advance();
        const member = this.peek();
        if (member.kind !== "identifier") {
          this.error("Expected a member name after '.'.", member);
          return expression;
        }
        this.advance();
        expression = { kind: "member", object: expression, member: member.text };
      } else if (this.checkText("[")) {
        this.advance();
        const index = this.parseExpression();
        if (!this.checkText("]")) {
          this.error("Expected ']' after the index expression.", this.peek());
          return expression;
        }
        this.advance();
        expression = { kind: "index", object: expression, index: index ?? { kind: "literal", text: "0" } };
      } else {
        return expression;
      }
    }
    return expression;
  }

  private parsePrimary(): WgslExpression | undefined {
    const token = this.peek();
    if (token.kind === "intLiteral" || token.kind === "floatLiteral") {
      this.advance();
      return { kind: "literal", text: token.text };
    }
    if (token.kind === "keyword" && (token.text === "true" || token.text === "false")) {
      this.advance();
      return { kind: "literal", text: token.text };
    }
    if (token.text === "(") {
      this.advance();
      const inner = this.parseExpression();
      if (!this.checkText(")")) {
        this.error("Expected ')' after the parenthesized expression.", this.peek());
        return inner;
      }
      this.advance();
      return inner;
    }
    if (token.kind !== "identifier") {
      this.error(`Unexpected '${token.text}' in expression position.`, token);
      return undefined;
    }
    this.advance();
    // A `<` after an identifier may open a template list (a type constructor
    // or bitcast); otherwise it is a relational operator for the caller.
    let name = token.text;
    let isCall = false;
    if (this.checkText("<")) {
      const savedIndex = this.index;
      const savedPending = [...this.pending];
      const savedEffects = this.snapshotSideEffects();
      const savedConsumedEnd = this.lastConsumedEnd;
      const typeEnd = this.parseTemplateArgs();
      if (typeEnd !== undefined && this.checkText("(")) {
        name = this.source.slice(token.offset, typeEnd);
        isCall = true;
      } else {
        this.lastConsumedEnd = savedConsumedEnd;
        this.index = savedIndex;
        this.pending.length = 0;
        this.pending.push(...savedPending);
        this.restoreSideEffects(savedEffects);
      }
    } else if (this.checkText("(")) {
      isCall = true;
    }
    if (isCall) {
      this.recordValueReference(token.text, token, true);
      this.advance();
      const args: WgslExpression[] = [];
      while (!this.atEnd() && !this.checkText(")")) {
        const argument = this.parseExpression();
        if (argument) {
          args.push(argument);
        } else {
          this.recoverToStatementEnd();
          break;
        }
        if (this.checkText(",")) {
          this.advance();
        } else {
          break;
        }
      }
      if (!this.checkText(")")) {
        this.error(`Expected ')' after the '${token.text}' arguments.`, this.peek());
      } else {
        this.advance();
      }
      return { kind: "call", name, args };
    }
    this.recordValueReference(token.text, token, false);
    return { kind: "identifier", name: token.text };
  }
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

export function parseWgslDocument(
  uri: string,
  source: string,
  stage: ShaderStage,
  context: WgslInferenceContext = {},
): WgslAnalysisDocument {
  return new WgslParser(source, context).parseDocument(uri, stage);
}

/** Parses a single expression for testing and tooling without a document. */
export function parseWgslExpression(source: string): WgslExpression | undefined {
  const parser = new WgslParser(source);
  const expression = parser.parseExpression();
  if (expression && !parser.isAtEnd()) {
    return undefined;
  }
  return expression;
}

function isValidPosition(source: string, position: Position): boolean {
  const lines = source.split("\n");
  const line = lines[position.line];
  return line !== undefined && position.character >= 0 && position.character <= line.length;
}

function rangeContains(range: Range, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) < 0;
}

function rangeContainsInclusiveEnd(range: Range, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) <= 0;
}

function comparePosition(left: Position, right: Position): number {
  return left.line - right.line || left.character - right.character;
}

function containsDocumentRange(outer: Range, inner: Range): boolean {
  return comparePosition(outer.start, inner.start) <= 0 && comparePosition(inner.end, outer.end) <= 0;
}

const COMPARISON_OPERATORS = new Set(["==", "!=", "<", ">", "<=", ">="]);

const ARITHMETIC_OPERATORS = new Set([
  "+", "-", "*", "/", "%", "|", "&", "^", "<<", ">>",
]);

const WGSL_SCALARS = new Set(["bool", "i32", "u32", "f32", "f16"]);

const SLANG_TO_WGSL_TYPE: Record<string, string> = {
  bool: "bool",
  float: "f32",
  float2: "vec2f",
  float3: "vec3f",
  float4: "vec4f",
  int: "i32",
  uint: "u32",
};

/** Maps a catalog slang type to its WGSL spelling, if it has a plain one. */
function wgslHostGlobalType(slangType: string): string | undefined {
  return SLANG_TO_WGSL_TYPE[slangType.trim()];
}

/** Unary builtins whose result has their operand's concrete type. */
const TYPE_PRESERVING_BUILTINS = new Set([
  "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh",
  "ceil", "cos", "cosh", "degrees", "dpdx", "dpdy", "exp", "exp2",
  "floor", "fract", "fwidth", "inverseSqrt", "log", "log2",
  "normalize", "quantizeToF16", "radians", "round", "saturate",
  "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc",
]);

/**
 * Multi-argument builtins whose result shares one argument type: either every
 * argument agrees, or a single vector type splats across scalar siblings.
 */
const VARIADIC_MATH_BUILTINS = new Set([
  "atan2", "clamp", "cross", "faceForward", "fma", "ldexp",
  "max", "min", "mix", "pow", "reflect", "refract", "remainder",
  "smoothstep", "step",
]);

/** `vec2<f32>` and `vec2f` spell one type, as do matrix aliases and their parameterized forms. */
function sameWgslType(left: string, right: string): boolean {
  return canonicalTypeKey(left) === canonicalTypeKey(right);
}

function canonicalTypeKey(typeName: string): string {
  const trimmed = typeName.trim();
  const vector = vectorType(trimmed);
  if (vector) {
    return `vec${vector.size}<${vector.componentType}>`;
  }
  const matrix = matrixType(trimmed);
  return matrix ? `mat${matrix.columns}x${matrix.rows}<${matrix.componentType}>` : trimmed;
}

/** A named type rather than a catalogue placeholder such as `T`, `vecN<bool>`, or `__modfResult`. */
function isConcreteTypeName(typeName: string): boolean {
  return isBuiltinValueType(typeName) || (/^[A-Za-z]\w+$/.test(typeName) && !/^[A-Z]$/.test(typeName));
}

function isWgslScalarType(typeName: string): boolean {
  return WGSL_SCALARS.has(typeName.trim());
}

function scalarLiteralType(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "false") {
    return "bool";
  }
  if (/^0[xX][0-9a-fA-F]+$/.test(trimmed) || /^\d+i$/.test(trimmed)) {
    return "i32";
  }
  if (/^\d+u$/.test(trimmed)) {
    return "u32";
  }
  if (/^\d+h$/.test(trimmed) || /^(\d+\.\d*|\.\d+|\d+[eE])[^a-zA-Z]*h$/.test(trimmed)) {
    return "f16";
  }
  if (/^(\d+\.\d*|\.\d+|\d+[eE][-+]?\d+|\d+f)$/.test(trimmed)) {
    return "f32";
  }
  if (/^\d+$/.test(trimmed)) {
    return "i32";
  }
  return undefined;
}

/**
 * Splits the initializer off a declaration statement's source: the first `=`
 * outside any bracket pair that is not part of `==`, `!=`, `<=`, or `>=`.
 * Returns undefined when there is no initializer or it cannot be isolated.
 */
function splitDeclarationInitializer(
  source: string,
  statement: { start: Position; end: Position },
): string | undefined {
  const text = sliceSourceLines(source, statement.start, statement.end).replace(/;\s*$/, "").trim();
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === "=" && depth === 0 && text[index + 1] !== "="
      && text[index - 1] !== "=" && text[index - 1] !== "!" && text[index - 1] !== "<" && text[index - 1] !== ">") {
      return text.slice(index + 1).trim() || undefined;
    }
  }
  return undefined;
}

function sliceSourceLines(source: string, start: Position, end: Position): string {
  const lines = source.split("\n");
  if (start.line === end.line) {
    return lines[start.line]?.slice(start.character, end.character) ?? "";
  }
  const parts: string[] = [lines[start.line]?.slice(start.character) ?? ""];
  for (let line = start.line + 1; line < end.line; line += 1) {
    parts.push(lines[line] ?? "");
  }
  parts.push(lines[end.line]?.slice(0, end.character) ?? "");
  return parts.join("\n");
}

export function symbolAtPosition(
  document: WgslAnalysisDocument,
  position: Position,
): WgslSymbol | null {
  if (!isValidPosition(document.source, position)) {
    return null;
  }
  for (const symbol of document.symbols) {
    if (rangeContains(symbol.declaration, position)) {
      return symbol;
    }
    if (symbol.references.some((reference) => rangeContains(reference, position))) {
      return symbol;
    }
  }
  return null;
}

export function visibleSymbolsAtPosition(
  document: WgslAnalysisDocument,
  position: Position,
): readonly WgslSymbol[] {
  if (!isValidPosition(document.source, position)) {
    return [];
  }
  const containingScopes = document.scopes
    .filter((scope) => rangeContainsInclusiveEnd(scope.range, position))
    .sort((left, right) => comparePosition(right.range.start, left.range.start));
  const innermost = containingScopes[0];
  if (!innermost) {
    return [];
  }
  const scopesById = new Map(document.scopes.map((scope) => [scope.id, scope]));
  const symbolsById = new Map(document.symbols.map((symbol) => [symbol.id, symbol]));
  const visible: WgslSymbol[] = [];
  const hiddenNames = new Set<string>();
  let scope: WgslScope | undefined = innermost;
  while (scope) {
    for (const symbolId of scope.symbolIds) {
      const symbol = symbolsById.get(symbolId);
      if (!symbol || comparePosition(symbol.declaration.start, position) > 0) {
        continue;
      }
      const hidesByName = symbol.kind !== "function";
      if (hidesByName && hiddenNames.has(symbol.name)) {
        continue;
      }
      visible.push(symbol);
      if (hidesByName) {
        hiddenNames.add(symbol.name);
      }
    }
    scope = scope.parentId ? scopesById.get(scope.parentId) : undefined;
  }
  return Object.freeze(visible);
}
