import type { RouteRecord } from '../app/runtime/router'
import type { DocumentHead } from '../shared/head'
import type { MeekoAdapterName, MeekoConfig } from './define-meeko-config'

/** Brand of the objects `defineMeekoModule` returns; `Symbol.for` so two copies of Meeko agree. */
export const moduleBrand: unique symbol = Symbol.for('meeko.module') as never

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
	readonly name: string
	/**
	 * Campo de `meeko.config.ts` con las opciones del módulo, como `"seo"` para `seo: { … }`. Es la
	 * única forma documentada de pasarle opciones desde `1.8`; para tiparla, el módulo amplía
	 * `MeekoConfig` (`declare module "@meekojs/meeko/framework" { interface MeekoConfig { … } }`) y
	 * Meeko carga esa ampliación sola en `.meeko/types/config.d.ts`. Dos módulos no pueden compartirla.
	 */
	readonly configKey?: string
	/**
	 * Rango de versiones de Meeko que admite, con la sintaxis de npm (`">=1.2"`, `"^1.2.0"`,
	 * `">=1.2 <2"`, `"1.x || 2.x"`). Fuera del rango, la carga de la configuración falla.
	 */
	readonly compatibility?: { readonly meeko?: string }
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
	readonly name: string
	/** Nombre con el que se usa sin import; por defecto, `name`. */
	readonly as?: string
	/**
	 * Origen: un especificador de paquete (`"@acme/theme/runtime"`), una ruta absoluta, una URL
	 * `file:` o una ruta relativa a la raíz del proyecto (`"../macros/shared/modules/theme/use-theme.ts"`).
	 */
	readonly from: string | URL
	/** `true` si sólo es un tipo; se importa con `import type`. */
	readonly type?: boolean
	/**
	 * Dónde se puede usar: `"app"` (componentes y `app/`, en el navegador y en SSR, el valor por
	 * defecto), `"client"` (sólo navegador), `"server"` (sólo servidor) o `"shared"` (en todas partes).
	 */
	readonly scope?: 'app' | 'client' | 'server' | 'shared'
	/** Sólo en componentes y módulos de app/ que también se ejecutan en el navegador; no en server/. */
	readonly componentOnly?: boolean
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
 *   src: new URL("../macros/shared/runtime/theme.client.ts", import.meta.url),
 *   mode: "client",
 *   options: { storageKey: "theme" },
 * };
 * ```
 */
export interface ModulePlugin {
	/** Archivo que exporta por defecto `definePlugin(...)`: ruta absoluta, URL `file:` o ruta relativa a la raíz del proyecto. */
	readonly src: string | URL
	/**
	 * Dónde se ejecuta: `"client"`, `"server"` o `"universal"` (ambos). Por defecto, el sufijo del
	 * archivo (`.client.ts`, `.server.ts`) o `"universal"`.
	 */
	readonly mode?: 'client' | 'server' | 'universal'
	/**
	 * Opciones serializables en JSON que recibe `setup` como segundo argumento. Las de un plugin
	 * `"client"` o `"universal"` llegan al navegador: no ponga secretos.
	 */
	readonly options?: unknown
}

/**
 * Opciones de `addPublicFile`.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { ModulePublicFileOptions } from "@meekojs/meeko/framework";
 *
 * const options: ModulePublicFileOptions = { headers: { "Access-Control-Allow-Origin": "*" } };
 * ```
 */
export interface ModulePublicFileOptions {
	/** Cabeceras de la respuesta del archivo. No admite `Content-Security-Policy`. */
	readonly headers?: Readonly<Record<string, string>>
}

/**
 * Handler HTTP de servidor que añade un módulo con `meeko.addServerHandler`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ModuleServerHandler } from "@meekojs/meeko/framework";
 *
 * const handler: ModuleServerHandler = { route: "/robots.txt", handler: new URL("../macros/shared/runtime/robots.ts", import.meta.url) };
 * ```
 */
