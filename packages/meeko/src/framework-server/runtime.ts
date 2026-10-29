import type { ServerErrorObserver } from "./contracts.js";
import type { PlatformName, ServerPlatform } from "./platform.js";
import type { ProcessErrorPolicy } from "./process-errors.js";
import type { SessionManager } from "./sessions.js";
import type { SocketDeliveryErrorContext, SocketPubSub } from "./socket.js";

/**
 * Lo que recibe la fábrica de `server/runtime.ts` al crear el runtime de la aplicación.
 *
 * @typeParam Env Tipo de las variables o bindings del entorno.
 * @example
 * ```ts
 * import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
 * import type { ServerRuntimeContext } from "@meekojs/meeko/server";
 *
 * function sessionsFor({ production, prerendering }: ServerRuntimeContext): SessionManager {
 *   return new SessionManager({ store: new MemorySessionStore(), production: production && !prerendering });
 * }
 * export default defineServerRuntime((context) => ({ sessions: sessionsFor(context) }));
 * ```
 */
export interface ServerRuntimeContext<Env = Readonly<Record<string, string | undefined>>> {
  /** Variables de entorno (Node, Deno, Bun) o bindings (Workers). */
  readonly env: Env;
  /** `true` en producción. */
  readonly production: boolean;
  /** Runtime que ejecuta la aplicación. */
  readonly platform: PlatformName;
  /** `true` mientras `meeko build` prerenderiza páginas; no se sirve tráfico de clientes. */
  readonly prerendering: boolean;
}

/**
 * Servicios de la aplicación: un objeto compartido o una función que los crea en cada petición.
 * Llegan a páginas, API, RPC y Socket como `RequestContext.services`.
 *
 * @typeParam Services Tipo de los servicios.
 * @typeParam Env Tipo de las variables o bindings del entorno.
 * @example
 * ```ts
 * import type { ServerServices } from "@meekojs/meeko/server";
 *
 * type Services = { readonly region: string; readonly startedAt: number };
 * const services: ServerServices<Services, { REGION?: string }> = (request, { platform }) => ({
 *   region: platform.env.REGION ?? "local",
 *   startedAt: Date.now(),
 * });
 * ```
 */
export type ServerServices<Services, Env = unknown> =
  | Services
  | ((request: Request, context: { readonly platform: ServerPlatform<Env> }) => Services | Promise<Services>);

/**
 * Recursos de servidor de la aplicación, creados una vez por proceso o aislado: sesiones,
 * servicios, política de Socket, origen público, observador de errores y cierre.
 *
 * @typeParam Services Tipo de los servicios.
 * @typeParam Env Tipo de las variables o bindings del entorno.
 * @example
 * ```ts
 * import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
 * import type { ServerRuntime } from "@meekojs/meeko/server";
 *
 * const runtime: ServerRuntime<{ readonly startedAt: number }> = {
 *   sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),
 *   services: { startedAt: Date.now() },
 *   socket: { maxMessageBytes: 64 * 1024 },
 *   publicOrigin: "https://example.com",
 *   onError: (error, requestId) => console.error("request failed", requestId, error),
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#runtime-de-servidor
 */
export interface ServerRuntime<Services = unknown, Env = unknown> {
  /**
   * Gestor de sesiones. En producción necesita un store persistente. Desde `1.2` es opcional: sin
   * él, Meeko usa memoria en desarrollo y, en producción, Redis con `MEEKO_REDIS_URL` (véase
   * [Autenticación](https://github.com/meekojs/meeko/blob/main/docs/framework.md#autenticación)).
   */
  readonly sessions?: SessionManager<any>;
  /** Se expone como `RequestContext.services` a páginas, API, RPC y canales Socket. */
  readonly services?: ServerServices<Services, Env>;
  /** Política de Socket. */
  readonly socket?: {
    /** Broker entre instancias, como `RedisSocketPubSub`. Por defecto, `LocalSocketPubSub`. */
    readonly pubsub?: SocketPubSub;
    /** Entregas fallidas a peers locales. Por defecto, `onError` con un ID de petición nuevo. */
    readonly onDeliveryError?: (error: unknown, context: SocketDeliveryErrorContext) => void;
    /** Orígenes adicionales aceptados en el handshake. */
    readonly allowedOrigins?: readonly string[];
    /** Tamaño máximo de un mensaje entrante y saliente. Por defecto, 64 KiB. */
    readonly maxMessageBytes?: number;
    /** Bytes salientes pendientes por peer antes de cerrarlo. */
    readonly maxBufferBytes?: number;
    /** Entregas del broker que un peer puede tener en espera antes de cerrarse con `1013`. Por defecto, 256. */
    readonly maxPendingDeliveries?: number;
    /** Milisegundos durante los que una entrega reutiliza la última lectura de sesión del peer. Por defecto, 1000. */
    readonly sessionRefreshMs?: number;
  };
  /**
   * Origen público de la aplicación, como `https://example.com` tras un proxy TLS. Las
   * comprobaciones de `Origin` de HTTP y de Socket se comparan con él.
   */
  readonly publicOrigin?: string;
  /**
   * Recibe los fallos internos con su ID de petición; nunca se envían a los clientes. Desde `1.3`,
   * también los fallos del proceso (promesas rechazadas sin manejar y excepciones no capturadas),
   * con un tercer argumento que los identifica.
   */
  readonly onError?: ServerErrorObserver;
  /**
   * Qué hacer con las promesas rechazadas sin manejar y las excepciones no capturadas del proceso.
   * Por defecto, un rechazo se informa a `onError` y el servidor sigue atendiendo, y una excepción
   * se informa y cierra el servidor de forma ordenada con código 1. `false` deja los dos casos al
   * runtime. Se aplica en `meeko dev`, en las salidas de `meeko build` y en `serveNode` y
   * `serveDeno` con `handleSignals`.
   * @since 1.3.0
   */
  readonly processErrors?: ProcessErrorPolicy | false;
  /** Libera los recursos del runtime después de cerrar sus sesiones. */
  readonly close?: () => void | Promise<void>;
}

