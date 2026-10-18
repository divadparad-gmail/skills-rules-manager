/**
 * src/utils/debounce.ts
 *
 * Utilitaire de debounce pour regrouper les rafales d'événements
 * (ex: FileSystemWatcher onDidChange / onDidCreate / onDidDelete).
 */

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs = 350
): {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
  pending: () => boolean;
} {
  let timer: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = (...args: Parameters<T>) => {
    lastArgs = args;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) {
        fn(...lastArgs);
        lastArgs = null;
      }
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  debounced.pending = () => timer !== null;

  return debounced;
}
