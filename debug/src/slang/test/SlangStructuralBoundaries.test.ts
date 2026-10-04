import { describe, expect, it } from "vitest";
import { matchGenericDelimiters } from "../SlangStructuralDelimiters";
import { createDeclaration, directDeclaration } from "../SlangStructuralNodes";
import { tokenizeSlang } from "../SlangTokenizer";

function document(source: string) {
  const doc = tokenizeSlang("file:///boundaries.slang", source);
  return { ...doc, tokens: doc.tokens.filter((token) => token.kind !== "whitespace" && token.kind !== "comment") };
}

describe("Slang structural boundaries", () => {
  it.each(["struct Box<T;", "Box<T field;", "Box<T field(", "Box<T field = 0;", "Box<T field"]) (
    "reports only confident malformed generic declarations: %s", (source) => {
      const doc = document(source);
      const result = matchGenericDelimiters(doc.tokens);
      expect(result.pairs).toHaveLength(0);
      const confident = source !== "Box<T field";
      expect(result.diagnostics).toHaveLength(confident ? 1 : 0);
      if (confident) {
        expect(result.diagnostics[0]).toMatchObject({ sourceUri: doc.sourceUri, message: "Unmatched generic '<' delimiter." });
      }
    },
  );

  it.each(["if (a < b > c) {}", "while (a < b > c) {}", "return a < b > c;", "x = a < b > c;", "a < b > c;"]) (
    "does not turn comparisons into generic type pairs: %s", (source) => {
      expect(matchGenericDelimiters(document(source).tokens).pairs).toEqual([]);
    },
  );

  it.each(["Box<T>", "Box<T> value;", "Outer<Inner<T>> value;", "Box<[T]> value;"]) (
    "retains complete generic type boundaries: %s", (source) => {
      const result = matchGenericDelimiters(document(source).tokens);
      expect(result.diagnostics).toEqual([]);
      expect(result.pairs.length).toBe(source.startsWith("Outer") ? 2 : 1);
    },
  );

  it("gives direct and transformed declarations explicit default modifiers and source origins", () => {
    const doc = document("float value;");
    const token = doc.tokens.find((item) => item.text === "value")!;
    const direct = directDeclaration(doc, token, "float", token.range, "scope", "readwrite");
    const transformed = createDeclaration(doc, token, "float", token.range, "scope", "readwrite", { kind: "direct", writableRange: token.range });
    expect(direct.modifiers).toEqual([]);
    expect(transformed.modifiers).toEqual([]);
    expect(direct.origin).toEqual({ kind: "direct", writableRange: token.range });
    expect(direct.sourceUri).toBe(doc.sourceUri);
    expect(transformed.id).toBe(direct.id);
  });
});
