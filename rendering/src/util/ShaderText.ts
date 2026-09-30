/** Linear-time helpers for shader/compiler text that may be user controlled. */

export function stripLineComment(line: string): string {
  const comment = line.indexOf("//");
  return comment === -1 ? line : line.slice(0, comment);
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
      const stop = end + 2;
      for (; index < stop; index++) {
        if (source[index] === "\n") {
          output += "\n";
        }
      }
      continue;
    }
    output += source[index];
    index++;
  }
  return output;
}
