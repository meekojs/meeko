import type { ContextKey } from "../../core/reactivity";
import type { HeadInput } from "../../shared/head";
import type { LinkResolver } from "../../shared/link";
import type { ErrorSource } from "../runtime/component-errors";
import type { RouteState } from "../runtime/navigation";

import { provide } from "../../core/reactivity";
import { linkResolverKey } from "../../shared/link";
import { useHead } from "../composables/use-head";

/** Brand of the objects `definePlugin` returns; `Symbol.for` so two copies of Meeko agree. */
const pluginBrand: unique symbol = Symbol.for("meeko.app-plugin") as never;

/**
 * Dónde se observó un fallo que recibe un {@link PluginErrorHandler}: en el navegador, con su
 * `ErrorSource` (navegación, Socket, eventos, efectos…); en el servidor, con el `requestId` de la
 * petición cuyo render falló.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { PluginErrorInfo } from "@meekojs/meeko/framework";
 *
 * function describe(info: PluginErrorInfo): string {
 *   return info.side === "client" ? `navegador (${info.source})` : `servidor (${info.requestId})`;
 * }
 * ```
 */
export type PluginErrorInfo =
  | {
    /** Discriminante: el fallo se observó en el navegador. */
    readonly side: "client";
    /** Origen del fallo en el navegador: navegación, Socket, eventos, efectos… */
    readonly source: ErrorSource;
  }
  | {
    /** Discriminante: el fallo se observó en el servidor. */
    readonly side: "server";
    /** ID de la petición cuyo render falló, el mismo de la cabecera `x-request-id`. */
    readonly requestId: string;
  };

/**
 * Observador de errores que registra un plugin con {@link PluginApp.onError}. `error` es `unknown`:
 * refínelo antes de leer sus propiedades. Un observador que lanza no cambia la respuesta ni la
 * página; Meeko registra ese fallo junto al original.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { PluginErrorHandler } from "@meekojs/meeko/framework";
 *
 * export const report: PluginErrorHandler = (error, info) => {
 *   console.error("[app]", info.side, error instanceof Error ? error.message : String(error));
 * };
 * ```
 */
export type PluginErrorHandler = (error: unknown, info: PluginErrorInfo) => void;

/**
 * Aplicación que recibe un plugin de `app/plugins` (o de un módulo) al arrancar. En el navegador
 * hay una por pestaña, antes de la hidratación; en el servidor, una por petición de página, antes
 * del render.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * // app/plugins/analytics.client.ts
 * import { definePlugin } from "@meekojs/meeko/framework";
 *
 * export default definePlugin((app) => {
 *   console.log("arranca en", app.side, "con la ruta", app.route.path.value);
 *   app.onError((error) => navigator.sendBeacon("/api/errors", String(error)));
 * });
 * ```
 */
export interface PluginApp {
  /** `"client"` en el navegador y `"server"` durante el render de una petición. */
  readonly side: "client" | "server";
  /**
   * Ruta de la aplicación, como la de `useRoute()`. En el servidor es la de la petición; en el
   * navegador sigue a la ruta confirmada, así que un `effect` que la lee se repite al navegar.
   */
  readonly route: RouteState;
  /** Petición HTTP que se renderiza; `undefined` en el navegador. */
  readonly request: Request | undefined;
  /**
   * Publica un valor para todos los componentes de la aplicación, que lo leen con `inject(key)`.
   * En el servidor el valor es de esta petición; no comparta en él estado mutable entre peticiones.
   */
  provide<T>(key: ContextKey<T>, value: T): void;
  /** Adds document attributes and tags to every render root of this plugin. */
  addHead(input: () => HeadInput): void;
  /** Runs before a client navigation; return false after taking over navigation. */
  beforeNavigate(handler: (url: URL, routeId: string | null) => boolean | void | Promise<boolean | void>): void;
  /**
   * Registra un resolvedor del `href` de cada `<MeekoLink>` de la aplicación (desde 1.8.0), por
   * ejemplo para añadir el prefijo del idioma. Varios resolvedores se encadenan en el orden de
   * registro: cada uno recibe el `href` del anterior. Un enlace con `bind:resolve="false"` no pasa
   * por ellos. Véase {@link LinkResolver}.
   *
   * @example
   * ```ts
   * app.resolveLink(({ href, hreflang }) => hreflang === "en" ? `/en${href}` : href);
   * ```
   */
  resolveLink(resolver: LinkResolver): void;
  /**
   * Registra un observador de errores de la aplicación. En el navegador recibe lo mismo que
   * `mountClientApp({ onError })`; en el servidor, los fallos del render de esta petición, además
   * del `onError` de `server/runtime.ts`.
   */
  onError(handler: PluginErrorHandler): void;
}

