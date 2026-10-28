import type { DocumentHead } from "./head.js";
import type { MeekoAdapterName, MeekoConfig } from "./config-type.js";
import type { RouteRecord } from "./router.js";

/** Brand of the objects `defineMeekoModule` returns; `Symbol.for` so two copies of Meeko agree. */
export const moduleBrand: unique symbol = Symbol.for("meeko.module") as never;

/**
 * Identidad de un módulo de Meeko: su nombre, la clave de sus opciones en `meeko.config.ts` y la
 * versión de Meeko que necesita.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { MeekoModuleMeta } from "@meekojs/meeko/framework";
 *
 * const meta: MeekoModuleMeta = { name: "@acme/seo", configKey: "seo", compatibility: { meeko: ">=1.2" } };
 * ```
 */
export interface MeekoModuleMeta {
  /** Nombre único del módulo, como el de su paquete. Dos módulos con el mismo nombre son un error. */
  readonly name: string;
  /** Campo de `meeko.config.ts` con las opciones del módulo, como `"seo"` para `seo: { … }`. */
  readonly configKey?: string;
  /**
   * Rango de versiones de Meeko que admite, con la sintaxis de npm (`">=1.2"`, `"^1.2.0"`,
   * `">=1.2 <2"`, `"1.x || 2.x"`). Fuera del rango, la carga de la configuración falla.
   */
  readonly compatibility?: { readonly meeko?: string };
}

/**
 * Archivo de autoimport que añade un módulo con `meeko.addAutoImports`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ModuleAutoImport } from "@meekojs/meeko/framework";
 *
 * const entries: ModuleAutoImport[] = [
 *   { name: "useAccent", from: "@acme/accent/runtime" },
 *   { name: "format", as: "formatDate", from: "date-fns", scope: "shared" },
 *   { name: "Accent", from: "@acme/accent/runtime", type: true },
 * ];
 * ```
 */
export interface ModuleAutoImport {
  /** Nombre exportado por `from`. */
  readonly name: string;
  /** Nombre con el que se usa sin import; por defecto, `name`. */
  readonly as?: string;
  /**
   * Origen: un especificador de paquete (`"@acme/theme/runtime"`), una ruta absoluta, una URL
   * `file:` o una ruta relativa a la raíz del proyecto (`"./modules/theme/use-theme.ts"`).
   */
  readonly from: string | URL;
  /** `true` si sólo es un tipo; se importa con `import type`. */
  readonly type?: boolean;
  /**
   * Dónde se puede usar: `"app"` (componentes y `app/`, en el navegador y en SSR, el valor por
   * defecto), `"client"` (sólo navegador), `"server"` (sólo servidor) o `"shared"` (en todas partes).
   */
  readonly scope?: "app" | "client" | "server" | "shared";
}

/**
 * Plugin de aplicación que añade un módulo con `meeko.addPlugin`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ModulePlugin } from "@meekojs/meeko/framework";
 *
 * const plugin: ModulePlugin = {
 *   src: new URL("./runtime/theme.client.ts", import.meta.url),
 *   mode: "client",
 *   options: { storageKey: "theme" },
 * };
 * ```
 */
export interface ModulePlugin {
  /** Archivo que exporta por defecto `definePlugin(...)`: ruta absoluta, URL `file:` o ruta relativa a la raíz del proyecto. */
  readonly src: string | URL;
  /**
   * Dónde se ejecuta: `"client"`, `"server"` o `"universal"` (ambos). Por defecto, el sufijo del
   * archivo (`.client.ts`, `.server.ts`) o `"universal"`.
   */
  readonly mode?: "client" | "server" | "universal";
  /**
   * Opciones serializables en JSON que recibe `setup` como segundo argumento. Las de un plugin
   * `"client"` o `"universal"` llegan al navegador: no ponga secretos.
   */
  readonly options?: unknown;
}

/**
 * Handler HTTP de servidor que añade un módulo con `meeko.addServerHandler`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ModuleServerHandler } from "@meekojs/meeko/framework";
 *
 * const handler: ModuleServerHandler = { route: "/robots.txt", handler: new URL("./runtime/robots.ts", import.meta.url) };
 * ```
 */