export interface ModuleServerHandler {
	/** Ruta exacta (`pathname`) que atiende, como `"/sitemap.xml"`; empieza por `/`. */
	readonly route: string
	/**
	 * Archivo cuyo export por defecto es `(request: Request) => Response | Promise<Response>`: ruta
	 * absoluta, URL `file:` o ruta relativa a la raíz del proyecto. Se ejecuta sólo en el servidor,
	 * después del middleware de servidor.
	 */
	readonly handler: string | URL
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
	ready(): void | Promise<void>
	/**
	 * Meeko descubrió el manifiesto de rutas (aplicación, layers y módulos), con los archivos como
	 * rutas absolutas: antes del build cliente en `meeko build`, y al arrancar y en cada
	 * redescubrimiento en `meeko dev`.
	 */
	'routes:resolved'(context: { readonly routes: readonly RouteRecord[] }): void | Promise<void>
	/** Empieza `meeko build`; `output` es la carpeta absoluta del adaptador. */
	'build:before'(context: { readonly adapter: MeekoAdapterName; readonly output: string }): void | Promise<void>
	/** `meeko build` terminó, prerender incluido; un módulo puede añadir archivos a `output`. */
	'build:done'(context: { readonly adapter: MeekoAdapterName; readonly output: string }): void | Promise<void>
	/**
	 * URL que se van a prerenderizar (`pathname`). Un módulo puede añadir o quitar entradas; cada
	 * URL debe corresponder a una ruta de la aplicación.
	 */
	'prerender:routes'(context: { readonly urls: string[] }): void | Promise<void>
	/**
	 * URL que `meeko build` va a escribir en `sitemap.xml` (con la opción `sitemap`), ya ordenadas.
	 * Un módulo puede sustituir, añadir o quitar entradas; por ejemplo, añadir `alternates` para que
	 * cada URL declare sus versiones en otros idiomas.
	 * @since 1.8.0
	 */
	'sitemap:resolved'(context: { readonly urls: SitemapResolvedUrl[] }): void | Promise<void>
}

/**
 * Versión de una URL del sitemap en otro idioma: `meeko build` la escribe como
 * `<xhtml:link rel="alternate" hreflang="…" href="…">`, con el origen del sitio.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { SitemapAlternate } from "@meekojs/meeko/framework";
 *
 * const english: SitemapAlternate = { hreflang: "en", pathname: "/en/guide" };
 * ```
 */
export interface SitemapAlternate {
	/** Código de idioma BCP 47 (`"en"`, `"es-MX"`) o `"x-default"`. */
	readonly hreflang: string
	/** Ruta (`pathname`) de esa versión; empieza por `/`. */
	readonly pathname: string
}

/**
 * URL de `sitemap.xml` que reciben los módulos en el hook `sitemap:resolved`: su ruta, los campos
 * opcionales de sitemaps.org y sus versiones en otros idiomas.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { SitemapResolvedUrl } from "@meekojs/meeko/framework";
 *
 * const url: SitemapResolvedUrl = {
 *   pathname: "/guide",
 *   alternates: [{ hreflang: "es", pathname: "/guide" }, { hreflang: "en", pathname: "/en/guide" }],
 * };
 * ```
 */