/**
 * Plugin de aplicación creado con {@link definePlugin}: el export por defecto de un archivo de
 * `app/plugins` o de un archivo que un módulo añade con `meeko.addPlugin`.
 *
 * @typeParam Options Opciones que recibe del módulo que lo añade; `undefined` en `app/plugins`.
 * @since 1.2.0
 * @example
 * ```ts
 * import { definePlugin } from "@meekojs/meeko/framework";
 * import type { MeekoPlugin } from "@meekojs/meeko/framework";
 *
 * const plugin: MeekoPlugin = definePlugin((app) => { console.log(app.side); });
 * export default plugin;
 * ```
 */
export interface MeekoPlugin<Options = undefined> {
  /** Función que se ejecuta al arrancar la aplicación; puede ser asíncrona. */
  readonly setup: (app: PluginApp, options: Options) => void | Promise<void>;
}

/**
 * Plugin con sus opciones, tal como lo listan las entradas generadas. Un módulo lo produce con
 * `meeko.addPlugin({ src, options })`; un host propio lo pasa a `mountClientApp` o a
 * `createServerApp` en `plugins`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { definePlugin } from "@meekojs/meeko/framework";
 * import type { PluginRegistration } from "@meekojs/meeko/framework";
 *
 * const greeting = definePlugin<{ text: string }>((app, options) => { console.log(options.text, app.side); });
 * const plugins: PluginRegistration[] = [{ plugin: greeting, options: { text: "hola" }, name: "greeting" }];
 * ```
 */
export interface PluginRegistration {
  /** Export por defecto del archivo del plugin; se comprueba al arrancar. */
  readonly plugin: unknown;
  /** Opciones que recibe `setup` como segundo argumento. */
  readonly options?: unknown;
  /** Nombre en los mensajes de error, como el archivo del plugin. */
  readonly name?: string;
}

/**
 * Declara un plugin de aplicación. Un archivo de `app/plugins` lo exporta por defecto y se
 * ejecuta al arrancar la aplicación: `*.client.ts` sólo en el navegador, antes de la hidratación;
 * `*.server.ts` sólo en el servidor, una vez por petición de página antes del render; un `.ts`
 * sin sufijo, en ambos. `setup` puede publicar valores con `app.provide`, registrar observadores de
 * errores con `app.onError` y leer `app.route`.
 *
 * @param setup Función que recibe la aplicación y las opciones del módulo que añade el plugin.
 * @returns El plugin, para exportarlo por defecto.
 * @since 1.2.0
 * @example
 * ```ts
 * // app/plugins/theme.ts
 * import { createContext, signal } from "@meekojs/meeko";
 * import type { Signal } from "@meekojs/meeko";
 * import { definePlugin } from "@meekojs/meeko/framework";
 *
 * export const themeKey = createContext<Signal<"light" | "dark">>("theme");
 *
 * export default definePlugin((app) => {
 *   app.provide(themeKey, signal<"light" | "dark">("light"));
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#plugins-de-aplicación
 */
export function definePlugin<Options = undefined>(setup: (app: PluginApp, options: Options) => void | Promise<void>): MeekoPlugin<Options> {
  if (typeof setup !== "function") throw new TypeError("definePlugin requires a setup function");
  return Object.freeze({ setup, [pluginBrand]: true }) as MeekoPlugin<Options>;
}

function isPlugin(value: unknown): value is MeekoPlugin<unknown> {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[pluginBrand] === true
    && typeof (value as { setup?: unknown }).setup === "function";
}

