export function createRetryableLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | undefined;
  return () => {
    if (!current) {
      const attempt = load();
      current = attempt;
      void attempt.catch(() => {
        if (current === attempt) {
          current = undefined;
        }
      });
    }
    return current;
  };
}
