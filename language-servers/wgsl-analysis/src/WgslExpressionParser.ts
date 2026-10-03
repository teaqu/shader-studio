import type { WgslToken } from "./tokenizer.js";
import { splitTemplateArgumentText } from "./WgslDocumentSupport.js";
import type { WgslExpression } from "./WgslExpression.js";

const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);

export interface WgslExpressionParserContext {
  readonly source: string;
  peek(): WgslToken;
  advance(): WgslToken;
  atEnd(): boolean;
  checkText(text: string): boolean;
  error(message: string, token: WgslToken): void;
  recoverToStatementEnd(): void;
  parseTemplateArgs(): number | undefined;
  recordValueReference(name: string, token: WgslToken, isCall: boolean): void;
  snapshotSideEffects(): unknown;
  restoreSideEffects(snapshot: unknown): void;
  snapshotCursor(): unknown;
  restoreCursor(snapshot: unknown): void;
}

/** Parses expressions while leaving document cursor and reference ownership with its caller. */
export class WgslExpressionParser {
  constructor(private readonly context: WgslExpressionParserContext) {}

  parseAssignmentExpression(): WgslExpression | undefined {
    const expression = this.parseExpression();
    const isAssignable = expression?.kind === "identifier"
      || expression?.kind === "member"
      || expression?.kind === "index"
      || (expression?.kind === "unary" && expression.operator === "*");
    if (isAssignable && ASSIGNMENT_OPERATORS.has(this.context.peek().text)) {
      const operator = this.context.advance().text;
      const rhs = this.parseExpression();
      if (!rhs) {
        this.context.error(`Expected a value after '${operator}'.`, this.context.peek());
        return expression;
      }
      return { kind: "binary", operator, left: expression, right: rhs };
    }
    if (isAssignable && (this.context.checkText("++") || this.context.checkText("--"))) {
      return { kind: "unary", operator: this.context.advance().text, operand: expression };
    }
    return expression;
  }

  parseExpression(): WgslExpression | undefined {
    return this.parseLogicalOr();
  }

  private parseBinaryLevel(parseOperand: () => WgslExpression | undefined, operators: ReadonlySet<string>): WgslExpression | undefined {
    let left = parseOperand();
    while (left && operators.has(this.context.peek().text)) {
      const operator = this.context.advance().text;
      const right = parseOperand();
      if (!right) {
        this.context.error(`Expected an operand after '${operator}'.`, this.context.peek());
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
    const token = this.context.peek();
    if (["-", "!", "~", "*", "&"].includes(token.text)) {
      this.context.advance();
      const operand = this.parseUnary();
      if (!operand) {
        this.context.error(`Expected an operand after '${token.text}'.`, this.context.peek());
        return undefined;
      }
      return { kind: "unary", operator: token.text, operand };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): WgslExpression | undefined {
    let expression = this.parsePrimary();
    while (expression) {
      if (this.context.checkText(".")) {
        this.context.advance();
        const member = this.context.peek();
        if (member.kind !== "identifier") {
          this.context.error("Expected a member name after '.'.", member);
          return expression;
        }
        this.context.advance();
        expression = { kind: "member", object: expression, member: member.text };
      } else if (this.context.checkText("[")) {
        this.context.advance();
        const index = this.parseExpression();
        if (!this.context.checkText("]")) {
          this.context.error("Expected ']' after the index expression.", this.context.peek());
          return expression;
        }
        this.context.advance();
        expression = { kind: "index", object: expression, index: index ?? { kind: "literal", text: "0" } };
      } else {
        return expression;
      }
    }
    return expression;
  }

  private parsePrimary(): WgslExpression | undefined {
    const token = this.context.peek();
    if (token.kind === "intLiteral" || token.kind === "floatLiteral" || (token.kind === "keyword" && (token.text === "true" || token.text === "false"))) {
      this.context.advance();
      return { kind: "literal", text: token.text };
    }
    if (token.text === "(") {
      this.context.advance();
      const inner = this.parseExpression();
      if (!this.context.checkText(")")) {
        this.context.error("Expected ')' after the parenthesized expression.", this.context.peek());
        return inner;
      }
      this.context.advance();
      return inner;
    }
    if (token.kind !== "identifier") {
      this.context.error(`Unexpected '${token.text}' in expression position.`, token);
      return undefined;
    }
    this.context.advance();
    let name = token.text;
    let isCall = false;
    if (this.context.checkText("<")) {
      const cursor = this.context.snapshotCursor();
      const effects = this.context.snapshotSideEffects();
      const typeEnd = this.context.parseTemplateArgs();
      if (typeEnd !== undefined && this.context.checkText("(")) {
        name = this.context.source.slice(token.offset, typeEnd);
        isCall = true;
      } else {
        this.context.restoreCursor(cursor);
        this.context.restoreSideEffects(effects);
      }
    } else if (this.context.checkText("(")) {
      isCall = true;
    }
    if (!isCall) {
      this.context.recordValueReference(token.text, token, false);
      return { kind: "identifier", name: token.text };
    }
    this.context.recordValueReference(token.text, token, true);
    this.context.advance();
    const args: WgslExpression[] = [];
    while (!this.context.atEnd() && !this.context.checkText(")")) {
      const argument = this.parseExpression();
      if (!argument) {
        this.context.recoverToStatementEnd();
        break;
      }
      args.push(argument);
      if (this.context.checkText(",")) {
        this.context.advance();
      } else {
        break;
      }
    }
    if (!this.context.checkText(")")) {
      this.context.error(`Expected ')' after the '${token.text}' arguments.`, this.context.peek());
    } else {
      this.context.advance();
    }
    return { kind: "call", name, callee: token.text, templateArguments: name === token.text ? undefined : splitTemplateArgumentText(name), args };
  }
}
