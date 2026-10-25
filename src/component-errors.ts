import { logClientError, observeCallback } from "./error-observer.js";
import { createContext, findContext, onCleanup, provide, provideAsyncFailureReporter } from "./reactivity.js";

/** Where a browser failure was observed. */
export type ErrorSource = "event" | "effect" | "cleanup" | "navigation" | "socket";

/** Receives failures from the current root and its descendants. */
export type ComponentErrorHandler = (error: unknown, source: ErrorSource) => void;

const errorHandlerKey = createContext<ComponentErrorHandler>("component error handler");
const appErrorChannelKey = createContext<AppErrorChannel>("application error channel");

export interface AppErrorChannel {
  register(handler: ComponentErrorHandler): () => void;
  /** For application-level sources: the application observer, or else the first component provider. */
  current(): ComponentErrorHandler | undefined;
  /** For component sources: only the application observer, never an unrelated component's provider. */
  application(): ComponentErrorHandler | undefined;
  track(release: () => void): void;
  clear(): void;
}

/** A private observer registry owned by one mounted browser application. */
export function createAppErrorChannel(onError?: ComponentErrorHandler): AppErrorChannel {
  const handlers: Array<{ handler: ComponentErrorHandler }> = [];
  const resources = new Set<() => void>();
  return {
    register(handler) {
      const entry = { handler };
      handlers.push(entry);
      return () => {
        const index = handlers.indexOf(entry);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    current() { return onError ?? handlers[0]?.handler; },
    application() { return onError; },
    track(release) { resources.add(release); },
    clear() {
      handlers.length = 0;
      const failures: unknown[] = [];
      for (const release of resources) {
        try { release(); }
        catch (error) { failures.push(error); }
      }
      resources.clear();
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Meeko application resources failed to close");
    },
  };
}

export function provideAppErrorChannel(channel: AppErrorChannel): void {
  provide(appErrorChannelKey, channel);
  provideAsyncFailureReporter((error, source) => {
    const handler = channel.application();
    if (handler) handler(error, source);
    else logClientError(`Meeko asynchronous ${source} rejected`, error);
  });
}

export function currentAppErrorChannel(): AppErrorChannel | undefined {
  return findContext(appErrorChannelKey);
}

/** Provides an error observer to this component and its descendants. */
export function provideErrorHandler(handler: ComponentErrorHandler): void {
  provide(errorHandlerKey, handler);
  provideAsyncFailureReporter(handler);
  const channel = findContext(appErrorChannelKey);
  if (channel) {
    onCleanup(channel.register(handler));
  }
}

/** Captures the nearest observer while a component binding is created. */
export function componentErrorReporter(): (error: unknown) => void {
  const nearest = currentComponentErrorHandler();
  // The application observer is resolved per failure because providers can
  // register after this binding was created.
  const channel = nearest ? undefined : currentAppErrorChannel();
  return (error) => {
    const handler = nearest ?? channel?.application();
    if (!handler) return logClientError("Meeko component event failed", error);
    observeCallback(
      () => handler(error, "event"),
      (observerError) => logClientError("Meeko component error observer failed", observerError, error),
    );
  };
}

/** Returns the nearest handler for a resource created inside a component root. */
export function currentComponentErrorHandler(): ComponentErrorHandler | undefined {
  return findContext(errorHandlerKey);
}
