import type { ServerErrorObserver } from "./contracts.js";
import type { PlatformName, ServerPlatform } from "./platform.js";
import type { SessionManager } from "./sessions.js";
import type { SocketPubSub } from "./socket.js";

/** Values available while the application runtime is created. */
export interface ServerRuntimeContext<Env = Readonly<Record<string, string | undefined>>> {
  /** Environment variables (Node, Deno, Bun) or bindings (Workers). */
  readonly env: Env;
  readonly production: boolean;
  readonly platform: PlatformName;
  /** True while `meeko build` renders prerendered pages; no client traffic is served. */
  readonly prerendering: boolean;
}

/** Services can be shared or derived for each request. */
export type ServerServices<Services, Env = unknown> =
  | Services
  | ((request: Request, context: { readonly platform: ServerPlatform<Env> }) => Services | Promise<Services>);

/** Application-owned server resources, created once per process or isolate. */
export interface ServerRuntime<Services = unknown, Env = unknown> {
  readonly sessions: SessionManager<any>;
  /** Exposed as `RequestContext.services` to pages, API, RPC and Socket channels. */
  readonly services?: ServerServices<Services, Env>;
  readonly socket?: {
    readonly pubsub?: SocketPubSub;
    readonly allowedOrigins?: readonly string[];
    /** Maximum inbound and outbound message size. Defaults to 64 KiB. */
    readonly maxMessageBytes?: number;
    readonly maxBufferBytes?: number;
  };
  /**
   * Public origin of the application, such as `https://example.com` behind a
   * TLS proxy. HTTP and Socket origin checks both compare against it.
   */
  readonly publicOrigin?: string;
  /** Receives internal failures with their request ID; never sent to clients. */
  readonly onError?: ServerErrorObserver;
  /** Releases resources owned by the runtime after its sessions close. */
  readonly close?: () => void | Promise<void>;
}

/** Default export of `server/runtime.ts`. */
export type ServerRuntimeDefinition<Env = Readonly<Record<string, string | undefined>>, Services = unknown> =
  (context: ServerRuntimeContext<Env>) => ServerRuntime<Services, Env> | Promise<ServerRuntime<Services, Env>>;

/** Declares the application's sessions, services and Socket policy in `server/runtime.ts`. */
export function defineServerRuntime<Env = Readonly<Record<string, string | undefined>>, Services = unknown>(
  factory: ServerRuntimeDefinition<Env, Services>,
): ServerRuntimeDefinition<Env, Services> {
  if (typeof factory !== "function") throw new TypeError("defineServerRuntime requires a factory function");
  return factory;
}
