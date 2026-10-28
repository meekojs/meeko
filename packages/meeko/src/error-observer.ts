/** Attaches a rejection observer immediately, including to foreign thenables. */
export function observeReturnedPromise(result: unknown, report: (error: unknown) => void): boolean {
  const safeReport = (error: unknown) => {
    try { report(error); }
    catch { /* Reporting cannot escape an event callback or create another rejection. */ }
  };
  try {
    if (result && (typeof result === "object" || typeof result === "function")
      && "then" in result && typeof result.then === "function") {
      void Promise.resolve(result).catch(safeReport);
      return true;
    }
  } catch (error) { safeReport(error); return true; }
  return false;
}

/** Observes synchronous callbacks and returned promises at browser event boundaries. */
export function observeCallback(call: () => unknown, report: (error: unknown) => void): void {
  try { observeReturnedPromise(call(), report); }
  catch (error) {
    try { report(error); }
    catch { /* Reporting cannot escape an event callback. */ }
  }
}

/**
 * Failures that already reached a Meeko observer. If the same error later escapes to the browser
 * as an uncaught exception or an unhandled rejection, the global listeners recognize it and do not
 * report it twice. Only objects can be remembered; a thrown primitive is never deduplicated.
 */
const observedFailures = new WeakSet<object>();

/** Marks `error` as delivered to a Meeko observer. */
export function markObserved(error: unknown): void {
  if ((typeof error === "object" && error !== null) || typeof error === "function") observedFailures.add(error);
}

/** Wraps an observer so every failure it receives is marked as observed first. */
export function markingObserver<A extends unknown[]>(observer: (error: unknown, ...rest: A) => void): (error: unknown, ...rest: A) => void {
  return (error, ...rest) => {
    markObserved(error);
    return observer(error, ...rest);
  };
}

/** Whether `error` already reached a Meeko observer. */
export function wasObserved(error: unknown): boolean {
  return ((typeof error === "object" && error !== null) || typeof error === "function") && observedFailures.has(error);
}

/** Last-resort client reporting when no application observer is available. */
export function logClientError(label: string, ...details: unknown[]): void {
  try { console.error(label, ...details); }
  catch { /* A broken console cannot escape an event callback. */ }
}