export interface SitemapResolvedUrl {
	/** Ruta (`pathname`) de la URL; empieza por `/`. */
	readonly pathname: string
	/** `<lastmod>` en formato W3C Datetime. */
	readonly lastmod?: string
	/** `<changefreq>`. */
	readonly changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
	/** `<priority>`, de 0 a 1. */
	readonly priority?: number
	/** Versiones de la URL en otros idiomas, incluida ella misma, como recomiendan los buscadores. */
	readonly alternates?: readonly SitemapAlternate[]
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
	hook<Name extends keyof MeekoHooks>(name: Name, handler: MeekoHooks[Name]): () => void
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
 *     meeko.addPlugin({ src: new URL("../macros/shared/runtime/hello.client.ts", import.meta.url) });
 *   },
 * });
 * ```
 */
export interface MeekoModuleContext {
	/** Carpeta absoluta del proyecto. */
	readonly rootDir: string
	/** `true` durante `meeko dev`. */
	readonly dev: boolean
	/** Configuración de `meeko.config.ts`, tal como se cargó. */
	readonly config: Readonly<MeekoConfig>
	/** Hooks de build. */
	readonly hooks: MeekoHookable
	/**
	 * Añade una carpeta como layer, después de los de `layers`: sus `app/pages`, componentes,
	 * autoimports y `app/plugins`. Debe tener `app/pages` y estar dentro del proyecto (un paquete en
	 * `node_modules` lo está).
	 */
	addLayer(dir: string | URL): void
	/** Añade componentes al autoimport. `exclude` son globs relativos a esta carpeta; los imports explícitos siguen funcionando. */
	addComponentsDir(dir: string | URL, options?: { readonly prefix?: string; readonly exclude?: readonly string[] }): void
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
	addLayout(name: string, file: string | URL): void
	/**
	 * Transforma el manifiesto de rutas descubierto (aplicación, layers y módulos) antes de que lo
	 * usen el servidor, el navegador, el prerender, el sitemap y los tipos. La función recibe las
	 * rutas y devuelve la lista completa: puede añadir rutas que reutilizan el archivo de una página
	 * (por ejemplo, `/en/guide` con el archivo de `/guide`), cambiarlas o quitarlas. Las funciones se
	 * aplican en el orden de los módulos y el resultado se valida como un manifiesto: dos rutas con
	 * la misma forma de URL son un error.
	 *
	 * @param extend Recibe las rutas actuales y devuelve las nuevas.
	 * @since 1.8.0
	 * @example
	 * ```ts
	 * meeko.extendRoutes((routes) => [
	 *   ...routes,
	 *   ...routes.map((route) => ({ ...route, id: route.id === "/" ? "/en" : `/en${route.id}` })),
	 * ]);
	 * ```
	 */
	extendRoutes(extend: (routes: readonly RouteRecord[]) => readonly RouteRecord[]): void
	/** Añade autoimports de un paquete o archivo. */
	addAutoImports(entries: ModuleAutoImport | readonly ModuleAutoImport[]): void
	/**
	 * Añade al autoimport los exports de los archivos `.ts` de una carpeta, con el ámbito indicado.
	 * Los sufijos `.client.ts`, `.server.ts` y `.shared.ts` mandan sobre `scope`.
	 */
	addAutoImportsDir(dir: string | URL, options: { readonly scope: 'app' | 'server' | 'shared' }): void
	/** Añade un plugin de aplicación. Los de los módulos se ejecutan antes que los de `app/plugins`. */
	addPlugin(plugin: ModulePlugin | string | URL): void
	/**
	 * Añade un middleware de servidor, como un archivo de `server/middleware`. Los de los módulos se
	 * ejecutan antes que los del proyecto, en el orden en que se añaden.
	 */
	addServerMiddleware(file: string | URL): void
	/** Añade un handler HTTP para una ruta exacta. */
	addServerHandler(handler: ModuleServerHandler): void
	/**
	 * Añade un archivo público, como si estuviera en `public/`: `meeko build` lo escribe en la salida
	 * del cliente y `meeko dev` lo sirve. Una función se evalúa al escribirlo (en dev, en cada
	 * petición), por ejemplo con las rutas de `routes:resolved`. Desde `1.8`, `options.headers` añade
	 * cabeceras a su respuesta en `meeko dev` y en los adaptadores con servidor, como `server.headers`
	 * para esa ruta, que gana si fija la misma. El adaptador `static` no las escribe.
	 *
	 * @example
	 * ```ts
	 * // Una fuente que también puede usar un documento de origen opaco, como un <iframe sandbox srcdoc>.
	 * meeko.addPublicFile('_my-module/font.woff2', () => readFile(font), { headers: { 'Access-Control-Allow-Origin': '*' } })
	 * ```
	 */
	addPublicFile(path: string, contents: string | Uint8Array | (() => string | Uint8Array | Promise<string | Uint8Array>), options?: ModulePublicFileOptions): void
	/**
	 * Registers a CSS file in Vite's client graph, processed with the project's PostCSS config.
	 * Relative paths resolve from rootDir; use a file URL for a stylesheet shipped by a module.
	 * Files are deduplicated in registration order, before app/styles/main.css.
	 */
	addStylesheet(file: string | URL): void
	/** Registers a declaration in .meeko/types/modules; removed when the module is disabled. */
	addTypeTemplate(filename: string, contents: string): void
	/**
	 * Añade entradas al `<head>` de todos los documentos (`document.head`). Los arrays se concatenan
	 * en el orden de los módulos; `title` y `titleTemplate` se quedan con el último valor, y
	 * `document.head` de `meeko.config.ts` se aplica al final. Como en `document.head`,
	 * `titleTemplate` es una cadena y `title` es el título del sitio, que no pasa por la plantilla.
	 */
	addHead(input: DocumentHead): void
	/** Añade un plugin de Vite (u otro valor de `plugins`) a `meeko dev` y `meeko build`. */
	addVitePlugin(plugin: object | readonly object[]): void
	/**
	 * Modifica la configuración inline de Vite de `meeko dev` y de cada build de `meeko build` antes
	 * de usarla. La función recibe la configuración y puede cambiarla o devolver una nueva.
	 */
	extendViteConfig(extend: (config: Record<string, any>, context: { readonly command: 'serve' | 'build'; readonly ssr: boolean }) => void | Record<string, any>): void
	/** Escribe un aviso en la salida de errores con el nombre del módulo. */
	warn(message: string): void
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
	readonly meta: MeekoModuleMeta
	/** Valores por defecto de las opciones; `config[configKey]` (y las de `[module, options]`, obsoleto) los sustituyen. */
	readonly defaults?: Partial<Options>
	/** Configura el proyecto en Node con las opciones combinadas. Puede ser asíncrona. */
	setup(options: Options, meeko: MeekoModuleContext): void | Promise<void>
}

/**
 * Módulo de Meeko creado con {@link defineMeekoModule}: el export por defecto de un paquete (o de
 * su subpath `./module`) o de un archivo, que se lista por su nombre en `modules` de
 * `meeko.config.ts`.
 *
 * @typeParam Options Opciones del módulo.
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineMeekoConfig } from "@meekojs/meeko/framework";
 *
 * export default defineMeekoConfig({ modules: ["./modules/hello"], hello: { greeting: "Hi" } });
 * ```
 */
