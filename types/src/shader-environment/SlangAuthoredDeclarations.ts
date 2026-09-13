export interface SlangAuthoredDeclaration { readonly name: string; readonly offset: number; }
type SlangLexeme = { value: string; lineStart: boolean; offset: number };

function tokenizeSlangDeclarations(source: string): SlangLexeme[] {
  const tokens: SlangLexeme[] = [];
  let index = 0;
  let lineStart = true;
  while (index < source.length) {
    const character = source[index]!;
    const next = source[index + 1];
    if (/\s/.test(character)) {
      if (character === "\n" || character === "\r") {
        lineStart = true;
      }
      index++;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index++;
      }
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const comment = source.slice(index, end < 0 ? source.length : end + 2);
      if (/[\r\n]/.test(comment)) {
        lineStart = true;
      }
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      index++;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          index++;
        }
        index++;
      }
      index++;
      lineStart = false;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index++;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index]!)) {
        index++;
      }
      tokens.push({ value: source.slice(start, index), lineStart, offset: start });
    } else {
      tokens.push({ value: character, lineStart, offset: index });
      index++;
    }
    lineStart = false;
  }
  return tokens;
}

function isIdentifier(token: SlangLexeme | undefined): token is SlangLexeme {
  return Boolean(token && /^[A-Za-z_]\w*$/.test(token.value));
}

export function findSlangAuthoredDeclarations(source: string): SlangAuthoredDeclaration[] {
  const declarations = new Set<SlangLexeme>();
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "))
    .replace(/\/\/.*$/gm, "");
  for (const match of withoutComments.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)/gm)) {
    declarations.add({ value: match[1]!, offset: match.index! + match[0].lastIndexOf(match[1]!), lineStart: true });
  }
  const statement: SlangLexeme[] = [];
  let depth = 0;
  let parenDepth = 0;
  for (const token of tokenizeSlangDeclarations(source)) {
    if (depth === 0 && token.value === "#" && token.lineStart) {
      statement.length = 0;
      statement.push(token);
      continue;
    }
    if (depth === 0) {
      statement.push(token);
    }
    if (token.value === "(") {
      parenDepth++;
    }
    if (token.value === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
    if (token.value === "{") {
      if (depth === 0) {
        addSlangDeclarationStatement(statement, declarations);
      }
      depth++;
      statement.length = 0;
    } else if (token.value === "}") {
      depth = Math.max(0, depth - 1);
      statement.length = 0;
    } else if (token.value === ";" && depth === 0 && parenDepth === 0) {
      addSlangDeclarationStatement(statement, declarations);
      statement.length = 0;
    }
  }
  return [...new Map([...declarations].map(token => [token.offset, { name: token.value, offset: token.offset }])).values()];
}

function addSlangDeclarationStatement(statement: readonly SlangLexeme[], declarations: Set<SlangLexeme>): void {
  const tokens = statement.filter(({ value }) => value !== "{");
  while (tokens[0]?.value === "[") {
    let brackets = 0;
    let end = 0;
    do {
      if (tokens[end]?.value === "[") {
        brackets++;
      }
      if (tokens[end]?.value === "]") {
        brackets--;
      }
      end++;
    } while (end < tokens.length && brackets > 0);
    tokens.splice(0, end);
  }
  if (tokens.length === 0) {
    return;
  }
  if (tokens[0]?.value === "#" && tokens[1]?.value === "define" && isIdentifier(tokens[2])) {
    declarations.add(tokens[2]);
    return;
  }
  const first = tokens.findIndex(({ value }) => !["public", "private", "internal", "static", "extern", "const", "uniform"].includes(value));
  const head = tokens[first];
  if (!head || ["import", "module", "namespace", "using"].includes(head.value)) {
    return;
  }
  if (["struct", "class", "interface", "enum"].includes(head.value) && isIdentifier(tokens[first + 1])) {
    declarations.add(tokens[first + 1]);
    return;
  }
  if (head.value === "typedef") {
    const name = [...tokens].reverse().find(isIdentifier);
    if (name) {
      declarations.add(name);
    }
    return;
  }
  if (head.value === "typealias" && isIdentifier(tokens[first + 1])) {
    declarations.add(tokens[first + 1]);
    return;
  }
  if (head.value === "property") {
    const name = [...tokens].reverse().find(isIdentifier);
    if (name) {
      declarations.add(name);
    }
    return;
  }
  // The first declarator precedes its initializer; a constructor call in the
  // initializer is not a function declaration.
  const boundary = tokens.findIndex(({ value }, index) => index > first && ["=", ";", "[", ",", "("].includes(value));
  const name = tokens[boundary - 1];
  if (boundary <= first + 1 || !isIdentifier(name)) {
    return;
  }
  declarations.add(name);
  if (tokens[boundary]?.value === "(") {
    return;
  }
  let nesting = 0;
  for (let index = boundary; index < tokens.length - 1; index++) {
    const value = tokens[index]!.value;
    if (["(", "[", "{"].includes(value)) {
      nesting++;
    }
    if ([")", "]", "}"].includes(value)) {
      nesting--;
    }
    if (value === "," && nesting === 0 && isIdentifier(tokens[index + 1])) {
      declarations.add(tokens[index + 1]!);
    }
  }
}