/**
 * Export por defecto de `server/runtime.ts`: la fábrica que Meeko llama una vez por proceso o
 * aislado. Créela con {@link defineServerRuntime}.
 *
 * @typeParam Env Tipo de las variables o bindings del entorno.
 * @typeParam Services Tipo de los servicios.
 * @example
 * ```ts
 * import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
 * import type { ServerRuntimeDefinition } from "@meekojs/meeko/server";
 *
 * const runtime: ServerRuntimeDefinition = ({ production }) => ({
 *   sessions: new SessionManager({ store: new MemorySessionStore(), production }),
 * });
 * export default runtime;
 * ```
 */
export type ServerRuntimeDefinition<Env = Readonly<Record<string, string | undefined>>, Services = unknown> =
  (context: ServerRuntimeContext<Env>) => ServerRuntime<Services, Env> | Promise<ServerRuntime<Services, Env>>;

/**
 * Tipo de los servicios que devuelve una definición de runtime: el `services` del objeto que crea la
 * fábrica o, si `services` es una función por petición, lo que ésta devuelve (sin la promesa). Sin
 * `services`, `unknown`. Meeko lo usa para inferir {@link AppServices} de `server/runtime.ts`.
 *
 * @typeParam Definition Tipo de la fábrica, como `typeof runtime` de `server/runtime.ts`.
 * @since 1.7.0
 * @example
 * ```ts
 * import type { ServerRuntimeServices } from "@meekojs/meeko/server";
 * import type runtime from "../runtime.js";
 *
 * type Services = ServerRuntimeServices<typeof runtime>;
 * export function ready(services: Services): boolean {
 *   return services.db.connected;
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#tipos-de-los-servicios
 */
export type ServerRuntimeServices<Definition> = Definition extends (...args: never[]) => infer Result
  ? Awaited<Result> extends { readonly services?: infer Services } ? ServicesValue<Exclude<Services, undefined>> : unknown
  : unknown;

/** The services a `services` option gives: a per-request factory resolves to what it returns. */
type ServicesValue<Services> = Services extends (...args: never[]) => infer Value ? Awaited<Value> : Services;

/**
 * Registro de los servicios de la aplicación. Está vacío: `meeko check`, `meeko dev` y el editor lo
 * amplían en `.meeko/types/services.d.ts` con `services`, el tipo que infieren del export por
 * defecto de `server/runtime.ts` (véase {@link ServerRuntimeServices}). Un host propio sin esas
 * declaraciones puede ampliarlo a mano. No valida en ejecución.
 *
 * @since 1.7.0
 * @example
 * ```ts
 * // server/types/services.d.ts, sólo en un host propio: Meeko genera esta declaración.
 * import type {} from "@meekojs/meeko/server";
 * import type { Database } from "../utils/database.js";
 * declare module "@meekojs/meeko/server" {
 *   interface GeneratedServices { readonly services: { readonly db: Database } }
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#tipos-de-los-servicios
 */
// Empty on purpose: the generated declarations add `services` through module augmentation.
export interface GeneratedServices {}

/**
 * Servicios de la aplicación: los de {@link GeneratedServices} (inferidos de `server/runtime.ts`) o
 * `unknown` sin ellos. Es el tipo de `RequestContext.services` cuando no se indica otro, así que
 * `context.services` queda tipado sin conversiones en páginas, `usePage()`, API, RPC, Socket y el
 * middleware de ruta de servidor.
 *
 * @since 1.7.0
 * @example
 * ```ts
 * import type { AppServices } from "@meekojs/meeko/server";
 *
 * export async function countUsers(services: AppServices): Promise<number> {
 *   return services.db.users.count();
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#tipos-de-los-servicios
 */
export type AppServices = GeneratedServices extends { readonly services: infer Services } ? Services : unknown;

/**
 * `services` of a request context: the written type, or {@link AppServices} for `unknown`, the
 * default of every `services` type parameter. `any` stays `any`.
 */
export type ContextServices<TServices> = 0 extends 1 & TServices ? TServices : unknown extends TServices ? AppServices : TServices;

/**
 * Declara en `server/runtime.ts` las sesiones, los servicios y la política de Socket de la
 * aplicación. Meeko llama a la fábrica una vez por proceso con `{ env, production, platform,
 * prerendering }`; con `prerendering` no se sirve tráfico y basta un store en memoria.
 *
 * @param factory Fábrica, síncrona o asíncrona, del runtime.
 * @returns La misma fábrica.
 * @throws {TypeError} Si `factory` no es una función.
 * @example
 * ```ts
 * // server/runtime.ts
 * import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";
 * import { createDatabase } from "./utils/database.js";
 *
 * export default defineServerRuntime(async ({ env, production, prerendering }) => {
 *   const db = await createDatabase(env.DATABASE_URL);
 *   return {
 *     sessions: new SessionManager({ store: db.sessionStore(), production: production && !prerendering }),
 *     services: (request, { platform }) => ({ db, region: platform.env.REGION }),
 *     publicOrigin: env.MEEKO_PUBLIC_ORIGIN,
 *     close: () => db.close(),
 *   };
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#runtime-de-servidor
 */
export function defineServerRuntime<Env = Readonly<Record<string, string | undefined>>, Services = unknown>(
  factory: ServerRuntimeDefinition<Env, Services>,
): ServerRuntimeDefinition<Env, Services> {
  if (typeof factory !== "function") throw new TypeError("defineServerRuntime requires a factory function");
  return factory;
}
