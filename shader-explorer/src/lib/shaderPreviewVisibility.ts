interface IntersectionObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

interface IntersectionObserverEntryLike {
  isIntersecting: boolean;
}

type IntersectionObserverFactory = (
  callback: (entries: IntersectionObserverEntryLike[]) => void,
  options: IntersectionObserverInit,
) => IntersectionObserverLike;

interface ObserveNearViewportOptions {
  rootMargin?: string;
  threshold?: number;
  observerFactory?: IntersectionObserverFactory;
}

export function observeNearViewport(
  target: Element,
  onVisible: () => void,
  {
    rootMargin = '600px 0px',
    threshold = 0,
    observerFactory,
  }: ObserveNearViewportOptions = {},
): () => void {
  const createObserver = observerFactory ?? (
    typeof IntersectionObserver !== 'undefined'
      ? (callback, options) => new IntersectionObserver(callback, options)
      : null
  );

  if (!createObserver) {
    onVisible();
    return () => {};
  }

  let hasRun = false;
  const runOnce = () => {
    if (hasRun) {
      return;
    }

    hasRun = true;
    observer.disconnect();
    onVisible();
  };

  const observer = createObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) {
      runOnce();
    }
  }, {
    root: null,
    rootMargin,
    threshold,
  });

  observer.observe(target);

  return () => {
    observer.disconnect();
  };
}
