import type { ComponentErrorHandler } from "../component-errors.js";
import { logClientError, markObserved, observeCallback, wasObserved } from "../error-observer.js";

/** The parts of `ErrorEvent` that a browser (or a test window) fills in. */
interface UncaughtEvent extends Event {
  readonly error?: unknown;
  readonly message?: string;
  readonly filename?: string;
}

/** The parts of `PromiseRejectionEvent` that a browser (or a test window) fills in. */
interface RejectionEvent extends Event {
  readonly reason?: unknown;
}

/**
 * The "Script error." that a browser reports for an exception of a script from another origin
 * loaded without CORS: no error object, file or message to report. It is left to the console.
 */
function opaqueScriptError(event: UncaughtEvent): boolean {
  return (event.error === undefined || event.error === null) && !event.filename && /^Script error\.?$/.test(event.message ?? "");
}

/**
 * Sends the uncaught exceptions (`error` on `window`) and unhandled rejections
 * (`unhandledrejection`) of the page to the application observer, which `observer()` resolves on
 * each failure (the application's `onError`, or else the first component provider). Without an
 * observer, or for an event that another listener already handled with `preventDefault()`,
 * nothing changes: the browser keeps its console report. A delivered failure calls
 * `preventDefault()`, so the browser does not log it a second time. A failure that already
 * reached a Meeko observer (one that Meeko reported and that later escaped to `window`) is not
 * delivered again. Returns the function that removes both listeners.
 */
export function watchGlobalErrors(browser: Window, observer: () => ComponentErrorHandler | undefined): () => void {
  const deliver = (event: Event, error: unknown, source: "uncaught" | "rejection"): void => {
    if (event.defaultPrevented) return;
    if (wasObserved(error)) {
      event.preventDefault();
      return;
    }
    const handler = observer();
    if (!handler) return;
    event.preventDefault();
    // Another application on the page sees it as already observed.
    markObserved(error);
    observeCallback(() => handler(error, source),
      (observerError) => logClientError("Meeko application error observer failed", observerError, error));
  };
  const onError = (event: Event): void => {
    const uncaught = event as UncaughtEvent;
    // Resource load errors do not bubble to `window`; only script exceptions arrive here.
    if (opaqueScriptError(uncaught)) return;
    const error = uncaught.error === undefined || uncaught.error === null
      ? new Error(uncaught.message || "Uncaught error")
      : uncaught.error;
    deliver(event, error, "uncaught");
  };
  const onRejection = (event: Event): void => {
    deliver(event, (event as RejectionEvent).reason, "rejection");
  };
  browser.addEventListener("error", onError);
  browser.addEventListener("unhandledrejection", onRejection);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    browser.removeEventListener("error", onError);
    browser.removeEventListener("unhandledrejection", onRejection);
  };
}
