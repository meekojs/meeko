import { logClientError, markingObserver, observeCallback } from "./error-observer.js";
import { createContext, findContext, onCleanup, provide, provideAsyncFailureReporter } from "./reactivity.js";

/**
 * Dónde se observó un fallo del navegador: un handler `on:` (`"event"`), un `effect`, una
 * limpieza, `onMounted` o la continuación de un setup con `await` (`"mounted"`, desde 1.1), la
 * navegación o un cliente Socket. Desde 1.3, en una aplicación montada, también una excepción no
 * capturada (`"uncaught"`, el evento `error` de `window`) o una promesa rechazada sin manejar
 * (`"rejection"`, el evento `unhandledrejection`) del código que no pasa por Meeko, como un
 * `setTimeout` o una librería. Puede ganar miembros en un minor: un `switch` exhaustivo
 * necesita rama por defecto.
 *
 * @example
 * ```ts
 * import type { ErrorSource } from "@meekojs/meeko";
 *
 * function label(source: ErrorSource): string {
 *   switch (source) {
 *     case "navigation": return "No se pudo abrir la página";
 *     case "socket": return "Conexión perdida";
 *     default: return "Algo falló";
 *   }
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#componentes-meeko
 */
export type ErrorSource = "event" | "effect" | "cleanup" | "mounted" | "navigation" | "socket" | "uncaught" | "rejection";

/**
 * Observador de fallos de la raíz actual y sus descendientes. `error` es `unknown`: refínelo antes
 * de leer sus propiedades.
 *
 * @example
 * ```ts
 * import type { ComponentErrorHandler } from "@meekojs/meeko";
 *
 * export const reportError: ComponentErrorHandler = (error, source) => {
 *   const message = error instanceof Error ? error.message : String(error);
 *   console.error(`[${source}] ${message}`);
 * };
 * ```
 */
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
export function createAppErrorChannel(observer?: ComponentErrorHandler): AppErrorChannel {
  // What reaches the application observer is not reported again if it escapes to `window`.
  const onError = observer && markingObserver(observer);
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

/**
 * Registra un observador de errores para este componente y sus descendientes: eventos, `effect`,
 * limpiezas, `onMounted` y, en una aplicación montada, navegación y canales Socket sin observador
 * propio. Un descendiente puede registrar otro para su rama. Se autoimporta en las aplicaciones.
 *
 * @param handler Observador que recibe el error y su origen.
 * @throws {Error} Sin una raíz de componente activa.
 * @example
 * ```html
 * <script lang="ts">
 * import { provideErrorHandler } from "@meekojs/meeko";
 * provideErrorHandler((error, source) => {
 *   console.error("Fallo en", source, error);
 * });
 * async function save(): Promise<void> {
 *   await fetch("/api/save", { method: "POST" });
 * }
 * </script>
 * <template><button on:click="save">Guardar</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#componentes-meeko
 */
export function provideErrorHandler(handler: ComponentErrorHandler): void {
  // What reaches this observer is not reported again if it escapes to `window`.
  const observer = markingObserver(handler);
  provide(errorHandlerKey, observer);
  provideAsyncFailureReporter(observer);
  const channel = findContext(appErrorChannelKey);
  if (channel) {
    onCleanup(channel.register(observer));
  }
}

/** Captures the nearest observer while a component binding or `onMounted` queue is created. */
export function componentErrorReporter(source: "event" | "mounted" = "event"): (error: unknown) => void {
  const nearest = currentComponentErrorHandler();
  // The application observer is resolved per failure because providers can
  // register after this binding was created.
  const channel = nearest ? undefined : currentAppErrorChannel();
  return (error) => {
    const handler = nearest ?? channel?.application();
    if (!handler) return logClientError(source === "event" ? "Meeko component event failed" : "Meeko onMounted callback failed", error);
    observeCallback(
      () => handler(error, source),
      (observerError) => logClientError("Meeko component error observer failed", observerError, error),
    );
  };
}

/** Returns the nearest handler for a resource created inside a component root. */
export function currentComponentErrorHandler(): ComponentErrorHandler | undefined {
  return findContext(errorHandlerKey);
}
