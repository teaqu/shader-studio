let feedback = $state(new Map<string, string>());
export function getRenameFeedback(uri: string): string | undefined {
  return feedback.get(uri);
}
export function setRenameFeedback(uri: string, message: string | undefined): void {
  const next = new Map(feedback);
  if (message) {
    next.set(uri, message);
  } else {
    next.delete(uri);
  }
  feedback = next;
}
