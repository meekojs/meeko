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

/** Last-resort client reporting when no application observer is available. */
export function logClientError(label: string, ...details: unknown[]): void {
  try { console.error(label, ...details); }
  catch { /* A broken console cannot escape an event callback. */ }
}
