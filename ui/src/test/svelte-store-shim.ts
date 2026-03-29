export type Unsubscriber = () => void;
export type Subscriber<T> = (value: T) => void;
export type Updater<T> = (value: T) => T;

export interface Readable<T> {
  subscribe(run: Subscriber<T>): Unsubscriber;
}

export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(updater: Updater<T>): void;
}

export function writable<T>(value: T): Writable<T> {
  const subscribers = new Set<Subscriber<T>>();
  const set = (next: T) => {
    value = next;
    for (const subscriber of subscribers) {
      subscriber(value);
    }
  };

  return {
    subscribe(run: Subscriber<T>) {
      run(value);
      subscribers.add(run);
      return () => {
        subscribers.delete(run);
      };
    },
    set,
    update(updater: Updater<T>) {
      set(updater(value));
    },
  };
}

export function get<T>(store: Readable<T>): T {
  let value!: T;
  const unsubscribe = store.subscribe((current) => {
    value = current;
  });
  unsubscribe();
  return value;
}
