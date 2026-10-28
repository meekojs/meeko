import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerApp } from "./app.js";
import { observeServerError } from "./contracts.js";
import type { ServerErrorInfo, ServerErrorObserver } from "./contracts.js";

/**
 * Qué hace Meeko con los fallos que ocurren fuera del flujo de una petición: una promesa rechazada
 * que nadie maneja y una excepción que nadie captura (en un `setTimeout`, un callback de una
 * librería o un trabajo sin `await`). Se declara en `processErrors` de `server/runtime.ts`; sin
 * declararla se aplican los valores por defecto. `false` desactiva los dos casos.
 *
 * - `unhandledRejection`: `"report"` (por defecto) lo envía a `onError` y el servidor sigue
 *   atendiendo; `"shutdown"` lo envía y además cierra de forma ordenada con código 1; `"off"` deja
 *   el evento al runtime (en Node, el rechazo pasa a ser una excepción no capturada).
 * - `uncaughtException`: `"shutdown"` (por defecto) lo envía a `onError`, deja de aceptar
 *   conexiones, espera las respuestas abiertas y las tareas de `waitUntil`, cierra la aplicación y
 *   sale con código 1, porque el estado del proceso ya no es fiable; `"off"` deja el evento al
 *   runtime.
 *
 * Cloudflare Workers no tiene proceso que cerrar: allí sólo se informa de los rechazos.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * // server/runtime.ts
 * import { defineServerRuntime } from "@meekojs/meeko/server";
 * import type { ProcessErrorPolicy } from "@meekojs/meeko/server";
 *
 * const processErrors: ProcessErrorPolicy = { unhandledRejection: "shutdown" };
 * export default defineServerRuntime(() => ({ processErrors }));
 * ```
 */
export interface ProcessErrorPolicy {
  /** Una promesa rechazada sin manejar: `"report"` (por defecto), `"shutdown"` u `"off"`. */
  readonly unhandledRejection?: "report" | "shutdown" | "off";
  /** Una excepción no capturada: `"shutdown"` (por defecto) u `"off"`. */
  readonly uncaughtException?: "shutdown" | "off";
}

/**
 * Opciones de {@link handleProcessErrors}.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import type { ProcessErrorOptions } from "@meekojs/meeko/server";
 *
 * const options: ProcessErrorOptions = {
 *   close: async () => { await server.stop(); await app.close(); },
 *   shutdownTimeout: 20_000,
 * };
 * ```
 */
export interface ProcessErrorOptions {
  /**
   * Cierre ordenado del host ante un fallo que lo exige: dejar de aceptar conexiones, esperar las
   * respuestas abiertas y cerrar la aplicación. Por defecto, sólo `app.close()`. Después, Meeko
   * sale con código 1.
   */
  readonly close?: () => Promise<void>;
  /**
   * Observador de los fallos. Por defecto, el `onError` de `server/runtime.ts`; sin él, Meeko
   * escribe en la consola el error completo, como haría el runtime.
   */
  readonly onError?: ServerErrorObserver;
  /** Milisegundos que puede durar `close` antes de salir igualmente con código 1. Por defecto, 15 000. */
  readonly shutdownTimeout?: number;
}

/** The request whose asynchronous work is running, with the ID its context takes. */
interface RequestScope {
  readonly requestId: string;
  taken: boolean;
}

interface SharedState {
  readonly requestScope: AsyncLocalStorage<RequestScope>;
  readonly applications: WeakMap<object, AppProcessErrors>;
}

/**
 * One scope and one registry per process, also with two copies of Meeko loaded (the `meeko dev`
 * host and the application it loads through Vite may resolve the package separately).
 */
const shared: SharedState = ((globalThis as { [key: symbol]: SharedState | undefined })[Symbol.for("meeko.process-errors")] ??= {
  requestScope: new AsyncLocalStorage<RequestScope>(),
  applications: new WeakMap<object, AppProcessErrors>(),
});
const requestScope = shared.requestScope;

/** Runs a request of a `ServerApp` in its own scope, so process failures can name it. */
export function withRequestScope<T>(run: () => T): T {
  return requestScope.run({ requestId: crypto.randomUUID(), taken: false }, run);
}

/**
 * The ID of the first request context created in the current request scope, so a process failure
 * of that request carries the ID of its response; `undefined` outside a scope or once taken.
 */
export function takeScopedRequestId(): string | undefined {
  const scope = requestScope.getStore();
  if (!scope || scope.taken) return undefined;
  scope.taken = true;
  return scope.requestId;
}

interface AppProcessErrors {
  readonly policy: ProcessErrorPolicy | false | undefined;
  /** The application's own observer (`onError` of `server/runtime.ts`), if any. */
  readonly observer: ServerErrorObserver | undefined;
}

const applications = shared.applications;

const rejectionActions: readonly string[] = ["report", "shutdown", "off"];
const exceptionActions: readonly string[] = ["shutdown", "off"];