export interface MeekoModule<Options extends object = Record<string, unknown>> extends MeekoModuleDefinition<Options> {
	/** Marca de los módulos creados con `defineMeekoModule`. */
	readonly [moduleBrand]: true
}

/**
 * Nombres de los módulos de Meeko instalados en el proyecto, como claves. Meeko lo amplía en
 * `.meeko/types/config.d.ts` (lo generan `meeko dev`, `meeko check`, `meeko build` y el editor de
 * un workspace de confianza) con los paquetes de las dependencias que tienen la palabra clave
 * `meeko-module` en su `package.json` y con los módulos de `modules`, para que el editor complete
 * sus nombres dentro de `modules: ['…']`.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * declare module "@meekojs/meeko/framework" {
 *   interface MeekoModuleNames {
 *     "@acme/seo": true;
 *   }
 * }
 * ```
 */
export interface MeekoModuleNames {}

/**
 * Nombre de un módulo en `modules`: un paquete instalado (`"@meekojs/i18n"`) o una ruta a un módulo
 * del proyecto (`"./modules/hello"`). Los nombres de {@link MeekoModuleNames} se completan en el
 * editor; cualquier otra cadena sigue siendo válida.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { MeekoModuleName } from "@meekojs/meeko/framework";
 *
 * const names: MeekoModuleName[] = ["@meekojs/i18n", "./modules/hello"];
 * ```
 */
export type MeekoModuleName = Extract<keyof MeekoModuleNames, string> | (string & {})

/**
 * Una entrada de `modules` en `meeko.config.ts`. Desde `1.8`, la forma documentada es el nombre del
 * paquete o la ruta del módulo (`"@meekojs/i18n"`, `"./modules/hello"`), con sus opciones en la clave
 * de `meeko.config.ts` que declara su `meta.configKey`. Un módulo importado y `[módulo, opciones]`
 * están obsoletos desde `1.8` (aviso `MEEK126`): siguen funcionando en `1.x` y se retirarán en `2.0`.
 * Una ruta a una carpeta con `app/pages` y sin `index.ts` ni `package.json` sigue funcionando como
 * layer en `1.x`, con un aviso: muévala a `layers`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { MeekoModuleEntry } from "@meekojs/meeko/framework";
 *
 * const modules: MeekoModuleEntry[] = ["@meekojs/i18n", "./modules/hello"];
 * ```
 */
export type MeekoModuleEntry = MeekoModuleName | MeekoModule<any> | readonly [MeekoModuleName | MeekoModule<any>, object?]

/**
 * Declara un módulo de Meeko. El `setup` se ejecuta en Node al cargar la configuración (en
 * `meeko dev`, `meeko build`, `meeko check` y el servidor de lenguaje de confianza), nunca en el
 * navegador, y recibe las opciones combinadas: `defaults` y después `config[configKey]` (y por
 * último las de `[module, options]`, obsoleto desde `1.8`; los objetos planos se combinan en
 * profundidad y los arrays se sustituyen). Un paquete lo exporta por defecto en su subpath
 * `./module` o en su raíz; el proyecto lo registra con `modules: ["paquete"]`.
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
 * declare module "@meekojs/meeko/framework" {
 *   interface MeekoConfig { readonly hello?: Partial<HelloOptions> }
 * }
 *
 * export default defineMeekoModule<HelloOptions>({
 *   meta: { name: "hello", configKey: "hello", compatibility: { meeko: ">=1.2" } },
 *   defaults: { greeting: "Hola" },
 *   setup(options, meeko) {
 *     meeko.addComponentsDir(new URL("./components", import.meta.url), { prefix: "Hello" });
 *     meeko.addPlugin({ src: new URL("../macros/shared/runtime/greeting.ts", import.meta.url), options: { greeting: options.greeting } });
 *     meeko.addHead({ meta: [{ name: "generator", content: "Meeko" }] });
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#módulos
 */
export function defineMeekoModule<Options extends object = Record<string, unknown>>(definition: MeekoModuleDefinition<Options>): MeekoModule<Options> {
	if (!definition || typeof definition !== 'object') throw new TypeError('defineMeekoModule requires a module definition')
	if (typeof definition.meta?.name !== 'string' || !definition.meta.name) throw new TypeError('defineMeekoModule requires meta.name')
	if (typeof definition.setup !== 'function') throw new TypeError(`Meeko module ${definition.meta.name} requires a setup function`)
	return Object.freeze({ ...definition, [moduleBrand]: true as const })
}

/** Whether `value` was created by `defineMeekoModule`. */
export function isMeekoModule(value: unknown): value is MeekoModule<object> {
	return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[moduleBrand] === true
}
