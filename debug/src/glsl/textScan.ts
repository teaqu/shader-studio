/** Linear-time string helpers for shader text supplied by users. */

export function stripLineComment(line: string): string {
  const comment = line.indexOf("//");
  return comment === -1 ? line : line.slice(0, comment);
}

export function parenthesizedContents(text: string): string | null {
  const open = text.indexOf("(");
  if (open === -1) {
    return null;
  }
  let depth = 1;
  for (let index = open + 1; index < text.length; index++) {
    if (text[index] === "(") {
      depth++;
    } else if (text[index] === ")" && --depth === 0) {
      return text.slice(open + 1, index);
    }
  }
  return null;
}
