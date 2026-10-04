import type { Range } from "vscode-languageserver-protocol";
import type {
  GlslScope
} from "./model.js";

export interface ParserLocationInfo {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface ParserLocation {
  readonly start: ParserLocationInfo;
  readonly end: ParserLocationInfo;
}

export interface ParserNode {
  readonly type?: string;
  readonly location?: ParserLocation;
  readonly [key: string]: unknown;
}

export interface ParserScopeEntry {
  readonly declaration?: ParserNode;
  readonly references: readonly ParserNode[];
}

export interface ParserFunctionDefinition {
  readonly returnType: string;
  readonly parameterTypes: readonly string[];
  readonly declaration?: ParserNode;
  readonly references: readonly ParserNode[];
}

export interface ParserScope {
  readonly name: string;
  readonly parent?: ParserScope;
  readonly bindings: Readonly<Record<string, ParserScopeEntry>>;
  readonly types: Readonly<Record<string, ParserScopeEntry>>;
  readonly functions: Readonly<Record<string, Readonly<Record<string, ParserFunctionDefinition>>>>;
  readonly location?: ParserLocation;
}

export interface ParserProgram {
  readonly program?: readonly ParserNode[];
  readonly scopes?: readonly ParserScope[];
}

export interface ParserFailure extends Error {
  readonly location?: ParserLocation;
}

export interface DeclarationMetadata {
  readonly typeName?: string;
  readonly resolvedTypeName?: string;
}

export type ArrayExtent = number | undefined;

export interface ResolvedArrayType {
  readonly elementType: string;
  readonly dimensions: readonly ArrayExtent[];
}

export interface FieldMetadata {
  readonly name: string;
  readonly typeName?: string;
  readonly resolvedTypeName?: string;
  readonly location: ParserLocation;
  readonly ownerName: string;
  readonly ownerLocation: ParserLocation;
}

export interface FieldReferenceMetadata {
  readonly fieldName: string;
  readonly selection: ParserNode;
  readonly root: ParserNode;
  readonly precedingOperations: readonly ParserNode[];
}

export interface FunctionCallMetadata {
  readonly name: string;
  readonly identifier: ParserNode;
  readonly arguments: readonly ParserNode[];
}

export interface MutableScope {
  id: string;
  name: string;
  kind: GlslScope["kind"];
  parentId?: string;
  range: Range;
  symbolIds: string[];
}

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function identifierNode(node: ParserNode | undefined, expectedName?: string): ParserNode | undefined {
  if (!node) {
    return undefined;
  }
  const ownName = identifierValue(node);
  if (ownName && (!expectedName || ownName === expectedName) && node.location) {
    return node;
  }

  for (const key of ["identifier", "prototype", "header", "name", "specifier"]) {
    const child = asNode(node[key]);
    const found = identifierNode(child, expectedName);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function identifierValue(node: ParserNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (typeof node.identifier === "string") {
    return node.identifier;
  }
  return undefined;
}

export function literalValue(node: ParserNode | undefined): string | undefined {
  return node && typeof node.literal === "string" ? node.literal : undefined;
}

export function findStructNode(value: unknown): ParserNode | undefined {
  if (!isNode(value)) {
    return undefined;
  }
  if (value.type === "struct") {
    return value;
  }
  return findStructNode(value.specifier);
}

export function anonymousStructIdentity(node: ParserNode): string | undefined {
  return node.location
    ? `@anonymous-struct:${node.location.start.offset}:${node.location.end.offset}`
    : undefined;
}

export function publicScopeName(name: string): string {
  return name.startsWith("@anonymous-struct:") ? "anonymous struct" : name;
}

export function nodeArray(value: unknown): readonly ParserNode[] {
  return Array.isArray(value) ? value.filter(isNode) : [];
}

export function asNode(value: unknown): ParserNode | undefined {
  return isNode(value) ? value : undefined;
}

export function isNode(value: unknown): value is ParserNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripComments(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index + 2);
      if (newline === -1) {
        break;
      }
      output += "\n";
      index = newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) {
        output += source.slice(index);
        break;
      }
      index = end + 2;
      continue;
    }
    output += source[index];
    index++;
  }
  return output;
}