export interface ModuleServerHandler {
  /** Ruta exacta (`pathname`) que atiende, como `"/sitemap.xml"`; empieza por `/`. */
  readonly route: string;
  /**
   * Archivo cuyo export por defecto es `(request: Request) => Response | Promise<Response>`: ruta
   * absoluta, URL `file:` o ruta relativa a la raíz del proyecto. Se ejecuta sólo en el servidor,
   * después del middleware de servidor.
   */
  readonly handler: string | URL;
}

/**
 * Hooks de build que un módulo registra con `meeko.hooks.hook(nombre, handler)`. Se ejecutan en
 * Node, en el orden en que se registraron, y Meeko espera cada uno.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { MeekoHooks } from "@meekojs/meeko/framework";
 *
 * const onRoutes: MeekoHooks["routes:resolved"] = ({ routes }) => {
 *   console.log(routes.map((route) => route.id));
 * };
 * ```
 */
export interface MeekoHooks {
  /** Todos los módulos terminaron su `setup`. */
  ready(): void | Promise<void>;
  /**
   * Meeko descubrió el manifiesto de rutas (aplicación, layers y módulos), con los archivos como
   * rutas absolutas: antes del build cliente en `meeko build`, y al arrancar y en cada
   * redescubrimiento en `meeko dev`.
   */
  "routes:resolved"(context: { readonly routes: readonly RouteRecord[] }): void | Promise<void>;
  /** Empieza `meeko build`; `output` es la carpeta absoluta del adaptador. */
  "build:before"(context: { readonly adapter: MeekoAdapterName; readonly output: string }): void | Promise<void>;
  /** `meeko build` terminó, prerender incluido; un módulo puede añadir archivos a `output`. */
  "build:done"(context: { readonly adapter: MeekoAdapterName; readonly output: string }): void | Promise<void>;
  /**
   * URL que se van a prerenderizar (`pathname`). Un módulo puede añadir o quitar entradas; cada
   * URL debe corresponder a una ruta de la aplicación.
   */
  "prerender:routes"(context: { readonly urls: string[] }): void | Promise<void>;
}

/**
 * Registro de hooks de {@link MeekoModuleContext}.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { MeekoHookable } from "@meekojs/meeko/framework";
 *
 * function logBuilds(hooks: MeekoHookable): void {
 *   hooks.hook("build:done", ({ output }) => console.log("build en", output));
 * }
 * ```
 */
export interface MeekoHookable {
  /**
   * Registra `handler` para el hook `name`.
   *
   * @returns Una función que lo quita.
   */
  hook<Name extends keyof MeekoHooks>(name: Name, handler: MeekoHooks[Name]): () => void;
}

/**
 * Objeto `meeko` que recibe `setup` de un módulo, en Node, durante `meeko dev`, `meeko build` y
 * `meeko check` (y en el servidor de lenguaje de un workspace de confianza). Nunca llega al
 * navegador. Las rutas aceptan una ruta absoluta, una URL `file:` (`new URL("./x", import.meta.url)`)
 * o una ruta relativa a la raíz del proyecto.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineMeekoModule } from "@meekojs/meeko/framework";
 *
 * export default defineMeekoModule({
 *   meta: { name: "hello" },
 *   setup(_options, meeko) {
 *     meeko.addComponentsDir(new URL("./components", import.meta.url), { prefix: "Hello" });
 *     meeko.addPlugin({ src: new URL("./runtime/hello.client.ts", import.meta.url) });
 *   },
 * });
 * ```
 */