/** Checks `processErrors` of `server/runtime.ts`; an unknown value fails at startup. */
function checkedPolicy(policy: unknown): ProcessErrorPolicy | false | undefined {
  if (policy === undefined || policy === false) return policy;
  if (!policy || typeof policy !== "object") throw new TypeError("server/runtime.ts: processErrors must be false or { unhandledRejection?, uncaughtException? }");
  const { unhandledRejection, uncaughtException } = policy as Record<string, unknown>;
  if (unhandledRejection !== undefined && !rejectionActions.includes(unhandledRejection as string)) {
    throw new TypeError(`server/runtime.ts: processErrors.unhandledRejection must be "report", "shutdown" or "off"`);
  }
  if (uncaughtException !== undefined && !exceptionActions.includes(uncaughtException as string)) {
    throw new TypeError(`server/runtime.ts: processErrors.uncaughtException must be "shutdown" or "off"`);
  }
  return policy as ProcessErrorPolicy;
}

/** Records the policy and the observer of an application created by `createServerApp`. */
export function registerProcessErrors(app: object, policy: unknown, observer: ServerErrorObserver | undefined): void {
  applications.set(app, { policy: checkedPolicy(policy), observer });
}

/** What the runtime prints for these failures: the full error. */
const consoleObserver: ServerErrorObserver = (error, requestId, info) => {
  try {
    console.error(`[meeko] ${info?.kind ?? "error"} ${requestId}${info?.inRequest ? " (during a request)" : ""}`);
    console.error(error);
  } catch { /* A broken console cannot escape a process listener. */ }
};

/** The observer of an application's process failures: its own `onError`, or else the console. */
export function processErrorObserver(app: object | undefined): ServerErrorObserver {
  return (app && applications.get(app)?.observer) || consoleObserver;
}

type ProcessHost = "node" | "deno" | "worker";

interface NodeProcess {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
  listeners(event: string): unknown[];
  exit(code?: number): never;
  exitCode?: number | string | undefined;
}

interface DenoProcess { exit(code?: number): never; exitCode?: number }

