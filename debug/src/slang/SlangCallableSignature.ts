import type { SlangToken } from "./tokens";

/** Native stage functions may carry a return semantic between ')' and the body. */
export function callableTerminatorIndex(tokens: readonly SlangToken[], closeIndex: number): number {
  const next = closeIndex + 1;
  return tokens[next]?.text === ":" && tokens[next + 1]?.kind === "identifier" ? next + 2 : next;
}