/** What the plugins of one application start published. */
export interface PluginState {
  /** Publishes the plugins' values in the active root; call it in every render root of the app. */
  apply(): void;
  beforeNavigate(url: URL, routeId: string | null): Promise<boolean>;
  /** Error observers the plugins registered, in registration order. */
  readonly errorHandlers: readonly PluginErrorHandler[];
}

/** The state of an application without plugins. */
export const emptyPluginState: PluginState = Object.freeze({ apply() {}, async beforeNavigate() { return true; }, errorHandlers: Object.freeze([]) });

/**
 * Runs `registrations` in order (each awaited before the next) and collects what they publish.
 * A default export that is not a `definePlugin(...)` result fails with the plugin's name.
 */
export async function runPlugins(
  registrations: readonly PluginRegistration[] | undefined,
  context: { readonly side: "client" | "server"; readonly route: RouteState; readonly request?: Request | undefined },
): Promise<PluginState> {
  if (!registrations?.length) return emptyPluginState;
  const provided: Array<readonly [ContextKey<unknown>, unknown]> = [];
  const headInputs: Array<() => HeadInput> = [];
  const navigationHandlers: Array<(url: URL, routeId: string | null) => boolean | void | Promise<boolean | void>> = [];
  const errorHandlers: PluginErrorHandler[] = [];
  const linkResolvers: LinkResolver[] = [];
  for (const [index, registration] of registrations.entries()) {
    const name = registration.name ?? `plugin ${index + 1}`;
    if (!isPlugin(registration.plugin)) throw new TypeError(`${name} must default-export definePlugin(...)`);
    const app: PluginApp = Object.freeze({
      side: context.side,
      route: context.route,
      request: context.request,
      provide<T>(key: ContextKey<T>, value: T): void { provided.push([key as ContextKey<unknown>, value]); },
      addHead(input: () => HeadInput): void {
        if (typeof input !== "function") throw new TypeError(`${name}: addHead requires a function`);
        headInputs.push(input);
      },
      beforeNavigate(handler: (url: URL, routeId: string | null) => boolean | void | Promise<boolean | void>): void {
        if (typeof handler !== "function") throw new TypeError(`${name}: beforeNavigate requires a function`);
        navigationHandlers.push(handler);
      },
      resolveLink(resolver: LinkResolver): void {
        if (typeof resolver !== "function") throw new TypeError(`${name}: resolveLink requires a function`);
        linkResolvers.push(resolver);
      },
      onError(handler: PluginErrorHandler): void {
        if (typeof handler !== "function") throw new TypeError(`${name}: onError requires a function`);
        errorHandlers.push(handler);
      },
    });
    await registration.plugin.setup(app, registration.options);
  }
  // One function for every link: each resolver gets the href of the one before it.
  const resolveLink: LinkResolver | undefined = linkResolvers.length === 0 ? undefined
    : linkResolvers.length === 1 ? linkResolvers[0]
    : (link) => linkResolvers.reduce((href, resolver) => resolver({ ...link, href }), link.href);
  return {
    apply() {
      for (const [key, value] of provided) provide(key, value);
      if (resolveLink) provide(linkResolverKey, resolveLink);
      for (const input of headInputs) useHead(input);
    },
    async beforeNavigate(url, routeId) {
      for (const handler of navigationHandlers) if (await handler(url, routeId) === false) return false;
      return true;
    },
    errorHandlers,
  };
}

/** Calls every observer; a failing observer is logged with the original error and never escapes. */
export function notifyPluginErrorHandlers(handlers: readonly PluginErrorHandler[], error: unknown, info: PluginErrorInfo): void {
  for (const handler of handlers) {
    try {
      const result = handler(error, info) as unknown;
      if (result && typeof (result as { then?: unknown }).then === "function") {
        void Promise.resolve(result).catch((observerError: unknown) => console.error("Meeko plugin error observer failed", observerError, error));
      }
    } catch (observerError) {
      try { console.error("Meeko plugin error observer failed", observerError, error); }
      catch { /* A broken console cannot escape an error observer. */ }
    }
  }
}