interface GlobalEvents {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

function nodeProcess(): NodeProcess | undefined {
  const candidate = (globalThis as unknown as { process?: Partial<NodeProcess> }).process;
  return candidate && typeof candidate.on === "function" && typeof candidate.removeListener === "function"
    && typeof candidate.listeners === "function" && typeof candidate.exit === "function" ? candidate as NodeProcess : undefined;
}

function denoProcess(): DenoProcess | undefined {
  const candidate = (globalThis as unknown as { Deno?: Partial<DenoProcess> }).Deno;
  return candidate && typeof candidate.exit === "function" ? candidate as DenoProcess : undefined;
}

/** Deno through its global events, Node and Bun through `process`, anything else as a Worker isolate. */
function detectHost(): ProcessHost {
  if (denoProcess()) return "deno";
  const workers = (globalThis as { navigator?: { userAgent?: unknown } }).navigator?.userAgent === "Cloudflare-Workers";
  if (!workers && nodeProcess()) return "node";
  return "worker";
}

/** Marks Meeko's own process listeners: two Meeko servers in one process do not count as the app's. */
const ownListener: unique symbol = Symbol.for("meeko.process-error-listener") as never;

interface InstallSettings {
  readonly host: ProcessHost;
  readonly policy: ProcessErrorPolicy | false | undefined;
  readonly report: (error: unknown, requestId: string, info: ServerErrorInfo) => void;
  readonly close: () => Promise<void>;
  readonly shutdownTimeout: number;
}

/** Listens for the process failures of `settings.host` and applies the policy; returns the release. */
function installProcessErrorHandlers(settings: InstallSettings): () => void {
  const policy = settings.policy;
  if (policy === false) return () => {};
  const rejection = policy?.unhandledRejection ?? "report";
  const exception = policy?.uncaughtException ?? "shutdown";
  const node = settings.host === "node" ? nodeProcess() : undefined;
  const deno = settings.host === "deno" ? denoProcess() : undefined;
  let shuttingDown = false;
  const exit = (code: number): void => {
    if (node) node.exit(code);
    else deno?.exit(code);
  };
  const shutdown = (): void => {
    // A Worker isolate has no process to stop; a second failure joins the shutdown in progress.
    if (shuttingDown || (!node && !deno)) return;
    shuttingDown = true;
    if (node) node.exitCode = 1;
    else if (deno) { try { deno.exitCode = 1; } catch { /* Older Deno: exit(1) below sets it. */ } }
    setTimeout(() => exit(1), settings.shutdownTimeout);
    void (async () => {
      try { await settings.close(); }
      catch { /* The host's close reports its own failures. */ }
    })().finally(() => exit(1));
  };
  const handle = (kind: ServerErrorInfo["kind"], error: unknown, action: string, ownedByApp: boolean): void => {
    const scope = requestScope.getStore();
    settings.report(error, scope?.requestId ?? crypto.randomUUID(), { kind, inRequest: scope !== undefined });
    // The application's own listener decides what happens to the process.
    if (action === "shutdown" && !ownedByApp) shutdown();
  };
  if (node) {
    const foreign = (event: string): boolean =>
      node.listeners(event).some((listener) => (listener as { [ownListener]?: unknown })[ownListener] !== true);
    const onRejection = Object.assign((reason: unknown) => {
      handle("unhandledRejection", reason, rejection, foreign("unhandledRejection"));
    }, { [ownListener]: true });
    // `origin` is "unhandledRejection" when the runtime raised a rejection as an exception
    // (`--unhandled-rejections=strict`, or no rejection listener): it follows the exception policy.
    const onException = Object.assign((error: unknown, origin?: unknown) => {
      handle(origin === "unhandledRejection" ? "unhandledRejection" : "uncaughtException", error, exception, foreign("uncaughtException"));
    }, { [ownListener]: true });
    if (rejection !== "off") node.on("unhandledRejection", onRejection);
    if (exception !== "off") node.on("uncaughtException", onException);
    return () => {
      node.removeListener("unhandledRejection", onRejection);
      node.removeListener("uncaughtException", onException);
    };
  }
  const target = globalThis as unknown as Partial<GlobalEvents>;
  if (typeof target.addEventListener !== "function" || typeof target.removeEventListener !== "function") return () => {};
  const events = target as GlobalEvents;
  // An event that another listener already prevented belongs to the application: it is only reported.
  const onRejection = (event: Event): void => {
    const ownedByApp = event.defaultPrevented;
    event.preventDefault();
    handle("unhandledRejection", (event as Event & { reason?: unknown }).reason, rejection, ownedByApp);
  };
  const onError = (event: Event): void => {
    const ownedByApp = event.defaultPrevented;
    event.preventDefault();
    const uncaught = event as Event & { error?: unknown; message?: string };
    handle("uncaughtException", uncaught.error ?? new Error(uncaught.message || "Uncaught error"), exception, ownedByApp);
  };
  if (rejection !== "off") events.addEventListener("unhandledrejection", onRejection);
  // Workers report an exception through the request or the `waitUntil` task that raised it.
  if (exception !== "off" && settings.host === "deno") events.addEventListener("error", onError);
  return () => {
    events.removeEventListener("unhandledrejection", onRejection);
    events.removeEventListener("error", onError);
  };
}

/**
 * Aplica a un host propio la política de fallos del proceso de `server/runtime.ts`
 * (`processErrors`, véase {@link ProcessErrorPolicy}): una promesa rechazada sin manejar llega a
 * `onError` y el servidor sigue atendiendo; una excepción no capturada llega a `onError` y el host
 * se cierra de forma ordenada con código 1. Si el fallo ocurre durante el trabajo asíncrono de una
 * petición y el runtime conserva ese contexto, `requestId` es el de la petición. Escucha los
 * eventos de `process` en Node y Bun, los de `globalThis` en Deno y `unhandledrejection` en
 * Workers. Si la aplicación registró sus propios listeners de `process`, Meeko sólo informa y deja
 * que ellos decidan. `serveNode` y `serveDeno` la aplican con `handleSignals`, y la usan las
 * salidas de `meeko build` y `meeko dev`.
 *
 * @param app Aplicación de `createServerApp`.
 * @param options Cierre del host, observador y plazo del cierre.
 * @returns La función que retira los listeners.
 * @since 1.3.0
 * @example
 * ```ts
 * import { createServerApp, handleProcessErrors } from "@meekojs/meeko/server";
 * import { createBunServer } from "@meekojs/meeko/bun";
 *
 * const app = await createServerApp({ manifest, load, runtime, production: true });
 * const server = Bun.serve({ port: 3000, ...createBunServer(app) });
 * handleProcessErrors(app, { close: async () => { await server.stop(); await app.close(); } });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#errores
 */
export function handleProcessErrors(app: ServerApp, options: ProcessErrorOptions = {}): () => void {
  const shutdownTimeout = options.shutdownTimeout ?? 15_000;
  if (!Number.isFinite(shutdownTimeout) || shutdownTimeout < 0 || shutdownTimeout > 2_147_483_647) {
    throw new RangeError(`Invalid shutdownTimeout: ${shutdownTimeout}`);
  }
  const observer = options.onError ?? processErrorObserver(app);
  return installProcessErrorHandlers({
    host: detectHost(),
    policy: applications.get(app)?.policy,
    report: (error, requestId, info) => observeServerError(error, requestId, observer, info),
    close: options.close ?? (async () => {
      try { await app.close(); }
      catch (error) { observeServerError(error, crypto.randomUUID(), observer); }
    }),
    shutdownTimeout,
  });
}

/** Isolates whose process failures already reach an application. */
const watchedIsolates = new WeakSet<object>();

/** Reports the unhandled rejections of a Worker isolate to `app`, once per application. */
export function watchIsolateErrors(app: ServerApp, onError?: ServerErrorObserver): void {
  if (watchedIsolates.has(app)) return;
  watchedIsolates.add(app);
  const observer = onError ?? processErrorObserver(app);
  installProcessErrorHandlers({
    host: "worker",
    policy: applications.get(app)?.policy,
    report: (error, requestId, info) => observeServerError(error, requestId, observer, info),
    close: async () => {},
    shutdownTimeout: 0,
  });
}