export interface MeekoModuleContext {
  /** Carpeta absoluta del proyecto. */
  readonly rootDir: string;
  /** `true` durante `meeko dev`. */
  readonly dev: boolean;
  /** Configuración de `meeko.config.ts`, tal como se cargó. */
  readonly config: Readonly<MeekoConfig>;
  /** Hooks de build. */
  readonly hooks: MeekoHookable;
  /**
   * Añade una carpeta como layer, después de los de `layers`: sus `app/pages`, componentes,
   * autoimports y `app/plugins`. Debe tener `app/pages` y estar dentro del proyecto (un paquete en
   * `node_modules` lo está).
   */
  addLayer(dir: string | URL): void;
  /** Añade los componentes `.meeko` de una carpeta (y subcarpetas) al autoimport, con un prefijo opcional en PascalCase. */
  addComponentsDir(dir: string | URL, options?: { readonly prefix?: string }): void;
  /**
   * Añade un layout con nombre, como un archivo de `app/layouts`: las páginas lo eligen con
   * `definePage({ layout: name })` o un `+group.ts`. Un layout del proyecto o de un layer con el
   * mismo nombre gana; dos módulos con el mismo nombre son un error. Un `default` envuelve las
   * páginas que no eligen layout si el proyecto no tiene `app/layouts/default.meeko`.
   *
   * @param name Nombre del layout: letras, dígitos, guiones y `_`, con `/` entre carpetas (`"admin/panel"`).
   * @param file Archivo `.meeko` del layout.
   * @since 1.5.0
   * @example
   * ```ts
   * meeko.addLayout("docs", new URL("./runtime/docs-layout.meeko", import.meta.url));
   * ```
   */
  addLayout(name: string, file: string | URL): void;
  /** Añade autoimports de un paquete o archivo. */
  addAutoImports(entries: ModuleAutoImport | readonly ModuleAutoImport[]): void;
  /**
   * Añade al autoimport los exports de los archivos `.ts` de una carpeta, con el ámbito indicado.
   * Los sufijos `.client.ts`, `.server.ts` y `.shared.ts` mandan sobre `scope`.
   */
  addAutoImportsDir(dir: string | URL, options: { readonly scope: "app" | "server" | "shared" }): void;
  /** Añade un plugin de aplicación. Los de los módulos se ejecutan antes que los de `app/plugins`. */
  addPlugin(plugin: ModulePlugin | string | URL): void;
  /**
   * Añade un middleware de servidor, como un archivo de `server/middleware`. Los de los módulos se
   * ejecutan antes que los del proyecto, en el orden en que se añaden.
   */
  addServerMiddleware(file: string | URL): void;
  /** Añade un handler HTTP para una ruta exacta. */
  addServerHandler(handler: ModuleServerHandler): void;
  /**
   * Añade un archivo público, como si estuviera en `public/`: `meeko build` lo escribe en la salida
   * del cliente y `meeko dev` lo sirve. Una función se evalúa al escribirlo (en dev, en cada
   * petición), por ejemplo con las rutas de `routes:resolved`.
   */
  addPublicFile(path: string, contents: string | Uint8Array | (() => string | Uint8Array | Promise<string | Uint8Array>)): void;
  /**
   * Añade entradas al `<head>` de todos los documentos (`document.head`). Los arrays se concatenan
   * en el orden de los módulos; `title` y `titleTemplate` se quedan con el último valor, y
   * `document.head` de `meeko.config.ts` se aplica al final. Como en `document.head`,
   * `titleTemplate` es una cadena y `title` es el título del sitio, que no pasa por la plantilla.
   */
  addHead(input: DocumentHead): void;
  /** Añade un plugin de Vite (u otro valor de `plugins`) a `meeko dev` y `meeko build`. */
  addVitePlugin(plugin: object | readonly object[]): void;
  /**
   * Modifica la configuración inline de Vite de `meeko dev` y de cada build de `meeko build` antes
   * de usarla. La función recibe la configuración y puede cambiarla o devolver una nueva.
   */
  extendViteConfig(extend: (config: Record<string, any>, context: { readonly command: "serve" | "build"; readonly ssr: boolean }) => void | Record<string, any>): void;
  /** Escribe un aviso en la salida de errores con el nombre del módulo. */
  warn(message: string): void;
}

/**
 * Definición que recibe {@link defineMeekoModule}.
 *
 * @typeParam Options Opciones del módulo.
 * @since 1.2.0
 * @example
 * ```ts
 * import type { MeekoModuleDefinition } from "@meekojs/meeko/framework";
 *
 * const definition: MeekoModuleDefinition<{ greeting: string }> = {
 *   meta: { name: "hello", configKey: "hello" },
 *   defaults: { greeting: "Hola" },
 *   setup(options, meeko) { meeko.warn(options.greeting); },
 * };
 * ```
 */
