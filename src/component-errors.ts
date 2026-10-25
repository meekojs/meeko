import { logClientError, observeCallback } from "./error-observer.js";
import { createContext, findContext, onCleanup, provide } from "./reactivity.js";

/** Receives failures from component event handlers in the current root. */
export type ComponentErrorHandler = (error: unknown) => void;

const errorHandlerKey = createContext<ComponentErrorHandler>("component error handler");
const appErrorChannelKey = createContext<AppErrorChannel>("application error channel");

export interface AppErrorChannel {
  register(handler: ComponentErrorHandler): () => void;
  current(): ComponentErrorHandler | undefined;
  track(release: () => void): void;
  clear(): void;
}

/** A private observer registry owned by one mounted browser application. */
export function createAppErrorChannel(): AppErrorChannel {
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
    current() { return handlers[0]?.handler; },
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
}

export function currentAppErrorChannel(): AppErrorChannel | undefined {
  return findContext(appErrorChannelKey);
}

/** Provides an error observer to this component and its descendants. */
export function provideErrorHandler(handler: ComponentErrorHandler): void {
  provide(errorHandlerKey, handler);
  const channel = findContext(appErrorChannelKey);
  if (channel) {
    onCleanup(channel.register(handler));
  }
}

/** Captures the nearest observer while a component binding is created. */
export function componentErrorReporter(): (error: unknown) => void {
  const handler = currentComponentErrorHandler();
  if (!handler) return (error) => logClientError("Meeko component event failed", error);
  return (error) => observeCallback(
    () => handler(error),
    (observerError) => logClientError("Meeko component error observer failed", observerError, error),
  );
}

/** Returns the nearest handler for a resource created inside a component root. */
export function currentComponentErrorHandler(): ComponentErrorHandler | undefined {
  return findContext(errorHandlerKey);
}