export interface MeekoModuleDefinition<Options extends object> {
  /** Nombre, clave de configuración y compatibilidad. */
  readonly meta: MeekoModuleMeta;
  /** Valores por defecto de las opciones; `config[configKey]` y las opciones de `[module, options]` los sustituyen. */
  readonly defaults?: Partial<Options>;
  /** Configura el proyecto en Node con las opciones combinadas. Puede ser asíncrona. */
  setup(options: Options, meeko: MeekoModuleContext): void | Promise<void>;
}

/**
 * Módulo de Meeko creado con {@link defineMeekoModule}: el export por defecto de un paquete o un
 * archivo que se lista en `modules` de `meeko.config.ts`.
 *
 * @typeParam Options Opciones del módulo.
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineMeekoConfig } from "@meekojs/meeko/framework";
 * import hello from "./modules/hello/index.ts";
 *
 * export default defineMeekoConfig({ modules: [hello, [hello, { greeting: "Hi" }]] });
 * ```
 */
export interface MeekoModule<Options extends object = Record<string, unknown>> extends MeekoModuleDefinition<Options> {
  /** Marca de los módulos creados con `defineMeekoModule`. */
  readonly [moduleBrand]: true;
}

/**
 * Una entrada de `modules` en `meeko.config.ts`: un módulo importado, un nombre de paquete o una ruta
 * a un módulo, o `[módulo, opciones]`. Una ruta a una carpeta con `app/pages` y sin `index.ts` ni
 * `package.json` sigue funcionando como layer en `1.x`, con un aviso: muévala a `layers`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { MeekoModuleEntry } from "@meekojs/meeko/framework";
 *
 * const modules: MeekoModuleEntry[] = ["@acme/seo", ["./modules/hello", { greeting: "Hi" }]];
 * ```
 */
export type MeekoModuleEntry = string | MeekoModule<any> | readonly [string | MeekoModule<any>, object?];

/**
 * Declara un módulo de Meeko. El `setup` se ejecuta en Node al cargar la configuración (en
 * `meeko dev`, `meeko build`, `meeko check` y el servidor de lenguaje de confianza), nunca en el
 * navegador, y recibe las opciones combinadas: `defaults`, después `config[configKey]` y por último
 * las de `[module, options]` (los objetos planos se combinan en profundidad; los arrays se
 * sustituyen).
 *
 * @param definition `meta`, `defaults` y `setup`.
 * @returns El módulo, para exportarlo por defecto.
 * @throws {TypeError} Si falta `meta.name` o `setup`.
 * @since 1.2.0
 * @example
 * ```ts
 * // modules/hello/index.ts
 * import { defineMeekoModule } from "@meekojs/meeko/framework";
 *
 * export interface HelloOptions { greeting: string }
 *
 * export default defineMeekoModule<HelloOptions>({
 *   meta: { name: "hello", configKey: "hello", compatibility: { meeko: ">=1.2" } },
 *   defaults: { greeting: "Hola" },
 *   setup(options, meeko) {
 *     meeko.addComponentsDir(new URL("./components", import.meta.url), { prefix: "Hello" });
 *     meeko.addPlugin({ src: new URL("./runtime/greeting.ts", import.meta.url), options: { greeting: options.greeting } });
 *     meeko.addHead({ meta: [{ name: "generator", content: "Meeko" }] });
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#módulos
 */
export function defineMeekoModule<Options extends object = Record<string, unknown>>(definition: MeekoModuleDefinition<Options>): MeekoModule<Options> {
  if (!definition || typeof definition !== "object") throw new TypeError("defineMeekoModule requires a module definition");
  if (typeof definition.meta?.name !== "string" || !definition.meta.name) throw new TypeError("defineMeekoModule requires meta.name");
  if (typeof definition.setup !== "function") throw new TypeError(`Meeko module ${definition.meta.name} requires a setup function`);
  return Object.freeze({ ...definition, [moduleBrand]: true as const });
}

/** Whether `value` was created by `defineMeekoModule`. */
export function isMeekoModule(value: unknown): value is MeekoModule<object> {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[moduleBrand] === true;
}
