# Meeko como framework full-stack

Meeko conserva el motor independiente en `@meekojs/meeko`. El modo de aplicación usa `@meekojs/meeko/framework` y Vite usa `@meekojs/meeko/vite`. El servidor se reparte en estas subrutas:

- `@meekojs/meeko/server`: núcleo portable de la aplicación (`createServerApp`, `defineServerRuntime`, contratos API/RPC, sesiones, middleware, Socket, `createSocketUpgradeHandler` y OpenAPI). Sólo usa Web APIs y `node:async_hooks`; no carga TypeScript, Vite, `ws` ni el sistema de archivos.
- `@meekojs/meeko/node`: adaptador Node (`serveNode`, `toNodeListener`, `createNodeAssetReader`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler`).
- `@meekojs/meeko/password` (desde `1.2`): `hashPassword`, `verifyPassword` y `needsRehash` con scrypt; necesita `node:crypto`, así que sirve en Node, Bun y Deno, no en Workers (véase [Contraseñas](#contraseñas)).
- `@meekojs/meeko/bun`: adaptador Bun (`createBunServer` y `createBunAssetReader`).
- `@meekojs/meeko/deno`: adaptador Deno (`serveDeno` y `createDenoAssetReader`).
- `@meekojs/meeko/cloudflare`: adaptador Cloudflare Workers (`createWorker`, `createSocketRoomClass`, `DurableObjectSocketPubSub`, `D1SessionDriver`, `createCloudflareAssetReader` y `createCloudflarePrerenderSource`).
- `@meekojs/meeko/build`: herramientas de build que leen el sistema de archivos y cargan TypeScript (`discoverRoutes`, `discoverErrorPage`, `discoverConfiguredRoutes`, `composeFrameworkRoutes`, `loadMeekoConfig`, `readMeekoConfigSync`, `resolveConfigSources`, `discoverServerManifest`, `prerenderRoutes`, `prerenderProject` y `buildProject`). El servidor de producción no la importa.

Todas las subrutas pertenecen al mismo paquete y versión. Los destinos de servidor publicados son Node 24, Bun, Deno y Cloudflare Workers, y la misma suite de conformidad los comprueba (véase [Build, despliegue y verificación](#build-despliegue-y-verificación)). El build y las herramientas de desarrollo siguen ejecutándose con Node. SSR está activo por defecto.

La aplicación generada necesita Node 24 o posterior y TypeScript 7 para comprobar sus declaraciones; el compilador de `.meeko` utiliza internamente TypeScript 6 sólo durante el desarrollo y el build. El paquete es ESM. `vite` es un peer opcional: una aplicación que sólo usa el motor puede importar `@meekojs/meeko` sin iniciar el framework, el servidor, sesiones o Socket. El adaptador Node carga `ws` al activar `attachNodeWebSocketServer`, no al importar el motor.

## Crear una aplicación

```sh
meeko init-framework my-app
cd my-app
npm install
npm run dev
```

El starter crea `meeko.config.ts`, `app/app.meeko`, `app/pages`, `app/styles/main.css`, un layout con outlet y un `.env.example` con las variables de Meeko; no necesita `server/runtime.ts`, porque las sesiones funcionan sin configuración (véase [Autenticación](#autenticación)). Meeko genera las entradas cliente/servidor y sus configuraciones de build bajo `.meeko/`; el consumidor ejecuta `meeko dev`, `meeko check`, `meeko build` y `meeko start` mediante los scripts de `package.json`; `meeko preview` ejecuta también el build. La aplicación puede organizarse así:

```text
app/{pages,layouts,middleware,components,composables,utils,stores,styles}/
server/{api,rpc,socket,middleware,utils}/
shared/{types,schemas,utils,constants,enums}/
layers/base/app/pages/
modules/auth/app/pages/
public/
meeko.config.ts
tsconfig.json
.meeko/{types,manifests,generated,output}/
```

Meeko genera entradas Vite y configuraciones TypeScript por ámbito sólo bajo `.meeko/`. El único `tsconfig.json` raíz conecta VS Code con esos proyectos generados para conservar diagnósticos y autocompletado en archivos `.ts`. `server/runtime.ts`, opcional, es código de la aplicación: declara servicios, política de Socket y, si no bastan las de Meeko, sus propias sesiones. El starter del motor aislado continúa disponible con `meeko init <directory>`.

### Migrar un starter full-stack anterior

Una aplicación generada con `0.0.4` puede adoptar el host de proyecto actual sin mantener entradas manuales. Cambie sus scripts a `meeko dev`, `meeko check`, `meeko build` y `meeko start`; ejecute primero el nuevo build y compare cualquier personalización propia. Después puede retirar `server.mjs`, las entradas cliente/servidor, las configuraciones Vite y los `tsconfig.*` por ámbito que Meeko genera ahora bajo `.meeko/`. El `tsconfig.json` raíz sí permanece como enlace para el editor.

Si desea la convención actual de layouts, mueva el layout raíz a `app/layouts/default.meeko`. No conserve simultáneamente ese archivo y `app/pages/+layout.meeko`, porque ambos representarían el mismo nivel del árbol. Traslade las personalizaciones representables a middleware, handlers y convenciones públicas soportadas. Si una personalización del host o de Vite no tiene todavía una API pública equivalente, conserve el host manual; la migración no debe borrar ni atribuir a `meeko.config.ts` capacidades que no ofrece.

### Migrar `server/session.ts` a `server/runtime.ts`

Meeko ya no carga `server/session.ts`. Si el archivo existe, `meeko check`, `meeko dev` y `meeko build` se detienen con las instrucciones de migración en lugar de ignorarlo. Traslade el `SessionManager` que devolvía `createSessionManager(production)` al export por defecto de `server/runtime.ts` y elimine `server/session.ts`:

```ts
// Antes: server/session.ts
export function createSessionManager(production: boolean) {
  return new SessionManager({ store: createStore(production), production });
}

// Después: server/runtime.ts
import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production, prerendering }) => ({
  sessions: new SessionManager({ store: createStore(production && !prerendering), production: production && !prerendering }),
  services: (request) => ({ /* servicios por petición */ }),
}));
```

`meeko build` crea el runtime con `prerendering: true` para renderizar las rutas `render: "prerender"`; durante esa fase no se sirve tráfico de clientes, por lo que la aplicación puede usar un store en memoria en lugar de abrir la base de producción. Las aplicaciones que importaban herramientas de build desde `@meekojs/meeko/server` deben importarlas desde `@meekojs/meeko/build` (`discoverRoutes`, `discoverServerManifest`, `loadMeekoConfig`, `prerenderProject`…), y `toNodeListener`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler` desde `@meekojs/meeko/node`. `createServerDispatcher`, `createLocalCalls`, `generateOpenApi` y `loadSocketChannels` exigen ahora un cargador explícito, por ejemplo `(file) => import(pathToFileURL(file).href)` en Node.

`app/styles/main.css` es opcional y se carga automáticamente como hoja global en desarrollo y en el build. Vite la incluye en el asset CSS de producción; Meeko enlaza ese asset en el HTML SSR y prerenderizado. Los bloques `<style>` de `.meeko` siguen disponibles para estilos locales.

**PostCSS y Tailwind.** Vite procesa con PostCSS tanto `app/styles/main.css` como los `<style>` de los componentes, con el `postcss.config.*` de la raíz del proyecto. Para Tailwind 4, instale `tailwindcss` y `@tailwindcss/postcss`, declare el plugin y cargue Tailwind en la hoja global; Tailwind lee las clases de los `.meeko`:

```js
// postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```

```css
/* app/styles/main.css */
@import "tailwindcss";
```

En un `<style scoped>`, `@apply` necesita `@reference "tailwindcss";` (o la ruta de la hoja con su tema) al principio del bloque. Desde `1.2`, el CSS de cada componente es el módulo `Componente.meeko?meeko-style=…&lang.css`, junto a su archivo, así que los plugins de PostCSS resuelven `@reference` y los `@import` relativos desde la carpeta del componente.

En desarrollo, Vite abre un WebSocket HMR en un puerto derivado del puerto HTTP para que dos aplicaciones Meeko no compitan por el puerto predeterminado de Vite. `MEEKO_HMR_PORT` permite fijarlo explícitamente cuando el entorno lo exige; el navegador debe poder acceder a ese puerto además del HTTP de la aplicación.

**Variables de entorno y `.env`.** Desde `1.2`, `meeko dev`, `build`, `start`, `preview` y `check` cargan el `.env` de la raíz del proyecto en `process.env`, como Vite y Nuxt en desarrollo. Una variable que el entorno ya define tiene prioridad, así que el entorno real de un despliegue nunca se sustituye. La salida de `meeko build` ejecutada directamente (`node .meeko/output/node/index.mjs`, un contenedor) no lee `.env`: en producción las variables llegan del entorno. Cambiar `.env` exige reiniciar `meeko dev`. Meeko lee estas variables:

| Variable | Comandos | Efecto |
| --- | --- | --- |
| `MEEKO_PORT`, `MEEKO_HOST` | `dev`, `start`, `preview` y la salida de Node, Bun y Deno | Puerto y dirección; sustituyen a `server.port` y `server.host`. Por defecto, `127.0.0.1:4173`. Sin `MEEKO_PORT` se lee `PORT`, que inyectan plataformas como Coolify, Railway o Cloud Run. |
| `MEEKO_PUBLIC_ORIGIN` | `dev`, `start`, `preview` y la salida de Node, Bun, Deno y Workers | Origen público tras un proxy HTTPS, para las comprobaciones de `Origin` de HTTP y Socket. |
| `MEEKO_REDIS_URL` | La salida de Node, Bun y Deno | Redis de las sesiones en producción cuando `server/runtime.ts` no declara `sessions`; véase [Sesiones sin configuración](#sesiones-sin-configuración). |
| `MEEKO_REDIS_PREFIX` | Ídem | Prefijo de sus claves; por defecto, `meeko:<name de package.json>:prod:`. |
| `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` | `dev` y producción | Duración (`12h`, `7d`…; 7 días por defecto) y `SameSite` (`Lax` por defecto, o `Strict`) de esas sesiones. |
| `MEEKO_TRUST_PROXY` | `dev` y producción | Proxies de confianza delante del servidor (un número, o `true` para todos), cuyas entradas de `X-Forwarded-For` dan la IP del cliente; véase [Límite de peticiones](#límite-de-peticiones-ratelimit). Sin ella, `X-Forwarded-For` nunca se lee. |
| `MEEKO_HMR_PORT` | `dev` | Puerto del WebSocket de HMR; sin él, se deriva del puerto HTTP. |
| `MEEKO_EDITOR_BRIDGE=0` | `dev` | Desactiva el puente con el editor (valores en vivo). |
| `MEEKO_LINK_WATCH=0` | `dev` | No reinicia `meeko dev` al reconstruir un `@meekojs/meeko` enlazado. |

Desde `1.2`, todas las variables que lee Meeko empiezan por `MEEKO_`; el prefijo queda reservado para Meeko, así que las variables propias de la aplicación deben usar otro nombre. `HOST` y `PUBLIC_ORIGIN`, los nombres anteriores, siguen funcionando durante 1.x cuando falta la variable nueva, con un aviso por proceso que nombra su reemplazo, y dejarán de leerse en `2.0`. `PORT` no está obsoleta: es el respaldo permanente de `MEEKO_PORT`.

Si ni `MEEKO_PORT` (o `PORT`) ni `server.port` fijan el puerto, `meeko dev` usa el primero libre a partir de `4173` (hasta `4192`), como Vite: con otro `meeko dev` ya en `4173`, el segundo escribe `[meeko] El puerto 4173 está en uso; meeko dev usa el 4174` y la URL real, y deriva de ese puerto el del WebSocket HMR y el descriptor del puente con el editor (`.meeko/dev/editor-bridge-4174.json`). Un puerto fijado con `MEEKO_PORT`, `PORT` o `server.port` no cambia: si está ocupado, `meeko dev` termina con `El puerto 4173 de 127.0.0.1 ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev`.

El SSR de desarrollo carga `@meekojs/meeko` desde Node, fuera del module runner de Vite, como el build; así una aplicación que consume Meeko con `link:` mantiene una sola instancia del runtime aunque Vite recargue sus módulos. Por eso, cuando `@meekojs/meeko` está enlazado (`link:` de pnpm, `npm link` o un workspace: el paquete se resuelve fuera de todo `node_modules`), `meeko dev` ejecuta el servidor en un proceso hijo y vigila `dist/` y `package.json` del paquete enlazado. Al reconstruirlo, espera a que la compilación termine (400 ms sin cambios), escribe `[meeko] Meeko enlazado cambió; reiniciando meeko dev…`, cierra el servidor anterior (Socket, HTTP, Vite y el descriptor del puente con el editor) y arranca otro proceso en el mismo puerto, con el mismo entorno. Si el nuevo proceso no arranca, por ejemplo porque la compilación quedó a medias, lo informa y vuelve a intentarlo con el siguiente cambio. `Ctrl+C` detiene ambos procesos. Con una instalación normal desde el registro no se vigila nada más; `MEEKO_LINK_WATCH=0` desactiva el reinicio también con un paquete enlazado.

## Configuración

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";
import seo from "@acme/meeko-seo";

export default defineMeekoConfig({
  layers: ["./layers/base"],
  modules: [[seo, { siteUrl: "https://example.com" }], "./modules/hello"],
  imports: { serverDirs: ["server/services", "server/repositories"] },
  document: { lang: "es", head: { meta: [{ name: "theme-color", content: "#0f172a" }] } },
});
```

`meeko.config.ts` (o `.mts`, `.js`, `.mjs`) se carga con Node y exporta un objeto creado con `defineMeekoConfig`:

- `layers` (desde `1.2`): carpetas que aportan páginas, componentes, autoimports y plugins; véase [Layers](#layers). `extends`, el nombre anterior, sigue funcionando como alias.
- `modules`: módulos creados con `defineMeekoModule`, que configuran el proyecto desde código; véase [Módulos](#módulos).
- `imports.serverDirs`: directorios de autoimports exclusivos del servidor, dentro de `server/`.
- `server`: el adaptador de `meeko build`; véase [Build, despliegue y verificación](#build-despliegue-y-verificación).
- `document` (desde `1.2`): `lang` y las entradas de `<head>` de todos los documentos. Los módulos añaden las suyas con `meeko.addHead`; las de `document.head` se aplican después, así que el `title` del proyecto gana.

Desde `1.2`, `css: { scopeAttribute: "matched" }` limita el atributo de `<style scoped>` a los elementos que algún selector con ámbito puede seleccionar; con `"all"`, el valor por defecto en `1.x`, va en todos los elementos de la plantilla. `"matched"` pasará a ser el valor por defecto en `2.0`. Véase [Estilos con ámbito](api.md#qué-elementos-reciben-el-atributo), con el caso de las clases que el script añade con la API del DOM.

La configuración se ejecuta en `meeko dev`, `meeko build` y `meeko check`. En un workspace de confianza el servidor de lenguaje también la ejecuta, con sus módulos, por lo que las listas pueden construirse dinámicamente; en un workspace no confiable (o con `trusted: false`, ver [editores](editors.md)) el editor no ejecuta código del proyecto: lee `layers`, `extends` e `imports.serverDirs` como arrays literales de cadenas y, de `modules`, sólo las cadenas literales que son carpetas de layer. Los autoimports y componentes de los módulos no existen para ese editor hasta que se confía en el workspace.

El descubrimiento de servidor también rechaza árboles de cliente imposibles. Por ejemplo, no permite que `api.users.get()` sea a la vez una función y el padre de `api.users.get.post()`, ni que un procedimiento `rpc.users()` sea el padre de `rpc.users.get()`. El error se produce al generar el manifiesto e identifica ambos archivos, antes de inicializar el cliente o emitir tipos contradictorios.

`meeko routes .` descubre todas las fuentes, emite `.meeko/manifests/routes.json` y declaraciones de rutas, contratos y autoimports. Vite genera módulos virtuales a partir del mismo descubrimiento para SSR, hidratación y navegación. En desarrollo, editar una página o layout existente actualiza el módulo SSR y recarga el navegador; el servidor conserva el almacén de sesiones. Los sidecars y handlers API/RPC existentes se cargan desde Vite al llamarlos.

Al crear o eliminar una página, un layout, `app/app.meeko`, `app/error.meeko`, un middleware de `app/middleware` o `server/middleware`, un plugin de `app/plugins`, o un módulo de `server/api`, `server/rpc` o `server/socket`, en el proyecto o en sus layers, `meeko dev` vuelve a descubrir las rutas y crea de nuevo la aplicación sin reiniciar el proceso:

- Las peticiones que llegan mientras tanto esperan a la aplicación nueva, y el navegador se recarga.
- El servidor Socket se vuelve a enganchar a la aplicación nueva; las conexiones abiertas se cierran.
- La aplicación nueva llama otra vez a `server/runtime.ts`, así que un almacén de sesiones en memoria empieza vacío y las sesiones abiertas se pierden.
- Si la aplicación nueva no se puede crear (por ejemplo, con dos layouts raíz), Meeko registra el error y sigue sirviendo la anterior hasta que se corrija.

Cuando Vite se reinicia (al cambiar un `.env` o una dependencia de su configuración), `meeko dev` también crea de nuevo la aplicación, con las mismas consecuencias, una vez que el servidor de Vite nuevo está listo. Si coincide con la creación o eliminación de una ruta, crea una sola aplicación.

Editar un canal Socket existente, cambiar `meeko.config.ts` o editar el código de `setup` de un módulo sigue exigiendo reiniciar `npm run dev` (los archivos de runtime de un módulo, como sus plugins o componentes, se recargan como los del proyecto). Los tipos y manifiestos de `.meeko/` no se regeneran en `meeko dev`: ejecute `npm run check` para actualizarlos.

El observador de archivos de Vite ignora todo `.meeko/` salvo `.meeko/generated`, las entradas que sirve. Así, `meeko check`, el servidor de lenguaje o un build que escriben en `.meeko/check`, `routes`, `types`, `manifests`, `output`, `build` o en los `tsconfig.*` generados mientras corre `meeko dev` no recargan el navegador, y el escaneo de dependencias de Vite tampoco entra en `.meeko/`.

El `href` tipado no admite `params` en rutas sin parámetros. Para rutas dinámicas exige las claves declaradas en el manifiesto; el runtime comprueba además sus valores y rechaza claves extra.

`href` tiene dos formas con los mismos tipos. `href(id, options)` usa el manifiesto de la aplicación en ejecución: en el servidor, el de la petición en curso (SSR, loaders, `head`, prerender, API, RPC y middleware de servidor); en el navegador, el que recibió `mountClientApp`, desde la hidratación hasta `dispose()`. Es la forma habitual en páginas y layouts:

```ts
const link = href("/users/[id]", { params: { id: user.id }, search: { tab: "profile" } });
```

Fuera de una aplicación (por ejemplo, en una prueba unitaria sin app) la forma corta lanza un error; ahí se pasa el manifiesto con `href(routes, id, options)`, que se mantiene igual.

## Layers

Un layer es una carpeta del proyecto con la misma estructura que la aplicación: su `app/pages`, sus componentes y autoimports (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`, `shared/` y `server/utils`) y, desde `1.2`, sus plugins de `app/plugins`. Use layers para una base compartida (diseño, páginas comunes) o para dividir una aplicación grande por áreas.

```ts
export default defineMeekoConfig({
  layers: ["./layers/base", "./layers/admin"],
});
```

El orden de las fuentes es: la aplicación, `extends`, `layers`, las carpetas de layer que quedan en `modules` (véase más abajo) y los layers que añaden los módulos con `meeko.addLayer`. Cada layer necesita su carpeta `app/pages` y un nombre de carpeta en minúsculas, dígitos y guiones que no se repita; aparece con ese nombre en los diagnósticos. Las rutas de `layers` y `extends` deben vivir dentro del proyecto, también después de resolver los enlaces.

Las páginas de un layer se muestran dentro del shell del proyecto: `app/app.meeko` y el layout raíz de la aplicación (`app/layouts/default.meeko` o `app/pages/+layout.meeko`) envuelven también a las páginas de los layers, y los `+layout.meeko` propios del layer se anidan dentro. Si el proyecto tiene `app.meeko` o layout raíz, sustituyen a los equivalentes del layer; si no, se usan los del layer. Una página de layer que falla usa el `+error.meeko` más cercano de su propio árbol, después el `app/error.meeko` del layer y, por último, la página de error raíz del proyecto. La `404` de una URL sin ruta siempre usa la del proyecto. Los módulos de rutas programáticos (`RouteModule.routes()` de `composeFrameworkRoutes`) siguen declarando sus propios layouts. El manifiesto rechaza colisiones de URL y el registro rechaza nombres de autoimport repetidos; el diagnóstico incluye los archivos en conflicto.

`extends` es el nombre que tenía `layers` hasta `1.1` y sigue funcionando en `1.x`, sin aviso; sus carpetas van antes que las de `layers`.

### Carpetas en `modules` (deprecado)

Hasta `1.1`, `modules` también listaba carpetas con `app/pages`, que se comportaban como layers. Desde `1.2`, `modules` es para [módulos](#módulos). Una cadena de `modules` que apunta a una carpeta con `app/pages` y sin módulo (sin `package.json` ni `index.ts`) sigue funcionando como layer durante toda la serie `1.x`, en la misma posición que antes. `meeko dev`, `meeko build` y `meeko check` escriben una vez por proceso:

```text
[meeko] Aviso: "./modules/auth" en modules de meeko.config.ts es una carpeta de layer (tiene app/pages y no es un módulo). Muévela a layers: ["./modules/auth"]; las carpetas en modules dejarán de funcionar en Meeko 2.0.
```

Para migrar, mueva la cadena de `modules` a `layers`. Una carpeta de layer no admite opciones: `["./modules/auth", { … }]` es un error.

## Módulos

Un módulo configura el proyecto desde código, como los módulos de Nuxt: añade componentes, autoimports, plugins, middleware y handlers de servidor, entradas de `<head>`, archivos públicos y plugins de Vite, y reacciona a los hooks del build. Se crea con `defineMeekoModule` y se lista en `modules`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";
import hello from "./modules/hello/index.ts";

export default defineMeekoConfig({
  modules: [
    hello,                                  // un módulo importado
    "@acme/meeko-seo",                      // un paquete, resuelto desde el proyecto
    ["./modules/theme", { initial: "dark" }], // una ruta y opciones en línea
  ],
  hello: { greeting: "Hola" },              // opciones en la clave del módulo (meta.configKey)
});
```

Una cadena es un nombre de paquete (con o sin subruta) o una ruta relativa al proyecto: un archivo, o una carpeta con `package.json` (su export `import`/`default`) o con `index.ts`, `index.mts`, `index.js` o `index.mjs`. El export por defecto debe ser el resultado de `defineMeekoModule`. Las opciones se combinan así: `defaults` del módulo, después `config[meta.configKey]` y por último las de `[módulo, opciones]`; los objetos planos se combinan en profundidad y los arrays se sustituyen. Dos módulos con el mismo `meta.name` son un error. Con `meta.compatibility.meeko` (un rango de npm, como `">=1.2"` o `"^1.2.0"`), la carga falla si la versión de Meeko queda fuera.

### Escribir un módulo

El `setup` se ejecuta en Node, una vez por configuración y proceso, al cargar la configuración: en `meeko dev`, `meeko build`, `meeko check` y en el servidor de lenguaje de un workspace de confianza. Nunca llega al navegador. Recibe las opciones combinadas y el objeto `meeko`. Las rutas que recibe `meeko` pueden ser absolutas, URL `file:` (`new URL("./x", import.meta.url)`, lo habitual en un paquete) o relativas a la raíz del proyecto.

```ts
// modules/theme/index.ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export interface ThemeOptions {
  initial: "light" | "dark";
  storageKey: string;
}

// Tipa la clave `theme` de meeko.config.ts.
declare module "@meekojs/meeko/framework" {
  interface MeekoConfig {
    readonly theme?: Partial<ThemeOptions>;
  }
}

export default defineMeekoModule<ThemeOptions>({
  meta: { name: "@acme/meeko-theme", configKey: "theme", compatibility: { meeko: ">=1.2" } },
  defaults: { initial: "light", storageKey: "theme" },
  setup(options, meeko) {
    const here = (path: string) => new URL(path, import.meta.url);
    // <ThemeToggle /> en cualquier componente, sin import.
    meeko.addComponentsDir(here("./components"), { prefix: "Theme" });
    // useTheme() sin import, en componentes y en app/.
    meeko.addAutoImports({ name: "useTheme", from: here("./runtime/use-theme.ts") });
    // Publica la señal del tema antes de hidratar; las opciones llegan al plugin.
    meeko.addPlugin({ src: here("./runtime/theme.plugin.ts"), options: { initial: options.initial, storageKey: options.storageKey } });
    // Aplica el tema guardado antes de pintar, sin parpadeo.
    meeko.addHead({
      script: [{ key: "theme", children: `document.documentElement.dataset.theme = localStorage.getItem(${JSON.stringify(options.storageKey)}) ?? ${JSON.stringify(options.initial)};` }],
    });
  },
});
```

```ts
// modules/theme/runtime/use-theme.ts
import { createContext, inject } from "@meekojs/meeko";
import type { Signal } from "@meekojs/meeko";

export const themeKey = createContext<Signal<"light" | "dark">>("theme");

export function useTheme(): Signal<"light" | "dark"> {
  return inject(themeKey);
}
```

```ts
// modules/theme/runtime/theme.plugin.ts
import { effect, signal } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";
import { themeKey } from "./use-theme.ts";

export default definePlugin<{ initial: "light" | "dark"; storageKey: string }>((app, options) => {
  // El mismo valor inicial en el servidor y en el navegador, para que la hidratación coincida.
  const theme = signal(options.initial);
  app.provide(themeKey, theme);
  if (app.side === "client") {
    let first = true;
    effect(() => {
      const value = theme.value;
      // El script de <head> ya aplicó el tema guardado; después, cada cambio se aplica y se guarda.
      if (first) { first = false; return; }
      document.documentElement.dataset.theme = value;
      localStorage.setItem(options.storageKey, value);
    });
  }
});
```

Un módulo de SEO genera `sitemap.xml` a partir de las rutas y `robots.txt`:

```ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export default defineMeekoModule<{ siteUrl: string }>({
  meta: { name: "@acme/meeko-seo", configKey: "seo" },
  setup(options, meeko) {
    let routes: readonly { id: string }[] = [];
    meeko.hooks.hook("routes:resolved", (context) => { routes = context.routes; });
    meeko.addPublicFile("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${options.siteUrl}/sitemap.xml\n`);
    // Una función se evalúa al escribir el build (y en cada petición en dev), con las rutas ya descubiertas.
    meeko.addPublicFile("sitemap.xml", () => [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...routes.filter((route) => !route.id.includes("[")).map((route) => `<url><loc>${options.siteUrl}${route.id}</loc></url>`),
      "</urlset>",
    ].join("\n"));
  },
});
```

Los archivos de runtime de un módulo (plugins, componentes, autoimports, middleware y handlers) los procesa Vite como los del proyecto, pero fuera de las carpetas de la aplicación no reciben autoimports: impórtelos de forma explícita. Los componentes `.meeko` de `addComponentsDir` sí reciben los autoimports del proyecto.

### El objeto `meeko`

| Miembro | Qué hace |
| --- | --- |
| `rootDir`, `dev`, `config` | Carpeta del proyecto, `true` en `meeko dev` y la configuración cargada. |
| `addLayer(dir)` | Añade un layer, después de los de `layers`. Debe tener `app/pages` y estar dentro del proyecto; un paquete instalado en `node_modules` lo está, también con pnpm. |
| `addComponentsDir(dir, { prefix })` | Autoimporta los `.meeko` de la carpeta y sus subcarpetas, con el nombre en PascalCase tras el prefijo (`components/toggle.meeko` con `prefix: "Theme"` es `ThemeToggle`). |
| `addAutoImports(entries)` | Autoimporta exports de un paquete o archivo: `{ name, as?, from, type?, scope? }`; `scope` es `"app"` por defecto (componentes y `app/`, en el navegador y en SSR), `"client"`, `"server"` o `"shared"`. |
| `addAutoImportsDir(dir, { scope })` | Autoimporta los exports de los `.ts` de una carpeta, con ámbito `"app"`, `"server"` o `"shared"`; los sufijos `.client.ts`, `.server.ts` y `.shared.ts` mandan. |
| `addPlugin({ src, mode?, options? })` | Añade un [plugin de aplicación](#plugins-de-aplicación). `mode` sale del sufijo del archivo o es `"universal"`. `options` debe ser JSON y llega al navegador si el plugin se ejecuta allí. |
| `addServerMiddleware(file)` | Añade un middleware como los de `server/middleware`; los de los módulos van antes que los del proyecto. |
| `addServerHandler({ route, handler })` | Atiende una ruta exacta con el export por defecto de `handler`, `(request) => Response`, después del middleware de servidor. |
| `addPublicFile(path, contents)` | Añade un archivo público. `meeko build` lo escribe en la salida del cliente, antes de calcular el manifiesto de assets; `meeko dev` lo sirve. Choca con un archivo de `public/` del mismo nombre. |
| `addHead(input)` | Añade entradas a `document.head`: `meta`, `link`, `script` y `style` se concatenan en el orden de los módulos; `title`, `titleTemplate`, `htmlAttrs` y `bodyAttrs` se quedan con el último valor; `document.head` del proyecto se aplica al final. Recibe un `DocumentHead`: `titleTemplate` es una cadena y `title` es el título del sitio, sin plantilla. |
| `addVitePlugin(plugin)` | Añade un plugin de Vite a `meeko dev` y a cada build de `meeko build`, después del de Meeko. |
| `extendViteConfig(fn)` | Modifica la configuración inline de Vite de cada paso; `fn(config, { command, ssr })` cambia el objeto o devuelve otro. |
| `hooks.hook(name, fn)` | Registra un [hook](#hooks). |
| `warn(message)` | Escribe un aviso con el nombre del módulo. |

Un host de Vite propio que sólo usa el plugin `meeko()` recibe los autoimports, componentes, layers y plugins de aplicación de los módulos, pero no sus `addVitePlugin`, `extendViteConfig`, archivos públicos ni hooks: esos los aplican `meeko dev` y `meeko build`.

Meeko no tiene un `runtimeConfig` aparte: un módulo pasa valores a su runtime con las `options` de `addPlugin` (públicas si el plugin llega al navegador), y los secretos se leen en el servidor de las variables de entorno o de `server/runtime.ts`.

### Hooks

| Hook | Cuándo | Contexto |
| --- | --- | --- |
| `ready` | Todos los módulos terminaron su `setup`. | — |
| `routes:resolved` | Antes del build del cliente en `meeko build`; al arrancar y en cada redescubrimiento en `meeko dev`. | `{ routes }`, el manifiesto con rutas de archivo absolutas. |
| `build:before` | Al empezar `meeko build`. | `{ adapter, output }`, la carpeta absoluta del adaptador. |
| `prerender:routes` | Antes de prerenderizar, en `meeko build` y `meeko prerender`. | `{ urls }`: los `pathname` que se van a prerenderizar; el hook puede añadir o quitar entradas, que deben corresponder a una ruta. |
| `build:done` | Al terminar `meeko build`, prerender incluido. | `{ adapter, output }`; el módulo puede escribir más archivos en `output`. |

Los hooks se ejecutan en el orden en que se registraron y Meeko espera a cada uno. `hook()` devuelve una función que lo quita.

### Plugins de aplicación

Los archivos de `app/plugins` (de la aplicación y de sus layers) y los que añaden los módulos se ejecutan al arrancar la aplicación. Cada uno exporta por defecto `definePlugin`:

```ts
// app/plugins/analytics.client.ts
import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin((app) => {
  effect(() => navigator.sendBeacon("/api/visits", app.route.path.value));
  app.onError((error, info) => console.error("[app]", info.side, error));
});
```

- **Dónde.** `*.client.ts` sólo en el navegador, una vez, antes de la hidratación. `*.server.ts` sólo en el servidor, una vez por petición de página, antes del render (también al prerenderizar; no en las páginas ya prerenderizadas, ni en API, RPC o handlers). Un `.ts` sin sufijo, en los dos. Sólo cuentan los archivos que están directamente en `app/plugins`; las subcarpetas pueden guardar sus auxiliares. Se excluyen `*.test.ts`, `*.spec.ts` y `*.d.ts`.
- **Orden.** Los de los módulos, en el orden en que los añaden; después los de cada layer y los de la aplicación, por nombre de archivo. Meeko espera a cada `setup`, que puede ser asíncrono.
- **`app.provide(key, value)`.** Publica un valor para todos los componentes de la aplicación, que lo leen con `inject(key)` (y el composable que lo envuelva): las páginas, layouts, `app.meeko`, la página de error y las páginas a las que se navega en el navegador. En el servidor el valor es de esa petición: no comparta estado mutable entre peticiones. Un componente que se hidrata debe recibir el mismo valor en el servidor y en el navegador; por eso los valores que se renderizan suelen venir de un plugin universal.
- **`app.onError(handler)`.** En el navegador, el observador recibe lo mismo que `mountClientApp({ onError })` (navegación, Socket y eventos, efectos y limpiezas sin un `provideErrorHandler` más cercano), con `{ side: "client", source }`. En el servidor recibe los fallos del render de esa petición, con `{ side: "server", requestId }`, además del `onError` de `server/runtime.ts`.
- **`app.route`.** La ruta, como `useRoute()`. En el servidor es la de la petición; en el navegador sigue a la ruta confirmada, así que un `effect` que la lee se repite al navegar. `app.request` es la petición en el servidor y `undefined` en el navegador; `app.side` dice dónde se ejecuta.
- **Fallos.** Un plugin que lanza en el servidor hace fallar la petición, que muestra la página de error sin los valores de los plugins. En el navegador, la hidratación no llega a empezar y la página se queda con el HTML del servidor.

Un host propio pasa los plugins a `mountClientApp({ plugins })` y a `createServerApp({ plugins })` o `createFrameworkHandler({ plugins })`, como `PluginRegistration`s (`{ plugin, options?, name? }`).

### Límites entre servidor y cliente

El `setup` de un módulo y su entrada nunca llegan al bundle del navegador, y tampoco sus plugins `"server"`, su middleware, sus handlers, sus carpetas de autoimports con `scope: "server"` ni los `*.server.ts` de las carpetas del módulo. El plugin de Vite de Meeko rechaza el build si el grafo del cliente los alcanza (`Server-only module reached the client bundle`), y si un archivo que el navegador carga importa `defineMeekoModule` (`Meeko module setup reached the client bundle`): sólo `meeko.config.ts` debe importar los módulos. Las opciones de un plugin que se ejecuta en el navegador sí viajan en el bundle del cliente.

## Middleware de rutas y servidor

Coloque middleware de rutas compartido en `app/middleware/*.ts`. Cada archivo exporta por defecto una función creada con `defineRouteMiddleware` desde `@meekojs/meeko/framework`. Se ejecutan por nombre de archivo, antes del sidecar y el loader, tanto para una petición SSR de página como para una navegación cliente. `match.route.id` permite limitar un guard a rutas concretas. El contexto ofrece `url`, `match`, `signal` y `phase`; `request` sólo existe durante SSR. Devolver `undefined` continúa; devolver un `Response` detiene la ruta. Una redirección HTTP durante navegación cliente usa `location.assign`, con nueva petición de página. Una respuesta distinta de redirección cancela la navegación y comunica el error al callback `onNavigationError` del host. Sin callback, los fallos de navegación por clic o historial se muestran en la consola; si el callback falla, Meeko registra ese fallo sin crear un rechazo no observado. Al bloquear o fallar una navegación de historial, Meeko restaura la URL de la página que sigue visible. Una llamada directa a `app.navigate()` devuelve su rechazo al código que la invocó.

```ts
// app/middleware/10-locale.ts
import { defineRouteMiddleware } from "@meekojs/meeko/framework";

export default defineRouteMiddleware(({ url, match }) => {
  if (match.route.id !== "/dashboard") return;
  if (!url.searchParams.has("locale")) {
    const target = new URL(url);
    target.searchParams.set("locale", "es");
    return Response.redirect(target);
  }
});
```

`app/middleware` se empaqueta también para el navegador: no importe allí `server/`, secretos ni lógica de autorización que deba ser obligatoria en servidor. Un guard cliente mejora la navegación, pero nunca sustituye la validación de sesión y autorización del loader, API o RPC. Los archivos `*.test.ts`, `*.spec.ts`, `*.d.ts`, `*.client.ts` y `*.server.ts` se excluyen del descubrimiento de middleware de rutas.

Para interceptar HTTP en el servidor antes del handler de página o API/RPC, coloque middleware en `server/middleware/*.ts` y use `defineServerMiddleware` desde `@meekojs/meeko/server`. Recibe `Request` y `next(request?)`; debe devolver un `Response`. Puede continuar, modificar una respuesta o cortocircuitar. Meeko ejecuta los archivos por nombre, de fuera hacia dentro; `next()` sólo se puede llamar una vez. El middleware se ejecuta antes de crear el contexto de sesión de la petición, también para las páginas prerenderizadas; los archivos públicos del build se sirven antes del middleware. Los controles integrados de autenticación, autorización, contratos y CSRF de API/RPC siguen ejecutándose dentro del handler.

```ts
// server/middleware/10-request-header.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
```

Este pipeline envuelve páginas SSR y `/api` y `/_meeko/rpc`; los assets estáticos, el servidor de desarrollo Vite y los upgrades WebSocket tienen sus propios handlers. Los archivos `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts` se excluyen. El descubrimiento automático de middleware se limita por ahora al proyecto raíz: los layers aportan rutas, autoimports y plugins, pero sus carpetas `app/middleware` y `server/middleware` no participan. Un módulo añade middleware de servidor con `meeko.addServerMiddleware`, que se ejecuta antes que el del proyecto (véase [Módulos](#módulos)). Editar un archivo de middleware existente invalida módulos y recarga el navegador en desarrollo; al añadir o quitar uno, `meeko dev` recrea la aplicación sin reiniciar (véase [Configuración](#configuración)). `npm run check` comprueba los tipos en sus ámbitos respectivos.

Los callbacks `onNavigationError` pueden devolver una promesa: si el observador falla, Meeko registra tanto el fallo del observador como el error de navegación original sin generar un rechazo sin manejar. Los observadores `onError` del servidor tampoco modifican la respuesta cuando lanzan o rechazan; el registro de respaldo incluye el `requestId` disponible y categorías de error, sin mensajes privados.

Los eventos de componentes pueden observarse por raíz con `provideErrorHandler` en el `<script>` de `app/app.meeko` o de un layout; se autoimporta y el callback recibe `unknown` y su `ErrorSource`. Los hijos heredan el observador más cercano, también después de un reemplazo HMR. `mountClientApp({ onError })` define el observador de toda la aplicación: recibe la navegación, los canales Socket y los eventos, efectos y limpiezas que no tienen un `provideErrorHandler` más cercano. Sin `onError`, navegación y Socket consultan el primer proveedor activo de esa aplicación cuando no existe un `onNavigationError` u `onError` explícito del canal. Ese proveedor se desregistra al liberar su raíz; un fallo del observador se registra con el error original. Las llamadas directas a `app.navigate()` y `socket.emit()` mantienen sus rechazos para el código que las espera. En SSR no hay eventos de navegador ni conexiones Socket.

Si un middleware servidor llama a `next()`, Meeko espera también ese trabajo aunque el middleware olvide esperar la promesa. Un fallo del tramo siguiente se propaga al handler HTTP; si fallan ambos, se conserva cada error en un `AggregateError`. El middleware debe devolver una respuesta del pipeline o una respuesta propia.

## Routing, layouts y SSR

`app/pages` admite `index.meeko`, `[id].meeko`, `[...slug].meeko`, grupos `(group)`, `+error.meeko` y, para las opciones de ruta, un bloque `<script server>` en la página o un sidecar `*.route.ts`. El layout compartido vive en `app/layouts/default.meeko` y recibe `props.outlet`; el navegador lo conserva entre rutas y libera las páginas salientes. Los `+layout.meeko` junto a páginas siguen admitidos para proyectos anteriores y layouts anidados; no se puede combinar uno en la raíz de `app/pages` con `app/layouts/default.meeko`. Un layer usa las mismas convenciones. `href` comprueba IDs y parámetros a partir del manifiesto generado.

El tipo del outlet en `app/app.meeko` y en cada layout es `Component<Record<string, unknown>>` importado desde `@meekojs/meeko`. Incluye `renderWithState`, requerido por `<component is="props.outlet">` para transferir el estado SSR.

### `<MeekoOutlet />` y `<MeekoLink>`

Desde `1.2`, dos etiquetas propias de Meeko sustituyen a esos patrones. No se importan: el compilador las reconoce.

- **`<MeekoOutlet />`** pinta, en `app/app.meeko` y en los layouts (`app/layouts/*.meeko` o `+layout.meeko`), el layout o la página que van dentro. Lee el `outlet` que Meeko pasa, así que el layout no necesita declarar `defineProps<{ outlet }>()`; si declara sus props, `outlet` debe estar entre ellas. Equivale a `<component is="props.outlet">`: el navegador conserva el layout entre rutas y sólo cambia lo que hay dentro. En otro componente, o con atributos o contenido, da `MEEK104`.
- **`<MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'perfil' }">`** renderiza un `<a>` cuyo `href` construye `href()`: `to` sólo admite rutas que existen, las rutas dinámicas exigen `bind:params` con sus claves y `bind:search` añade la query string. `meeko check` y el editor marcan el error en el atributo (`Argument of type '"/nowhere"' is not assignable…`). En la ruta activa (la misma ruta sin query ni fragmento) añade `aria-current="page"`, que la navegación actualiza. El resto de atributos y los hijos pasan al `<a>` tal cual: `class`, `target`, `rel`, `aria-*`, `data-*` y `on:click`. `href` y `bind:href` no se admiten, porque el enlace lo construye `to` (`MEEK105`).

```html
<!-- app/layouts/default.meeko -->
<template>
  <header>
    <MeekoLink to="/" class="brand">Inicio</MeekoLink>
    <MeekoLink to="/users/[id]" bind:params="{ id: session.userId }">Mi perfil</MeekoLink>
  </header>
  <main><MeekoOutlet /></main>
</template>

<style scoped>
a[aria-current="page"] { font-weight: 700; }
</style>
```

En el editor, `to="` sugiere las rutas del proyecto y lleva a su página con Ctrl+clic. `meeko init-framework` genera el shell y el layout con estas etiquetas.

Las páginas, los layouts, `app/app.meeko` y `app/error.meeko` no pueden ser [componentes genéricos](api.md#componentes-genéricos-generic): Meeko les pasa sus props y no puede elegir sus parámetros de tipo, así que `generic` en su `<script>` da `MEEK100`. Lleve el contenido genérico a un componente de `app/components` y úselo desde la página.

Si una página falla y existe `+error.meeko`, Meeko la carga y renderiza con el mismo contexto de petición y estado SSR. El observador del servidor recibe el fallo original con su `requestId`; el HTML muestra un mensaje público y no incluye detalles privados. Si también falla la página de error, el servidor registra ese segundo fallo y entrega una respuesta segura.

### Página de error de la aplicación (`app/error.meeko`)

`app/error.meeko`, junto a `app/app.meeko`, es la página de error de toda la aplicación. Recibe las mismas props que `+error.meeko`, `{ status: number; message: string }`, y `meeko check` las comprueba igual. Se usa en dos casos:

- **URL sin ruta.** Una petición de página (GET o HEAD con `accept: text/html`, o la navegación con `accept: application/meeko+json`) responde `404` con `app/error.meeko` dentro de los layouts raíz: `app/app.meeko` y `app/layouts/default.meeko` (o `app/pages/+layout.meeko`). Las props son `{ status: 404, message: "NOT_FOUND" }`. Como la página de error de una ruta, el documento se titula `Error` (`<title>` en SSR y `document.title` al navegar a una URL sin ruta). El documento lleva el payload de hidratación, así que el navegador lo hidrata y la navegación posterior funciona. En el navegador, un enlace o `navigate()` a una URL sin ruta carga el documento: esa URL puede pertenecer a middleware de servidor, a un archivo o a una redirección, y consultarla antes con `fetch` ejecutaría dos veces un `GET` con efectos. Si nada más la atiende, el servidor responde con `app/error.meeko`. Por la misma razón, volver con el historial a una entrada sin ruta recarga el documento; la navegación desde la página `404` hacia rutas de la aplicación sí es del cliente.
- **Página que falla.** El `+error.meeko` más cercano sigue ganando; si no hay ninguno, se usa `app/error.meeko`. Lo mismo vale para el loader de una ruta `render: "client"` en el navegador.

`/api/...`, `/_meeko/...`, los assets y las peticiones que no son de página mantienen sus respuestas `404` (JSON o texto). Sin `app/error.meeko` nada cambia: una URL sin ruta responde `404` en texto plano y el navegador recarga el documento. `app/error.meeko` y `app/pages/+error.meeko` definirían el mismo nivel, por eso tenerlos a la vez es un error de descubrimiento. En un layer o módulo, `app/error.meeko` respalda sus propias páginas; la `404` usa la del proyecto. Un host propio pasa la página con `errorPage` a `createFrameworkHandler` y a `mountClientApp` (`AppManifest.errorPage` en `createServerApp`).

### Código de servidor de la página

Una página declara su código de servidor en un bloque `<script server lang="ts">` dentro del propio `.meeko`, de modo que `app/pages` sólo contiene archivos `.meeko`. El bloque admite dos formas. Pueden convivir en el mismo bloque, salvo `load`, que no se combina con código de nivel superior:

- **Código de nivel superior** (desde `1.1`). El bloque es código de servidor normal: lee la petición, consulta la base de datos, redirige o responde `404`, y cada `export const` es un dato de la página que llega tipado al `<script>` y a la plantilla.
- **Opciones de ruta.** `export const route = definePage({ params, search, render, prerenderEntries, load, head })`, la forma de `1.0`, que sigue funcionando sin cambios.

#### Código de nivel superior y datos exportados

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
import * as v from "valibot";

export const route = definePage({ params: v.object({ id: v.string() }) });

const { params, context } = usePage();                 // la petición en curso, tipada por route.params
if (!context.session.current) redirect("/login");
const row = await db.users.findById(params.id);        // db: un autoimport de server/utils; row no sale del servidor
if (!row) notFound();
export const user = { id: row.id, name: row.name };    // se envía a la página
export const head = { title: `Perfil de ${user.name}` };
</script>

<script lang="ts">
const name = signal(user.name);                        // `user` está en ámbito y tipado
</script>

<template><h1>{user.name}</h1><input model="name"></template>
```

- **Cuándo se ejecuta.** Las sentencias del bloque que no son imports, tipos ni `export const route` se ejecutan en cada petición: en SSR y en la petición de datos de cada navegación cliente, después del middleware y de validar `params` y `search` con `route`, igual que `load`. Admiten `await` de nivel superior. Los imports, los tipos y las opciones de ruta se evalúan una vez por módulo.
- **Exports.** Cada `export const` o `export let` (también desestructurado, `export const { a, b } = ...`) salvo `route` y `head` es un campo de datos de la página. Sólo cruzan los nombres exportados: el resto del bloque, sus imports y sus variables privadas no llegan al bundle cliente ni al payload. Un export que es una promesa se espera antes de renderizar.
- **En la página.** El `<script>` y la plantilla ven cada export como un valor normal, de sólo lectura en profundidad, con el tipo del export ya esperado. No es una señal: llega en el payload y se sustituye en cada navegación, cuando el bloque vuelve a ejecutarse. Para estado editable, cree una señal a partir de él (`signal(user.name)`). Declarar en el `<script>` un nombre que ya exporta el bloque da `MEEK075`. La página no necesita declarar `data` en `defineProps`; si lo declara, `meeko check` comprueba que sea compatible con los exports.
- **`export const head`.** Fija el `<head>` de la página como `route.head`: un objeto `{ title, description }` o una función sin argumentos que lo devuelve, calculada en el servidor con los valores del bloque. No forma parte de los datos. Declarar a la vez `export const head` y `route.head` da `MEEK072`. Desde `1.2`, `useHead` y `useSeoMeta` en el nivel superior del bloque son una alternativa, y `export const head` gana sobre ellas (véase [Head del documento](#head-del-documento-document-usehead-y-useseometa)).
- **API de la petición.** `usePage()` devuelve `{ url, params, search, request, context, signal }`: `params` y `search` salen de los schemas de `route` o, sin schema, de los segmentos del ID de ruta; `context` es el contexto de la petición (sesión, servicios, plataforma) y `signal` se aborta si el cliente se desconecta, se revoca la sesión o se cancela la respuesta. `redirect(url, status?)` detiene el bloque y responde con una redirección (`302` por defecto; admite `301`, `302`, `303`, `307` y `308`), que una navegación cliente sigue como la de un loader. `notFound()` detiene el bloque y responde `404` con la página de error más cercana (`+error.meeko` o `app/error.meeko`). Las tres se importan de `@meekojs/meeko/framework` o se usan sin import dentro del bloque. Fuera del nivel superior del bloque (dentro de una función, de las opciones de ruta o en el `<script>` del componente) dan `MEEK073`, y en ejecución lanzan un error con ese código.
- **Serialización.** Los exports viajan en JSON, como los datos de `load`. `meeko check` da un error de tipos en un export que no se puede serializar: funciones, `undefined`, `bigint`, símbolos e instancias de clase como `Date` o `Map`. En ejecución, un valor que `serializeJson` rechaza hace fallar la respuesta con `500`, como un loader.
- **Estado entre peticiones.** Como el bloque se ejecuta en cada petición, una variable de nivel superior (`const cache = new Map()`) es nueva cada vez. Un valor que deba compartirse entre peticiones vive en un módulo importado.

Meeko considera que un bloque tiene código de nivel superior si exporta con `export const` o `export let` un nombre distinto de `route` (incluido `head`), o si usa `usePage`, `redirect` o `notFound` (desde `1.2`, también `useHead` o `useSeoMeta`) fuera de cualquier función y fuera de las opciones de ruta. Un bloque sin ninguna de las dos cosas mantiene el comportamiento de `1.0`: se evalúa una vez como módulo y admite `export default`, `export function` o una constante privada usada por `load`. Con código de nivel superior se aplican estas reglas:

| Código | Causa |
| --- | --- |
| `MEEK070` | Código de nivel superior y `route.load` a la vez: los exports son los datos de la página. Elija uno. |
| `MEEK071` | `export function`, `export class`, `export enum`, `export default`, `export { ... }` o `export const route` junto a otras declaraciones en la misma sentencia. |
| `MEEK072` | `export const head` y `route.head` a la vez. |
| `MEEK073` | `usePage`, `redirect` o `notFound` fuera del nivel superior del bloque. |
| `MEEK074` | Código de nivel superior en una página `render: "client"`, cuyo bloque se ejecuta en el navegador. Use `useApi` o `useRpcQuery`, o renderice en el servidor. |
| `MEEK075` | Un nombre exportado por el bloque se declara también en el `<script>`. |
| `MEEK076` | Las opciones de ruta leen un nombre declarado por el código de nivel superior, que se ejecuta después y en cada petición. Mueva el valor compartido a un módulo importado. |

El editor da a los exports su tipo en el `<script>` y en la plantilla, y «ir a definición» sobre `user` lleva al `export` del bloque.

#### Opciones de ruta con `definePage`

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.string() }),
  load: async ({ params, signal }) => ({ id: params.id, signalAborted: signal.aborted }),
  head: ({ data }) => ({ title: data.id }),
});
</script>

<script lang="ts">
export interface Props { params: { id: string }; search: Record<string, string | string[]>; data: { id: string; signalAborted: boolean } }
const props = defineProps<Props>();
</script>

<template><h1>{props.data.id}</h1></template>
```

#### Reglas comunes

El bloque es un módulo TypeScript independiente del componente:

- **Sólo servidor.** El componente compilado nunca lo incluye. Se ejecuta en el servidor con los autoimports de `server/utils` y puede importar `server/` y módulos `*.server.*`; sus imports relativos se resuelven desde la carpeta de la página. Sólo una ruta `render: "client"` lo envía al navegador (véase «Modos de render»).
- **Opciones de ruta.** Igual que un sidecar: `export const route = definePage({ ... })` o, sin código de nivel superior, `export default`. `render` debe ser un literal que `meeko build` pueda leer sin ejecutarlo.
- **Sólo en páginas.** Un `<script server>` en un componente, un layout, `+layout.meeko` o `+error.meeko` es un error (`MEEK044`). Un segundo bloque da `MEEK004`, sin `lang="ts"` da `MEEK006` y con un valor (`server="..."`) da `MEEK043`.
- **Comprobación.** `meeko check` comprueba el bloque con TypeScript en el ámbito del servidor y compara su loader, o sus exports, con las props de la página; los errores señalan la línea y columna del `.meeko`.

`head({ data })`, o `export const head`, devuelve el `title` de la página y, desde `1.1`, su `description`. En SSR, `title` va en `<title>` y `description` en `<meta name="description">`, antes del `<head>` del host; en una navegación se aplican a `document.title` y a esa meta. Una página sin `title` o sin `description` deja los que aporta el host en `document.head`, o ninguno, igual en SSR que al navegar. Desde `1.2`, el `head` de la ruta admite también las etiquetas y atributos de `useHead` (`meta`, `link`, `script`, `style`, `htmlAttrs`, `bodyAttrs` y `titleTemplate` como cadena) y tiene la máxima prioridad frente a `useHead` y a `document` de la configuración; el título y la descripción del host quedan detrás del head que gestiona Meeko (véase [Head del documento](#head-del-documento-document-usehead-y-useseometa)).

Como alternativa, las opciones de ruta pueden vivir en un sidecar `*.route.ts` junto a la página (`app/pages/users/[id].route.ts`), la forma disponible desde `1.0`. Un sidecar no admite código de nivel superior. Una página no puede declarar ambos: Meeko detiene el descubrimiento de rutas con un error que nombra los dos.

Las opciones de ruta validan params y search antes del loader y del código de nivel superior. El loader puede devolver un `Response` para redirigir; el código de nivel superior usa `redirect()`. En una navegación cliente, si la petición de datos responde `404` (por `notFound()` o por un `ApiError` con estado `404` del loader), el navegador muestra el `+error.meeko` más cercano, o `app/error.meeko`, con `{ status: 404, message }`, donde `message` es el código público del error (`NOT_FOUND`), igual que el documento SSR. `meeko check .` compara el `ComponentProps` de cada página con los `params`, `search` y datos que entrega su sidecar; un error de contrato identifica ambos archivos. También comprueba que `app/app.meeko` y los layouts acepten el `outlet` suministrado por Meeko, y que `+error.meeko` y `app/error.meeko` acepten `status` y `message`. Estos contratos rechazan props declaradas como `any`, `never` o `unknown`. Los datos del loader son obligatorios para la página cuando el sidecar declara `load`; una query repetida sin schema puede producir `string[]`, además de `string`. El handler SSR crea el estado de `useState` y el contexto de sesión por petición; transfiere sólo props, estado público y datos de ruta serializables. El navegador hidrata ese payload y pide datos al servidor durante la navegación, por lo que un sidecar privado no entra al bundle cliente; sólo los sidecars `render: "client"` son públicos (véase «Modos de render»). `mountClientApp` gestiona historial, cancelación y limpieza. Si un host usa `loadRoute` directamente en cliente, su loader recibe un estado provisional: Meeko aplica sus cambios al confirmar la ruta y los descarta al cancelar o fallar. Las señales de ese estado deben usarse durante `load`, sin conservar referencias después de retornar. Se puede usar `render: "prerender"` con `prerenderEntries` para rutas dinámicas. `meeko build` lee `render` del sidecar sin ejecutarlo: debe ser un literal de texto dentro de `definePage({ ... })`, de un objeto exportado o de una constante local del mismo archivo; un valor calculado, una clave computada (`["render"]` o `[clave]`) que no vaya seguida de un `render` literal, un spread sin `render` explícito posterior o una reexportación detienen el build con el archivo afectado. El build escribe el HTML y el payload de navegación bajo `.meeko/output/node/prerender/` (`meeko prerender .` repite ese paso sobre un build existente). El servidor sirve esas páginas pasando por el middleware de servidor, el contexto de sesión y el middleware de ruta; inserta la meta CSRF de la sesión en `<head>` sin reescribir el documento. Sin sesión responde con `ETag`, `Vary: cookie` y `cache-control: public, max-age=0, must-revalidate`, y devuelve `304` ante `If-None-Match`; con sesión responde `private, no-store`. Una CDN o caché compartida delante del servidor debe respetar `Vary: cookie` o no almacenar respuestas de peticiones con cookie; si ignora `Vary`, configúrela para omitir la caché cuando la petición traiga la cookie de sesión, porque de lo contrario podría entregar la versión anónima a un usuario con sesión y dejarlo sin meta CSRF. `PrerenderedPage.headOffset` del índice `prerender/manifest.json` se mide en unidades de código UTF-16 del HTML almacenado leído como texto (índices de cadena de JavaScript), no en bytes: un adaptador debe leer el archivo como texto UTF-8 y usar el valor tal cual, sin calcularlo a partir de bytes. Una URL con query string, una entrada dinámica no generada o un host con nonce CSP se renderizan con SSR.
La comprobación del loader cubre tanto `definePage({ load() { /* ... */ } })` como `definePage(options)` cuando el tipo de `options` conserva un `load` obligatorio.

### Modos de render

`render` del sidecar elige cómo llega cada página al navegador:

| Modo | HTML del servidor | Loader y `head` | Uso |
| --- | --- | --- | --- |
| `"ssr"` (por defecto) | Página completa en cada petición | Servidor | Contenido indexable o personalizado |
| `"stream"` | Página sin los valores `defer`, que llegan después por la misma respuesta | Servidor | Páginas con datos lentos y secundarios |
| `"prerender"` | Página completa generada en `meeko build` | Servidor, durante el build | Contenido estático |
| `"client"` | Sólo los layouts, con el outlet vacío | Navegador | Paneles y vistas interactivas sin requisitos de SEO |

El código de nivel superior de `<script server>` sigue el modo como un loader: con `"ssr"` y `"stream"` se ejecuta en cada petición y con `"prerender"` una vez por entrada durante `meeko build`. En `"stream"`, un export creado con `defer(...)` llega después de la página, como un valor diferido del loader (véase [Streaming SSR](#streaming-ssr-render-stream)). Con `"client"` no se admite (`MEEK074`), porque el bloque se ejecuta en el navegador.

```html
<!-- app/pages/notes/index.meeko: el bloque se ejecuta en el navegador -->
<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "client",
  load: async ({ url, params, search, signal, state }) => api.notes.list({ signal }),
  head: ({ data }) => ({ title: `${data.length} notas` }),
});
</script>
```

Con `render: "client"` el bloque `<script server>` (o el sidecar) es público: entra en el bundle del navegador con los autoimports de cliente, aunque su etiqueta diga `server`.

Con `render: "client"` el servidor ejecuta el middleware de servidor y de ruta, crea el contexto de sesión y valida `params` y `search` con los schemas del sidecar (una entrada inválida responde `400`). Después renderiza `app/app.meeko` y los layouts con un outlet vacío, sin llamar a `load` ni a `head`, y envía un payload con `render: "client"` y sólo `params` y `search`. Sin layouts, `#app` queda vacío. En el navegador, Meeko hidrata los layouts, ejecuta `load` con `ClientPageLoadContext` (`url`, `params`, `search`, `signal` y `state`, sin `request` ni `context`) y confirma la página por la misma vía transaccional que una navegación; `head` se ejecuta después de `load` y su `title` se aplica a `document.title`. Un fallo del loader muestra el `+error.meeko` más cercano dentro de los layouts, con el mismo mensaje público que el servidor (`500` informa al observador de errores de navegación; un `ClientError` 4xx conserva su estado y código).

La navegación funciona en ambos sentidos entre páginas SSR y de cliente y conserva los layouts comunes: cada ruta elige su origen de datos. Las páginas `"client"` usan su sidecar en el navegador y las demás piden su payload al servidor. Sólo los sidecars `"client"` entran al bundle cliente, mediante el módulo virtual `virtual:meeko-client-routes`; la entrada generada los carga con `mountClientApp({ loadClientRoute })`. Por eso el build aplica la misma frontera que al resto del código cliente: importar `server/` o un módulo `*.server.*` desde ese sidecar detiene `meeko build`, y en el navegador sólo hay autoimports de cliente, por lo que usar un util de `server/utils` falla con un error que nombra el autoimport.

Compromisos de `"client"`:

- **SEO.** El HTML inicial no contiene los datos ni el `<title>` de la página. Los buscadores que no ejecutan JavaScript sólo ven los layouts. Use `"ssr"` o `"prerender"` para contenido indexable.
- **Seguridad de los datos.** El sidecar es público: no puede contener secretos ni comprobar permisos. Los datos llegan por API o RPC, y cada endpoint debe aplicar sus propias guardas (sesión, CSRF, autorización y validación). El middleware de ruta protege la navegación, pero no los datos.
- **Prerender.** Una página `"client"` no se puede prerenderizar: declarar `prerenderEntries` junto a `render: "client"` detiene `meeko check`/`meeko build` con un error explícito.
- **Build coherente.** El servidor compara el `render` del sidecar con el del manifiesto del build y responde con error si difieren; vuelva a ejecutar `meeko build` (o reinicie `meeko dev`) al cambiar el modo de una ruta.

### Streaming SSR (`render: "stream"`)

Un loader marca con `defer` los datos que pueden llegar después de la página. `defer(promise, { timeoutMs })` o `defer((signal) => promise, { timeoutMs })` devuelve un `Deferred<T>` con `status` (`"pending"`, `"resolved"` o `"rejected"`), `value` y `error` (`{ code, status }`). Leer esos campos en una plantilla o un `effect` se suscribe al resultado, porque están respaldados por señales.

Con una fábrica, Meeko la invoca cuando el loader devuelve y le pasa un `AbortSignal` que se aborta cuando el valor deja de esperarse: al agotar `timeoutMs`, si el cliente se desconecta, si se revoca la sesión, si el stream se cancela, en una petición `HEAD` o, en el navegador, al salir de la ruta. Pásela a `fetch` o a su cliente de base de datos para cancelar de verdad el trabajo. Una promesa ya iniciada no se puede cancelar: Meeko sólo deja de esperarla, salvo que el propio trabajo use `context.signal` del loader, que también se aborta en esos casos (salvo el timeout, que es propio de cada valor).

```ts
// app/pages/posts/[id].route.ts
import { defer, definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "stream",
  load: async ({ params }) => ({
    post: await api.posts.get({ params }),          // crítico: entra en el HTML inicial
    comments: defer((signal) => api.comments.list({ params, signal }), { timeoutMs: 5_000 }),
  }),
  head: ({ data }) => ({ title: data.post.title }),
});
```

```html
<p if:when="props.data.comments.status === 'pending'">Cargando comentarios…</p>
<ul if:when="props.data.comments.status === 'resolved'">…</ul>
<p if:when="props.data.comments.status === 'rejected'">No se pudieron cargar ({props.data.comments.error?.code}).</p>
```

**Fase 0, antes del primer byte.** El servidor resuelve la ruta, crea el contexto y la sesión, ejecuta el middleware, valida `params` y `search`, espera el loader crítico (todo lo que no está en `defer`), renderiza de forma síncrona la página y todos sus layouts con los diferidos en `pending` y calcula `head`, que ve el estado escrito durante el render. Después sella el estado (`StateStore.seal()`: una escritura posterior lanza `STATE_SEALED` y el valor diferido que la provocó se rechaza con `500`), espera los cambios de sesión que sigan en curso (`create`, `rotate` o `revoke` iniciados por el loader) y llama a `context.session.verify()`; una sesión revocada mientras corría el loader responde `401` en lugar de un `200` parcial. Estado, cabeceras, cookies, token CSRF y `<title>` quedan fijados ahí: no se puede redirigir ni cambiar la sesión desde trabajo diferido. Desde ese momento `create`, `rotate` y `revoke` fallan con `SESSION_LOCKED`/`500` antes de tocar el almacén, de modo que la sesión del navegador sigue siendo válida: sólo se rechaza el valor diferido que lo intentó, el fallo llega a `onError` y los demás valores siguen llegando.

El sellado se aplica a todos los modos de render, no sólo a `"stream"`. Una escritura de estado desde una promesa que nadie espera (ni el loader con `await` ni un `defer`) lanza `STATE_SEALED` dentro de esa promesa; si no la captura, es un rechazo no manejado y Node termina el proceso con su configuración por defecto. Espere ese trabajo en el loader o devuélvalo con `defer`.

**Fase 1, el stream.** La respuesta lleva `cache-control: no-store, no-transform` y `x-accel-buffering: no`. Primero se envía el documento hasta `#app`, el payload `#meeko-payload` (con `deferred: [{ id, path, status: "pending" }]` y `null` en cada `path`) y la entrada cliente con `<script type="module" async>`, que respeta el nonce CSP del host. Por cada valor que se resuelve, en el orden en que se resuelve, sigue un `<script type="application/json" data-meeko-deferred="N">{"deferred":N,"value":…}</script>` (o `"error":{"code","status"}`), y al final `</body></html>`. Son bloques de datos, no scripts ejecutables, así que una CSP estricta sin `'unsafe-inline'` no necesita excepciones.

**Errores y cancelación.** Un rechazo se serializa sólo como `{ code, status }` con las mismas reglas que la API: un `ApiError` conserva su código y estado; cualquier otro error se convierte en `INTERNAL_ERROR`/`500` y su causa privada se envía a `onError` con el `requestId` de la respuesta. Un valor que no termina en `timeoutMs` (10 s por defecto) se rechaza con `DEFERRED_TIMEOUT`/`504`. Los diferidos siguen `RequestContext.signal`: si el cliente se desconecta o falla una escritura del adaptador, el stream se cancela, Meeko deja de esperar los diferidos pendientes y aborta la señal de sus fábricas y la `signal` del loader, sin informar a `onError`; si se revoca la sesión, los que quedan se envían como `SESSION_REVOKED`/`401`. Una petición `HEAD` recibe las cabeceras finales sin cuerpo y aborta igualmente esas señales. Una promesa pasada directamente a `defer` sigue ejecutándose hasta terminar por su cuenta.

**Navegador.** El cliente hidrata con todos los diferidos en `pending`, como los renderizó el servidor, y aplica los valores ya llegados sólo cuando termina la hidratación. Encuentra los bloques que ya estaban en el documento y los que añade el parser después mediante un `MutationObserver` sobre `<body>`. Sólo acepta los bloques que son hijos directos de `<body>` y están después de `#meeko-payload`, donde los escribe el servidor; un bloque con el mismo aspecto dentro de `#app` (por ejemplo, HTML de usuario) se ignora. Si el documento termina sin el bloque de algún valor (por ejemplo, porque falló una escritura), ese valor se rechaza con `DEFERRED_INCOMPLETE`/`502`. En una navegación cliente a una ruta `"stream"`, Meeko pide `accept: application/meeko+json` y el servidor responde `application/meeko+ndjson`: la primera línea es el payload, con el que se confirma la ruta, y cada línea siguiente es `{ "deferred": id, "value" | "error" }`. Una línea mal formada se informa a `onError` y no detiene la lectura; si la conexión falla a mitad, el fallo se informa y los valores que no llegaron se rechazan con `DEFERRED_INCOMPLETE`/`502`. Navegar a otra ruta cancela la lectura pendiente. Las demás rutas siguen respondiendo `application/meeko+json`.

**`stream` frente a `ssr`.** Con `render: "ssr"` o `"prerender"`, un `defer` se espera dentro del servidor antes de renderizar: el HTML siempre contiene el valor resuelto (o su error) y es seguro para SEO, así que una página puede pasar de un modo a otro sin cambiar la plantilla. Con `"prerender"`, un valor rechazado no se guarda: la petición responde `500` y `meeko build` se detiene indicando la ruta y el `path` del valor. El HTML prerenderizado y su `index.meeko.json` salen de la misma ejecución del loader. Use `"stream"` cuando una parte secundaria de la página (comentarios, recomendaciones, métricas) es lenta y no debe retrasar el primer pintado ni la interactividad. Compromisos:

- **SEO.** El contenido diferido no está en el HTML inicial del SSR, sino en bloques de datos posteriores que sólo se muestran al ejecutar JavaScript. Lo que deba indexarse tiene que ir en el loader crítico o en una página `"ssr"`.
- **Proxies y CDN.** Un proxy, balanceador o CDN que almacena la respuesta completa antes de reenviarla anula el streaming: el usuario espera igual que con `"ssr"`. Meeko envía `x-accel-buffering: no` (respetado por nginx) y `cache-control: no-store, no-transform`: `no-transform` pide a los intermediarios que no compriman ni reescriban el cuerpo, porque una compresión o reescritura con buffer retendría los bloques. En Cloudflare, `no-transform` desactiva la compresión hacia el visitante y las funciones que modifican el HTML, pero no la inspección de sólo lectura: si una zona la tiene activa, cree una Configuration Rule con «Response Body Buffering» en «None» para esas rutas. En local, `wrangler dev` y `meeko preview --adapter cloudflare` (Miniflare) comprimen con gzip las respuestas `text/html` aunque lleven `no-transform` y sólo escriben el cuerpo comprimido al terminar, así que una página `"stream"` parece llegar entera al final salvo que el cliente envíe `accept-encoding: identity`. En producción, la compresión de Cloudflare sí respeta `no-transform`. Otros intermediarios o funciones serverless sin respuestas en streaming deben configurarse aparte. Los adaptadores Node, Bun y Deno escriben cada bloque en cuanto se produce; la suite de conformidad comprueba que el primer byte llega antes que el valor diferido.
- **Cabeceras finales.** Redirecciones, cookies, CSRF y `<title>` dependen sólo de los datos críticos. Mover algo a `defer` lo saca de esas decisiones.
- **Loaders en el navegador.** Un sidecar `"client"` (o un host que usa `loadRoute`) también puede devolver `defer`: el navegador aplica el mismo `timeoutMs`, el valor se actualiza cuando su promesa termina y la señal de una fábrica se aborta al agotar el plazo o al salir de la ruta.
- **Claves.** Un valor diferido puede estar bajo cualquier clave propia, incluidas `constructor` y `prototype`, salvo `__proto__`: el servidor responde `500` al renderizar.

### Enlaces, anclas y scroll

`mountClientApp` convierte en navegación cliente los clics en enlaces del mismo origen hacia una ruta de la aplicación, también los del HTML insertado con `html`. Un enlace a un fragmento de la página actual (`#seccion`, o `/docs#seccion` estando en `/docs`) no se intercepta: el navegador desplaza la página y añade la entrada al historial sin volver a pedir ni renderizar la página, y volver atrás o adelante entre esos fragmentos tampoco la renderiza. `app.navigate("#seccion")` hace lo mismo.

Una navegación nueva empieza arriba de la página o, si su URL tiene un fragmento que nombra un elemento (`id` o `name`), en ese elemento, de forma inmediata aunque la página use `scroll-behavior: smooth`. Una navegación por el historial o con `replace` sólo se desplaza al fragmento, si lo hay. Si la petición de datos de una navegación recibe HTML en lugar de un payload (un hosting estático que sirve el `index.html` prerenderizado, un proxy o una CDN), Meeko carga ese documento en vez de fallar.

### Estado de navegación

`useNavigation()` devuelve `{ pending }`, una señal de sólo lectura que vale `true` desde que empieza una navegación hasta que su página se confirma, falla o se cancela, incluida la primera carga de una página `"client"` y la carga de los `await useApi`/`await useRpcQuery` de la página nueva (véase [Navegación y `render: "client"`](#navegación-y-render-client)). En SSR y fuera de `mountClientApp` vale siempre `false`.

```ts
import { useNavigation } from "@meekojs/meeko/framework";

const nav = useNavigation();
// <p if:when="nav.pending.value">Cargando…</p>
```

### Ruta actual

Desde `1.2`, `useRoute()` devuelve la ruta confirmada que renderiza el componente, con una señal de sólo lectura por valor (tipo `RouteState`):

| Campo | Valor |
| --- | --- |
| `url` | URL relativa al origen, como cadena: `pathname`, `search` y, en el navegador, el fragmento (`/users/42?tab=a#bio`). No lleva el origen, así que coincide en un HTML prerenderizado en otro dominio. |
| `path` | `pathname`, codificado como en `location.pathname` (`/users/42`). |
| `id` | ID de la ruta en el manifiesto (`"/users/[id]"`), o `null` en la página `404` de `app/error.meeko` para una URL sin ruta. |
| `params` | Parámetros de la ruta, con la misma forma que recibe la página (validados por su schema). |
| `search` | Parámetros de búsqueda, con la misma forma que recibe la página; en la página `404`, la query string con las claves repetidas en arrays. |

Se autoimporta en las aplicaciones (un export propio llamado `useRoute` en `app/composables` u otra carpeta de autoimports tiene prioridad sobre el del framework) y, como `useNavigation`, puede llamarse también desde código anidado. Funciona en páginas, layouts, `app/app.meeko`, `app/error.meeko` y sus componentes:

- **SSR.** Los valores son los de la petición, también en las rutas `"prerender"` y `"stream"` y en los layouts de una ruta `"client"`. El servidor no recibe el fragmento, así que en SSR `url` nunca lo lleva.
- **Hidratación.** El navegador hidrata con los mismos valores que el SSR, sin desajustes. Si la dirección tiene un `#fragmento`, `url` lo incorpora justo después de la hidratación.
- **Navegación.** Los valores cambian sólo cuando una navegación se confirma, a la vez que el outlet, nunca mientras `useNavigation().pending` vale `true`; la página anterior se libera antes de que se actualicen los efectos que leen la ruta. También cambian al volver atrás o adelante en el historial y en una navegación sólo de fragmento, donde `path` se mantiene y cambia `url`. El render previo que carga los `await` de datos de la página nueva ya ve la ruta de destino.
- **Fuera de una aplicación.** Fuera de un render del framework o de `mountClientApp` (por ejemplo, en una prueba unitaria con `renderToString`), `useRoute()` lanza un error que lo explica, en lugar de inventar una ruta; pase la ruta al componente como prop en esas pruebas.

Un layout con barra lateral marca así el enlace activo, igual en el HTML del servidor y después de cada navegación (`bind:` elimina el atributo cuando el valor es `null`):

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
import type { Component } from "@meekojs/meeko";

const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
const route = useRoute();
const links = [
  { href: "/", label: "Inicio" },
  { href: "/users", label: "Usuarios" },
  { href: "/settings", label: "Ajustes" },
];
const isActive = (href: string): boolean => href === "/" ? route.path.value === "/" : route.path.value.startsWith(href);
</script>

<template>
  <aside>
    <nav>
      <a each:of="links" each:as="link" each:key="link.href" bind:href="link.href" bind:aria-current="isActive(link.href) ? 'page' : null">{link.label}</a>
    </nav>
  </aside>
  <main><component is="props.outlet"></component></main>
</template>
```

Los componentes recibidos como props mantienen la dirección del contrato: un componente que exige `label` no satisface un outlet que puede renderizarlo sin `label`. `meeko check` diagnostica la expresión que pasa el componente. Al guardar un módulo TypeScript importado por un `.meeko` abierto, la extensión de VS Code vuelve a comprobar sus diagnósticos y tokens semánticos.

### Head del documento: `document`, `useHead` y `useSeoMeta`

Desde `1.2`, Meeko gestiona el `<head>` de cada documento y los atributos de `<html>` y `<body>` a partir de tres fuentes, que se combinan con una sola regla de prioridad:

- **`document` en `meeko.config.ts`.** El documento común de la aplicación: `lang` y un `head` con etiquetas y atributos. Se renderiza en todos los documentos HTML: SSR, `"stream"`, `"prerender"`, la página `404` de `app/error.meeko`, el documento de error de una ruta que falla y el shell de una ruta `"client"`. Se fija en el build (y también llega al bundle del navegador, porque termina en el HTML), así que debe ser serializable: `titleTemplate` sólo puede ser una cadena (su tipo, `DocumentHead`, no admite una función, así que el editor y `meeko check` la marcan como error de tipos en `meeko.config.ts`) y `meeko build` rechaza una función. Su `title` es el título del sitio: lo muestran, tal cual y sin plantilla, las páginas sin título propio (véase **Título** más abajo). Los módulos de Meeko añaden su head antes del de la aplicación, que gana.
- **`useHead(input)`.** En páginas, layouts, `app/app.meeko`, `app/error.meeko`, componentes y composables, en el nivel superior del script o en un composable que éste llama. También en el código de nivel superior de `<script server>`, como alternativa a `export const head` (véase más abajo). `input` puede ser un objeto, un getter o una señal; con un getter o una señal, el navegador actualiza el documento cuando cambian los valores que lee.
- **`useSeoMeta(input)`.** Atajo tipado sobre `useHead`: `description`, `robots`, `themeColor`, `colorScheme`, `author`, `keywords`, `applicationName`, `referrer` y los campos `twitter*` producen `<meta name>`; los `og*` (`ogTitle`, `ogDescription`, `ogImage`, `ogImageAlt`, `ogImageWidth`, `ogImageHeight`, `ogUrl`, `ogType`, `ogSiteName`, `ogLocale`) producen `<meta property>`; `title` es el título y `canonical`, `<link rel="canonical">`. Un campo `undefined` o `null` no produce nada.

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  document: {
    lang: "es",
    head: {
      // «Zapatillas · Mi tienda» en una página titulada; «Mi tienda» en una sin título.
      title: "Mi tienda",
      titleTemplate: "%s · Mi tienda",
      link: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
      // Se ejecuta mientras el navegador lee <head>, antes de pintar; la hidratación no lo repite.
      script: [{ children: 'document.documentElement.dataset.theme = localStorage.getItem("theme") ?? "light"' }],
    },
  },
});
```

```html
<!-- app/pages/products/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
export const product = await findProduct(params.id);
</script>

<script lang="ts">
const quantity = signal(1);
useSeoMeta({
  title: product.name,
  description: product.summary,
  ogImage: product.image,
  twitterCard: "summary_large_image",
  canonical: `https://tienda.example/products/${product.id}`,
});
useHead(() => ({ title: `${product.name} (${quantity.value})` }));
</script>
```

`HeadInput` admite `title`, `titleTemplate` (`"%s · Sitio"` o `(title) => string`; en `document.head`, `meeko.addHead` y el `head` de la ruta, sólo la cadena), `meta`, `link`, `script` (externo con `src` o en línea con `children`; `async`, `defer`, `module` y `type`), `style` (con `children` y `media`), `htmlAttrs` y `bodyAttrs` (`lang`, `dir`, `class`, `data-*`; un valor `undefined` no aporta nada y los atributos `on*` se rechazan).

**Prioridad.** De menor a mayor: `document` de la configuración, `app/app.meeko`, cada layout (el más interno gana), la página con sus componentes y, por último, el `head` de la ruta (`export const head`, `route.head` o `useHead` en `<script server>`). Dentro de un mismo nivel gana la llamada posterior, de modo que un componente de la página que se monta después (por ejemplo, tras un `if:`) sustituye a lo que fijó la página. Los atributos de `<html>` y `<body>` se combinan por nombre con la misma prioridad.

**Título.** `titleTemplate` es el de la entrada de más prioridad que lo declara, y se aplica al título de más prioridad de `app/app.meeko`, los layouts, la página y el `head` de la ruta, también al de las páginas de error (`"Error"`). El `title` de `document.head` (o el que añade un módulo con `meeko.addHead`) es distinto: es el título del sitio y nunca pasa por la plantilla. Una página sin título propio muestra ese título tal cual, y lo mismo una cuyo título ganador es una cadena vacía, en lugar de una plantilla alrededor de nada. Sin título del sitio, una página sin título no tiene `<title>` gestionado (queda el del host, si lo hay) y un título vacío se escribe vacío. La regla es la misma en el SSR, al hidratar y al navegar en el cliente. Con la configuración del ejemplo:

| Título de la página | `<title>` |
| --- | --- |
| `"Zapatillas"` | `Zapatillas · Mi tienda` |
| ninguno | `Mi tienda` |
| `""` | `Mi tienda` |

**Deduplicación.** Cada etiqueta tiene una clave: `key` si la declara o, si no, su clave natural. En `meta`, `name` (sin distinguir mayúsculas), `property` o `httpEquiv`, junto con su `media` si lo tiene (dos `theme-color` para claro y oscuro conviven); en `link`, `rel` y `href`, salvo `rel: "canonical"` y `rel: "icon"`, que son únicos aunque cambie `href`; en `script`, `src` o el código; en `style`, el CSS. Con la misma clave sólo queda la etiqueta de más prioridad, en el lugar donde apareció la primera. Así, un `icon` de `document` sustituye al `<link rel="icon" href="data:,">` que Meeko escribe por defecto, y un `meta name="viewport"` sustituye al viewport por defecto.

**SSR y CSP.** El servidor escribe `<html lang="…">` y los atributos como atributos reales, escapados. Dentro de `<head>`, tras la meta CSRF y los estilos de los componentes, el título y las etiquetas gestionadas van entre los comentarios `<!--meeko:head-->` y `<!--/meeko:head-->`, antes del HTML de confianza del host (`DocumentOptions.head`, que conserva su propio `<title>` como título por defecto). Los valores de los atributos se escapan; el contenido de `script` y `style` en línea no se escapa, pero no puede cerrar su etiqueta: `</` se escribe `<\/` (y `<!--`, `<\!--` en un script), y en los scripts JSON (`application/ld+json`, `application/json`, `importmap`, `speculationrules`) cada `<` se escribe `<`. El nonce CSP de la petición (`DocumentOptions.nonce`) se añade a los `<script>` y `<style>` gestionados. Una página prerenderizada conserva el head y recibe la meta CSRF justo después de `<meta charset>` y de las etiquetas por defecto que la aplicación no sustituyó.

**Navegador.** Al hidratar, Meeko adopta las etiquetas del SSR sin duplicarlas ni volver a ejecutar los scripts. Cuando cambia un getter o una señal de `useHead`, actualiza el título, los atributos y las etiquetas. Al navegar, las entradas de los componentes que se desmontan desaparecen y vuelve lo que habían sustituido (por ejemplo, el `canonical` del layout o la `description` de `app/app.meeko`); al volver atrás, la página restaura las suyas. Las etiquetas nuevas se insertan antes de `<!--/meeko:head-->` con el nonce CSP del documento; un script que cambia es un elemento nuevo, que el navegador ejecuta. El `head` de la ruta viaja en el payload de navegación, igual que `title` y `description` en `1.1`. Fuera de una aplicación de Meeko (por ejemplo, en una prueba unitaria con `renderToString`), `useHead` no hace nada. Un host propio que pasa `DocumentOptions.config` a `createFrameworkHandler` debe pasar el mismo valor a `mountClientApp({ document })`; la entrada que genera Meeko ya lo hace.

**`<script server>`.** `useHead` y `useSeoMeta` en el código de nivel superior hacen que el bloque tenga código de nivel superior, como `usePage`. Sus entradas forman el `head` de la ruta junto con `export const head` (o `route.head`), que gana sobre ellas. Como viajan en el payload, su `titleTemplate` debe ser una cadena.

## Autoimports y TypeScript

**Imports sin extensión.** Desde `1.2`, Meeko comprueba los tipos con `"module": "ESNext"` y `"moduleResolution": "Bundler"`, como Vite y Nuxt: un import relativo no necesita extensión (`import { format } from "../utils/format"`), porque Vite resuelve y empaqueta todo el código en `meeko dev` y en `meeko build`, y Node nunca ejecuta un `.ts` directamente. Los imports con `.js` siguen funcionando. `meeko init-framework` genera el `tsconfig.json` con esos valores; un proyecto anterior puede cambiar sus dos líneas `"module": "NodeNext"` y `"moduleResolution": "NodeNext"` para que el editor también acepte los imports sin extensión en sus `.ts`.

Meeko analiza exports AST de `app/{components,composables,utils,stores,types}` (`app/types` desde `1.2`), `shared/{types,schemas,utils,constants,enums}` y `server/utils`. Los tipos que sólo usa la aplicación van en `app/types`; los que comparten la aplicación y el servidor, en `shared/types`. Un `type` o una `interface` autoimportados llegan con `import type`. Los símbolos de `app/` están disponibles en cliente y SSR, pero no desde `shared/`; los sufijos `.client.ts` y `.server.ts` restringen un módulo a su entorno. `imports.serverDirs` añade directorios privados exclusivos del servidor. Los símbolos del framework `api`, `rpc`, `socket`, `useSocket`, `useApi`, `useRpcQuery`, `useRpcMutation`, `useState`, `href` y `useRoute`, desde `1.2` `useForm`, `useStorage`, `useApiMutation`, `useHead`, `useSeoMeta`, `definePage`, `defineRouteMiddleware` y `definePlugin`, y en el código de servidor (`server/` y `<script server>`) `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime` y `ApiError`, y de la raíz `signal`, `computed`, `effect`, `batch`, `untrack` (desde `1.2`), `onCleanup`, `onMounted`, `provide`, `inject`, `createContext` y `provideErrorHandler`, también figuran en el registro; un export propio llamado `useRoute`, `useForm`, `useStorage`, `useApiMutation`, `useHead` o `useSeoMeta` tiene prioridad sobre el del framework. Los imports explícitos prevalecen. Una colisión produce error; nunca se elige por orden de archivos. Un `enum` o una clase autoimportados sirven también como tipo, con sus miembros (`Scope.App`); si un archivo sólo los usa como tipo, Meeko inserta `import type`. Los schemas de `shared/schemas` pueden llegar por autoimport a los contratos de API, RPC y Socket. `meeko check` comprueba los `.ts` que importa un `.meeko` con los autoimports de su ámbito y con las rutas generadas, igual que los proyectos `tsconfig.*`.

Los `.ts` normales de `app/` (composables, utils, stores) se ejecutan en SSR y en el navegador, como los `.meeko` que los usan, y sus autoimports del framework (`api`, `rpc`, `socket`, `useSocket`, `useApi`…) se resuelven por entorno: el cliente de servidor en SSR y el del navegador en el navegador. Antes de `1.1` usaban siempre el del navegador, y `meeko dev` o `meeko build` fallaban con «Client-only module reached the server bundle». Un `.client.ts` sigue siendo sólo de navegador.

**Módulos `.client.ts` en `app/`.** Un `.meeko` se compila dos veces, para SSR y para el navegador, así que no puede usar un símbolo de un `.client.ts` ni importarlo de forma estática: `meeko check` y el build lo rechazan («unavailable in server scope», «Client-only module reached the server bundle»). Cárguelo con `import()` dentro de un código que sólo se ejecute en el navegador (un manejador de evento o un `effect`) y protéjalo con `import.meta.env.SSR`, que el build de servidor sustituye por `true` y con el que elimina ese import:

```ts
async function exportCsv(): Promise<void> {
  if (import.meta.env.SSR) return;
  const { downloadCsv } = await import("../utils/download.client.js");
  downloadCsv(rows.value);
}
```

Un `.client.ts` sí puede importarse normalmente desde otros `.client.ts`.

**Stores (`app/stores`).** Es una carpeta de autoimports como `app/composables`; Meeko no define una API de store. Un `signal` creado a nivel de módulo vive mientras vive el proceso, así que en el servidor lo comparten todas las peticiones y usuarios. Para estado de la aplicación use `useState(key, init)` dentro de la función del store: es por petición en SSR, se transfiere al navegador en el payload y en el navegador se comparte entre componentes:

```ts
// app/stores/cart.ts
export function useCart() {
  const items = useState("cart:items", (): string[] => []);
  const add = (id: string): void => { items.value = [...items.value, id]; };
  return { items, add };
}
```

El compilador `.meeko` y la transformación `.ts` insertan imports ESM reales. Las declaraciones por ámbito se regeneran bajo `.meeko/types/autoimports/` sólo cuando cambia el contenido, para autocompletado y navegación a definición. Los tipos genéricos reexportados conservan parámetros, restricciones y defaults; las firmas overload del mismo símbolo se registran una sola vez, mientras una colisión entre orígenes distintos sigue fallando. El servidor de lenguaje usa el mismo registro y las posiciones AST del compilador. Los proyectos app, server y shared generados por `meeko check` aplican también `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` y `verbatimModuleSyntax`. `shared/` no puede depender de símbolos app o servidor; el bundle cliente rechaza módulos `server/`, incluidos imports transitivos. Los `*.route.ts` pertenecen al ámbito servidor.

Al migrar código que no usaba esas opciones estrictas, cambie imports usados sólo como tipos a `import type`, compruebe el resultado de accesos por índice antes de usarlo y añada `| undefined` únicamente cuando la ausencia sea parte real del contrato. No silencie los diagnósticos ensanchando props o contratos públicos a `any`: Meeko usa esos tipos para generar el cliente, validar el servidor y mantener iguales CLI y editor.

## API y RPC

Los archivos `server/api/users/index.get.ts`, `index.post.ts` y `[id].get.ts` crean `/api/users` y `/api/users/:id`. Los procedimientos bajo `server/rpc/users/get.ts` crean `/_meeko/rpc/users/get`. Los schemas públicos residen en `shared/`. Los handlers usan `defineApiRoute` y `defineRpc`, y el servidor valida entrada, salida, sesión, autorización y CSRF.

**Validador: Standard Schema, Valibot por defecto.** Meeko valida con cualquier biblioteca que implemente [Standard Schema](https://standardschema.dev), como Valibot, Zod o ArkType, en API, RPC, Socket, rutas, `useForm` y `useStorage`. Los ejemplos de esta documentación usan Valibot (`import * as v from "valibot"`, desde la versión 1), el validador recomendado: es pequeño y modular, así que el bundle del navegador sólo incluye las funciones que usan los schemas de `shared/` que comparten servidor y cliente. Elegir otra biblioteca no cambia ninguna API de Meeko; sólo la exportación OpenAPI necesita el conversor a JSON Schema de esa biblioteca (para Valibot, `@valibot/to-json-schema`).

```sh
npm install valibot
```

```ts
// shared/schemas/user.ts
import * as v from "valibot";
export const userParams = v.object({ id: v.string() });
export const userSchema = v.object({ id: v.string(), name: v.string() });
export const usersSchema = v.array(userSchema);
```

```ts
// server/api/users/index.get.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { usersSchema } from "../../../shared/schemas/user.js";

export default defineApiRoute({
  response: usersSchema,
  handler: () => [{ id: "123", name: "Ada" }],
});
```

```ts
// server/api/users/[id].get.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/user.js";

export default defineApiRoute({
  params: userParams,
  response: userSchema,
  handler: ({ params }) => ({ id: params.id, name: "Ada" }),
});
```

```ts
// server/rpc/users/get.ts
import { defineRpc } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/user.js";

export default defineRpc({
  input: userParams,
  output: userSchema,
  handler: ({ input }) => ({ id: input.id, name: "Ada" }),
});
```

```ts
// app/pages/users/index.meeko, sin imports manuales
const loadUsers = async () => {
  const users = await api.users.get();
  const user = await api.users({ id: "123" }).get();
  const result = await rpc.users.get({ id: "123" });
  return { users, user, result };
};
```

Esos símbolos también funcionan en `.ts` según el ámbito. `meeko routes .` genera `.meeko/generated/clients.client.ts` y `clients.server.ts` con descriptores públicos y tipos inferidos; no importan handlers privados. En SSR, los clientes consultan el contexto actual en cada llamada y despachan localmente por el mismo pipeline HTTP si el host suministra `createLocalServerFetch`. El starter ya lo conecta. Credenciales, sesión, servicios, estado y `requestId` quedan ligados a la petición original. Fuera de un contexto SSR, una llamada al cliente servidor falla con un error claro. En navegador se usa `fetch` same-origin y se lee el token CSRF de la meta `meeko-csrf-token`, que se actualiza tras respuestas y navegación. `createApiClient` y `createRpcClient` siguen disponibles para clientes explícitos o externos. Las respuestas no JSON requieren `contentType: "response"`.

Una respuesta API/RPC iniciada antes de un cambio de token no puede restaurar un token CSRF ya eliminado por logout ni sobrescribir el token aplicado por navegación. El cliente compara el documento y el token actuales con los que tenía al iniciar la petición antes de aplicar la cabecera de respuesta.

Los schemas `params` de API deben describir exactamente los segmentos dinámicos de la ruta como cadenas obligatorias. Una ruta estática no declara `params`. Los inputs de `query` deben aceptar cadenas o listas de cadenas, con campos opcionales si la clave puede faltar. Si se necesitan números, conviértalos dentro del schema desde texto; el generador rechaza un contrato que exige directamente un número que la URL no puede entregar.

Los schemas públicos de API, RPC y Socket deben exponer tipos Standard Schema concretos: la generación rechaza `any`, `unknown` y `never` tanto en la entrada como en la salida, incluso cuando aparecen anidados, y también parámetros genéricos que no quedan resueltos en el contrato exportado. Concrete esos parámetros y modele explícitamente el tipo público antes de generar clientes. El manifiesto también rechaza nombres que no puedan representarse sin ambigüedad en el cliente. Por ejemplo, `server/api/users/index.get.ts` (`api.users.get()`) no puede coexistir con `server/api/users/get.post.ts` (`api.users.get.post()`), ni `server/rpc/users.ts` con `server/rpc/users/get.ts`. `server/api/index.<method>.ts` se rechaza porque produciría una clave cliente vacía. Cada diagnóstico incluye las rutas en conflicto; no hay sobrescrituras silenciosas.

`meeko check .` genera proyectos TypeScript separados para cliente, servidor y shared. Incluye las fuentes de los layers declarados en `meeko.config.ts` (también los que añaden los módulos), aunque sus rutas no usen el nombre convencional `layers/`, y los componentes de `addComponentsDir` de los módulos que viven dentro del proyecto fuera de `node_modules`. Un archivo `*.server.ts` de `app/` se comprueba en el proyecto servidor y uno `*.shared.ts` en el proyecto shared; los archivos con sufijo de ámbito conservan esa selección también dentro de `shared/` y `server/`.

Los errores de API y RPC se normalizan en el servidor: un `ApiError` conserva `code` y `status`, la respuesta añade `requestId` y `x-request-id`, y un fallo desconocido se devuelve como `INTERNAL_ERROR` sin exponer su mensaje. La misma normalización se aplica al despacho local SSR y al transporte Node, incluso cuando Vite carga módulos en grafos distintos. La navegación que solicita `application/meeko+json` recibe el mismo formato; una página HTML de error conserva el estado HTTP y `x-request-id` sin incluir detalles privados. El servidor generado observa los fallos 5xx: en producción registra tipo e ID, y en desarrollo muestra también el error original. Las respuestas 4xx esperadas no se registran como fallos internos.

### Segmentos dinámicos en `api.*`

Cada carpeta o archivo de `server/api` es un nivel de `api.*`, y cada archivo aporta el método de su sufijo. Desde `1.2`, un segmento dinámico se llama con sus parámetros: `node({ nombre: valor })` devuelve el cliente de ese segmento, y los métodos que se alcanzan así ya no reciben `params`. `query`, `body` y `signal` siguen igual, y la URL se construye y se codifica como con `params`.

```ts
// server/api/menu/categories/index.get.ts         → api.menu.categories.get()
// server/api/menu/categories/[id].patch.ts        → api.menu.categories({ id }).patch({ body })
// server/api/menu/categories/[id]/archive.post.ts → api.menu.categories({ id }).archive.post()
// server/api/orgs/[org]/users/[id].get.ts         → api.orgs({ org }).users({ id }).get()
const list = await api.menu.categories.get();
await api.menu.categories({ id }).patch({ body: { name } });
await api.menu.categories({ id }).archive.post();
const user = await api.orgs({ org }).users({ id }).get({ query: { tab: "profile" } });
```

- La llamada recibe un objeto con el único parámetro de su segmento, como cadena: TypeScript rechaza que falte, una clave de más, un valor que no es texto y `params` en los métodos que siguen a la llamada. Un objeto sin el parámetro o con otro lanza un `TypeError` al llamar; un valor vacío, `.`, `..` o con `/` rechaza la petición igual que con `params`.
- Un nivel conserva sus métodos y sus hijos estáticos junto a la llamada: `api.menu.categories.get()` y `api.menu.categories({ id })` conviven. Si un nivel tiene varios segmentos dinámicos hijos (`users/[id].get.ts` y `users/[slug]/posts.get.ts`), el nombre del parámetro elige el segmento: `api.users({ id })` o `api.users({ slug }).posts.get()`.
- Un catch-all `[...path]` recibe, como en `params`, una cadena con los segmentos unidos por `/`: `api.files({ path: "docs/a b.txt" }).get()` pide `/api/files/docs/a%20b.txt`, con cada segmento codificado por separado.
- `useApi` no cambia: sigue recibiendo la ruta con corchetes y `params`, como `useApi("/api/menu/categories/[id]", { params: { id } })`.
- El editor completa la llamada, sus parámetros y los métodos del segmento, y el hover y "ir a la definición" de `api.menu.categories({ id }).archive.post` llevan al handler.

En `clientKey`, el segmento dinámico de `[id]` o `[...id]` se llama `byId`: `by` seguido del nombre del parámetro con la inicial en mayúscula. El cliente reconoce así el segmento al que corresponde cada parámetro, también en un cliente explícito de `createApiClient`. Por eso el manifiesto rechaza, con las rutas en conflicto, un segmento estático que se llame igual que el segmento dinámico de su nivel (`users/byId/` junto a `users/[id]`) o de su propia ruta (`[id]/byId.get.ts`), y dos parámetros cuyo nombre sólo cambia en la inicial (`[id]` y `[Id]`) en el mismo nivel o en la misma ruta.

La forma anterior, `api.menu.categories.byId.archive.post({ params: { id } })`, sigue funcionando durante toda la serie 1.x y se retirará en `2.0`. Está obsoleta desde `1.2`: el editor tacha cada método que se llama a través de `byId` y su hover indica el reemplazo; no hay aviso de consola. Sólo existe antes de la primera llamada de segmento: `api.orgs({ org }).users.byId` no existe.

### Errores de validación en formularios

Desde `1.2`, cuando `params`, `query`, `body` o el `input` de un RPC no superan su schema, la respuesta `400` (`INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` o `INVALID_INPUT`) incluye `issues`: una lista de `{ path, message }` con, como mucho, 20 elementos. `path` son las claves de la ruta del issue de Standard Schema unidas con `.` (`"items.0.name"`), o `""` para la entrada completa; `message` es el mensaje del schema. Sólo viajan esos dos campos: nunca el valor recibido, lo esperado ni una traza. Los issues sin mensaje se omiten, y sin ninguno la respuesta no lleva `issues`. Un resultado del handler que no supera `response` u `output` sigue siendo `500` sin detalle, porque es un fallo del servidor.

```ts
// shared/schemas/auth.ts
import * as v from "valibot";
export const loginInput = v.object({
  email: v.pipe(v.string(), v.email("Escribe un correo válido.")),
  password: v.pipe(v.string(), v.minLength(1, "Escribe tu contraseña.")),
});
```

```json
{ "code": "INVALID_INPUT", "status": 400, "requestId": "…", "issues": [{ "path": "password", "message": "Escribe tu contraseña." }] }
```

En el cliente, `ClientError.issues` es esa lista de sólo lectura (tipo `ValidationIssue`), o `undefined` si la respuesta no la trae. Llega igual desde `api.*`, `rpc.*` y el `error` de `useApi`, `useRpcQuery` y `useRpcMutation`:

```ts
import { ClientError } from "@meekojs/meeko/framework";

const login = useRpcMutation("auth.login");
const fieldError = (path: string) => {
  const error = login.error.value;
  return error instanceof ClientError ? error.issues?.find((issue) => issue.path === path)?.message : undefined;
};
```

Escriba mensajes propios en el schema: algunos mensajes por defecto de Valibot citan el valor recibido.

`useForm` lleva estos `issues` a cada campo del formulario sin código propio (véase [Formularios: `useForm`](#formularios-useform)).

### Valores por petición: `locals`

Desde `1.2`, `defineApiRoute` y `defineRpc` aceptan `locals(context)`, que calcula un valor por petición (por ejemplo, el usuario actual) y se lo entrega al handler como `locals`, con el tipo inferido de lo que devuelve. Sin `locals`, el handler recibe `locals: undefined`. `authorize` no cambia y sigue devolviendo un booleano.

El orden de cada petición es: Origin con `origin: "required"`, Origin y CSRF de la sesión, `rateLimit` (desde `1.2`), `auth`, `authorize`, validación de la entrada (`params`, `query` y `body`, o `input`), `locals`, handler y validación de la respuesta. Así, `locals` sólo se ejecuta con una entrada válida y una petición ya autorizada. Si lanza un `ApiError`, ese error es la respuesta (por ejemplo, `401` si el usuario de la sesión ya no existe o `403` si perdió el acceso); cualquier otro error es `500`.

```ts
// server/rpc/orders/create.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { newOrder, orderSchema } from "../../../shared/schemas/order.js";
import { createOrder, findUser } from "../../utils/store.js";

export default defineRpc({
  input: newOrder,
  output: orderSchema,
  auth: "required",
  locals: async ({ session }) => {
    const user = await findUser((session.current!.data as { userId: string }).userId);
    if (!user) throw new ApiError("UNAUTHENTICATED", 401);
    return { user };
  },
  handler: ({ input, locals }) => createOrder(locals.user, input),
});
```

Declare `locals` antes de `handler` en el objeto: si `locals` usa su parámetro, TypeScript sólo infiere su tipo para el handler cuando aparece antes. Con la sesión tipada mediante [`MeekoSession`](#tipos-de-la-sesión-meekosession), `session.current!.data.userId` no necesita `as`.

### Estado de la respuesta: `status`

Desde `1.2`, `defineApiRoute` acepta `status` para elegir el estado de una respuesta correcta sin renunciar a JSON, a la validación con `response` ni al tipo del cliente generado:

| `status` | Respuesta | `api.*` resuelve |
| --- | --- | --- |
| `200` (por defecto) | JSON validado con `response` | el valor de `response` |
| `201` | JSON validado con `response` (`201 Created`) | el valor de `response` |
| `202` | JSON validado con `response` (`202 Accepted`) | el valor de `response` |
| `204` | sin cuerpo ni `content-type` (`204 No Content`) | `undefined` |

```ts
// server/api/orders/index.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { newOrder, orderSchema } from "../../../shared/schemas/order.js";
import { createOrder } from "../../utils/store.js";

export default defineApiRoute({
  body: newOrder,
  response: orderSchema,
  status: 201,
  handler: ({ body }) => createOrder(body),
});
```

```ts
// server/api/orders/[id].delete.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { orderParams } from "../../../shared/schemas/order.js";
import { deleteOrder } from "../../utils/store.js";

export default defineApiRoute({
  params: orderParams,
  status: 204,
  handler: async ({ params }) => { await deleteOrder(params.id); },
});
```

- `status` debe ser un literal (`status: 201`): el generador lo lee sin ejecutar el handler y rechaza otro valor. Una constante o una expresión no sirven.
- Con `204`, el handler no devuelve nada y no se declara `response`; devolver un valor responde `500` `INVALID_RESPONSE`. En el contrato generado la salida es `undefined`, así que `await api.orders({ id }).delete()` resuelve `undefined`, igual que `useApi`.
- `status` no se combina con `contentType: "response"`: ese handler ya devuelve su propio `Response` con el estado que quiera.
- Un `status` no admitido, combinado con `contentType: "response"` o un `204` con `response` responde `500` `INVALID_RESPONSE_STATUS` antes de leer la entrada, aunque el generador ya lo rechaza en `meeko routes`, `meeko check` y `meeko dev`.
- Los errores no cambian: siguen saliendo de `ApiError` con su propio estado.
- `generateOpenApi` documenta el estado declarado (`201 Created`, `202 Accepted` o `204 No Content`, este sin `content`).
- El estado es fijo por endpoint. Para elegirlo en cada petición (por ejemplo, `201` al crear y `200` al actualizar en un mismo `PUT`), use `contentType: "response"` o dos endpoints.
- RPC no tiene `status`: un procedimiento siempre responde `200` con su `output`.

### Datos en componentes: `useApi`, `useRpcQuery` y `useRpcMutation`

Desde `1.1`, un componente puede pedir sus propios datos con composables autoimportados desde los clientes generados. Usan los mismos contratos, tipos, sesión y CSRF que `api.*` y `rpc.*`:

| Composable | Uso | Devuelve |
| --- | --- | --- |
| `useApi(ruta, opciones?)` | Lectura de un endpoint `GET` | `{ data, error, pending, refresh }` |
| `useRpcQuery(procedimiento, input)` | Lectura mediante un procedimiento RPC | `{ data, error, pending, refresh }` |
| `useRpcMutation(procedimiento, opciones?)` | Escritura bajo demanda mediante RPC | `{ mutate(input), data, error, pending }` |
| `useApiMutation(ruta, método, opciones?)` (desde `1.2`) | Escritura bajo demanda en un endpoint `POST`, `PUT`, `PATCH` o `DELETE` | `{ mutate({ params, query, body }), data, error, pending }` |

`ruta` es la ruta del endpoint tal como la describe `server/api`, con los segmentos dinámicos entre corchetes: `"/api/users"` o `"/api/users/[id]"`. Sólo se admiten endpoints `GET`. `procedimiento` es el ID del procedimiento con puntos: `server/rpc/users/get.ts` es `"users.get"`. El editor completa rutas y procedimientos, y TypeScript comprueba `params`, `query` e `input` contra el contrato. `data`, `error` y `pending` son señales de sólo lectura; `error` es un `Error` o `null`.

```html
<!-- app/pages/users/[id].meeko -->
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const tab = signal("profile");
const user = await useApi("/api/users/[id]", { params: { id: props.params.id } });
const activity = await useRpcQuery("users.activity", () => ({ id: props.params.id, tab: tab.value }));
const rename = useRpcMutation("users.rename");
async function save(name: string): Promise<void> {
    await rename.mutate({ id: props.params.id, name });
    await user.refresh();
}
</script>
<template><h1>{user.data.value.name}</h1><p>{activity.data.value.length} eventos</p></template>
```

#### Con y sin `await`

- **Con `await`.** El componente no se renderiza hasta tener los datos, también en SSR, y `data` deja de ser nulo en su tipo. Un fallo de la petición se trata como un fallo de la página.
- **Sin `await`.** El componente se renderiza enseguida con `pending` en `true` y `data` en `null`. La petición no se ejecuta en SSR: empieza en el navegador cuando el componente se monta. Es el patrón para mostrar un indicador de carga:

```html
<script lang="ts">
const users = useApi("/api/users");
</script>
<template>
    <p if:when="users.pending.value">Cargando…</p>
    <p if:when="users.error.value">No se pudieron cargar los usuarios.</p>
    <ul if:when="users.data.value"><li each:of="users.data.value ?? []" each:as="user" each:key="user.id">{user.name}</li></ul>
</template>
```

Las opciones de `useApi` y el `input` de `useRpcQuery` pueden contener señales en sus campos, o ser una función que las lee. Cuando el componente ya está montado en el navegador, un cambio de esas señales vuelve a pedir los datos y actualiza `data`, `pending` y `error`; una petición anterior que sigue en curso se cancela. `refresh()` vuelve a pedir los datos con la entrada actual. Un fallo de una recarga o de `refresh()` sólo actualiza `error`: no muestra la página de error.

Las opciones son opcionales cuando el contrato no exige nada. `useApi(ruta)` admite omitirlas si el endpoint no tiene `params` y su `query` no existe o sólo tiene campos opcionales. `useRpcQuery(procedimiento)` admite omitir el `input` si el schema acepta `{}`, y entonces envía `{}`. Lo mismo vale para los clientes generados: `api.users.get()` se llama sin argumentos cuando el endpoint no tiene `params`, ni `query` obligatoria, ni cuerpo. La firma de `rpc.x(input)` no cambia.

```ts
const stats = await useRpcQuery("stats.summary");          // input opcional: envía {}
const users = await useApi("/api/users");                  // query opcional
const page = await api.users.get({ query: { page: "2" } }); // la query sigue disponible
```

#### SSR e hidratación

En SSR, el servidor renderiza la página y sus layouts, registra las peticiones de cada `await` de datos, las espera y vuelve a renderizar con los datos, hasta que ninguna pasada se suspende. Las pasadas descartadas se liberan, con su estado y sus efectos, y cada una parte del estado que dejó el loader. Las peticiones se despachan localmente por el mismo pipeline que `api.*` y `rpc.*` en SSR, así que conservan la sesión y el contexto de la petición. En una ruta `render: "stream"` se resuelven antes del primer byte, como el loader crítico. `head` se calcula con los datos del loader o del código de nivel superior de `<script server>`, no con los de estos composables: si el `<title>` depende de un dato, cárguelo allí.

Los datos resueltos viajan en el campo `resources` del payload, por clave de petición (método o procedimiento y entrada). Al hidratar, el navegador los lee de ahí de forma síncrona y no repite la petición. La entrada de un `await` de datos debe depender sólo de props, datos de la ruta y estado: si el navegador pide una clave que el servidor no cargó, la hidratación falla con un error `MEEKO_RESOURCE_MISSING` que nombra la petición. Un componente que en cada pasada pide datos nuevos detiene el render tras 10 pasadas con un error.

#### Navegación y `render: "client"`

Antes de confirmar una navegación, el navegador renderiza la página nueva sin mostrarla para descubrir y cargar sus `await` de datos. Mientras tanto la página anterior sigue visible y `useNavigation().pending` vale `true`. Si la navegación pidió el payload al servidor, los datos que este ya resolvió llegan en `resources` y no se piden otra vez. Un fallo muestra el `+error.meeko` más cercano, o `app/error.meeko`, dentro de los layouts, como un fallo del loader. Las rutas `render: "client"` usan el mismo mecanismo, entero en el navegador. En SSR, un fallo de un `await` de datos también muestra la página de error, con el mismo mensaje público que un fallo del loader.

Ese render previo es una pasada en seco. El setup de la página nueva y de los layouts que no se conservan se ejecuta, con un estado provisional que después se descarta, pero:

- ningún `effect` se ejecuta (`computed` sí calcula su valor);
- `onMounted` no se ejecuta y la continuación tras un `await` de navegador no empieza;
- `useSocket` y `socket.x` devuelven un cliente que no conecta.

Lo que se repite es el propio código del nivel superior del setup: una petición con `api.*`, una escritura externa o un contador que se incrementa ahí se ejecutan una vez más por navegación. Llévelos a `onMounted` o a un handler.

La pasada se salta si ningún componente del árbol nuevo puede esperar datos. El compilador marca cada módulo con dos datos estáticos: si su script tiene un `await` de datos y qué componentes pinta su plantilla. El navegador recorre esas marcas desde la página y los layouts nuevos y, si ninguno espera datos, confirma la navegación sin pasada previa; el setup se ejecuta entonces una sola vez. Cuentan como que pueden esperar datos un componente elegido en tiempo de ejecución (`<component is>` con una variable del setup, un elemento de `each:` o un parámetro de un snippet) y un módulo sin marcas (escrito a mano o compilado por una versión anterior). El outlet de un layout (`<component is="props.outlet">`) no se recorre, porque el navegador ya comprueba la página. Límite: un componente que no es un layout y pinta con `<component is="props.outlet">` un componente recibido en una prop llamada `outlet` tampoco se recorre; si ese componente espera datos, no se carga antes de confirmar la navegación y se monta tarde, como se describe a continuación, sin error.

#### Componentes que se montan más tarde

Un componente que aparece después de hidratar o confirmar la página (cuando un `if:` pasa a ser verdadero, en una fila nueva de `each:`, al cambiar el componente de `<component is>` o al recibir props nuevas: un componente con un `await` de datos en el nivel superior se vuelve a montar con ellas, en lugar de actualizarlas en su sitio como los demás; véase [Props reactivas](api.md#props-reactivas)) reutiliza los datos que la aplicación ya cargó. Si hace un `await` de datos que no están en caché:

- Su zona queda vacía, sin error, mientras los datos se cargan.
- La carga usa pasadas en seco bajo la raíz del componente que lo contiene, con su mismo contexto (`inject`), sin efectos, sin `onMounted` y sin conexiones de socket.
- Cuando terminan, el componente se renderiza, se hidrata y ejecuta su `onMounted`. Los datos quedan en la caché de la aplicación para los montajes siguientes.
- Si el componente se libera antes (el `if:` vuelve a ser falso o la fila desaparece), la petición se aborta y no se pinta nada, ni se ejecuta `onMounted`, ni se informa un error.
- Si la petición falla, la zona queda vacía y el error llega, con la fuente `"mounted"`, al `provideErrorHandler` más cercano o, si no hay ninguno, al `onError` de `mountClientApp`.

Para mostrar un indicador mientras tanto, use el composable sin `await` y lea `pending`, como en el ejemplo anterior. El error `MEEKO_SUSPENDED` sólo aparece al llamar a `renderToString` o `renderWithState` de un componente con un `await` de datos fuera del framework (véase [api.md](api.md#módulo-generado)).

#### Mutaciones

`useRpcMutation(procedimiento)` no hace ninguna petición hasta que se llama `mutate(input)`, nunca en SSR. `mutate` envía el token CSRF como `rpc.*`, actualiza `pending`, `data` y `error` y devuelve la salida del procedimiento, o rechaza con su error. No se puede esperar con `await` en el nivel superior (`MEEK055`): espere `mutate` dentro de un handler.

Desde `1.2`, cada envío empieza con `pending` en `true` y `error` en `null` en una sola actualización, y termina escribiendo a la vez `data` o `error` y `pending` en `false`: un `effect` que lee varias de esas señales nunca ve una mezcla del intento anterior y del nuevo. Las opciones `onSuccess(output, intento)` y `onError(error, intento)` se llaman después, con el estado ya actualizado, una vez por intento (véase [Avisos de cada intento](#avisos-de-cada-intento-onsuccess-y-onerror)).

Desde `1.2`, `useApiMutation(ruta, método)` hace lo mismo con un endpoint de API que no es `GET`. `ruta` se escribe como en `useApi` (`"/api/notes/[id]"`) y `método` es `"POST"`, `"PUT"`, `"PATCH"` o `"DELETE"`; TypeScript sólo acepta los métodos que existen para esa ruta. `mutate({ params, query, body })` recibe la entrada de la operación, comprobada contra el contrato, y se puede llamar sin argumentos si la operación no exige nada. Un endpoint `204` resuelve con `undefined`.

```html
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const note = await useApi("/api/notes/[id]", { params: { id: props.params.id } });
const save = useApiMutation("/api/notes/[id]", "PUT");
const remove = useApiMutation("/api/notes/[id]", "DELETE");
async function rename(text: string): Promise<void> {
    await save.mutate({ params: { id: props.params.id }, body: { text } });
    await note.refresh();
}
</script>
<template>
    <p if:when="save.error.value">No se pudo guardar.</p>
    <button bind:disabled="remove.pending.value" on:click="() => remove.mutate({ params: { id: props.params.id } })">Borrar</button>
</template>
```

Igual que `useRpcMutation`, se llama mientras se ejecuta el script del componente (en su nivel superior) y `await useApiMutation(...)` da `MEEK055`. Un export propio de la aplicación llamado `useApiMutation` tiene prioridad sobre el autoimport.

#### Mutaciones seguras ante reintentos

Una escritura que se queda sin respuesta (se cae la red, el servidor responde `5xx` o el proceso muere) puede haberse aplicado o no. Reintentarla a ciegas puede cobrar dos veces; descartarla puede perder una venta. Desde `1.2`, `useRpcMutation` y `useApiMutation` aceptan la opción `retrySafe`, que resuelve ese caso en el cliente y deja la deduplicación al servidor:

```ts
const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
const step = useApiMutation("/api/kitchen/items/[id]/steps", "POST", { retrySafe: { key: "kitchen:step", storage: "session" } });
```

- **Intención con clave.** `mutate(input)` crea un UUID nuevo (la clave de idempotencia), guarda la intención (la entrada, la clave y la hora) en el almacenamiento del navegador bajo `retrySafe.key` y después la envía con la cabecera `Idempotency-Key: "<uuid>"`, con el formato de cadena de Structured Fields que define el borrador del IETF. Si la página se cierra a mitad de la petición, la intención sigue guardada.
- **Sin respuesta.** Un fallo de red, un `5xx`, un `408` o un `429` conservan la intención: `mutate` rechaza con el error, `error` lo refleja y `charge.uncertain.value` muestra la intención (`{ idempotencyKey, input, startedAt }`). Se reintenta con la **misma** clave cuando el navegador vuelve a estar en línea (evento `online`), cuando se monta un componente que usa la mutación (también después de recargar) y al llamar a `charge.retry()`. Mientras se reintenta, `uncertain` conserva su valor, `pending` vale `true` y `error` vuelve a `null`.
- **Con respuesta.** Un `2xx` borra la intención y `mutate` o `retry()` resuelven con la salida. Cualquier otro `4xx` también la borra: el servidor contestó, así que no hay nada que reintentar; el `ClientError` llega a `error` y rechaza la promesa. `uncertain` vuelve a `null` en la misma actualización que escribe `data` o `error` y pone `pending` en `false`, también en los demás componentes que usan la misma clave: un `effect` que mira `uncertain` lee ya el resultado de ese intento, nunca un `error` anterior.
- **Una intención a la vez.** Mientras haya una intención incierta bajo esa clave, `mutate` rechaza con un error `MUTATION_UNCERTAIN` sin enviar nada. La aplicación decide: `retry()` la reintenta, `discard()` la olvida sin enviarla (pida antes confirmación al usuario, porque pudo registrarse) y vacía `error`, que describía el fallo de esa intención.
- **Nunca en SSR ni en seco.** El servidor nunca la envía ni la lee, y las pasadas en seco de una navegación tampoco: sólo la reintenta el componente ya montado.
- **Almacenamiento.** `storage: "local"` (por defecto) sobrevive a recargas y a cerrar el navegador; `"session"`, sólo a recargas de esa pestaña. Si el navegador bloquea el almacenamiento, la intención vive en memoria y se reintenta mientras la página siga abierta. La intención usa [`useStorage`](#estado-persistente-usestorage) por dentro, así que otra pestaña la ve llegar por el evento `storage`; si dos pestañas la reintentan a la vez, el servidor recibe la misma clave dos veces y responde lo mismo.

Use una clave de almacenamiento por mutación, que incluya lo que la distinga entre usuarios o cuentas que comparten el navegador (`` `pos:sale:${restaurant.slug}` ``). Una intención que guardó otra mutación bajo la misma clave nunca se envía a este endpoint. La entrada se guarda y se reenvía tal como viaja, en JSON.

```html
<script lang="ts">
const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
const failure = signal("");
async function pay(input: SaleInput): Promise<void> {
    failure.value = "";
    try {
        const receipt = await charge.mutate(input);
        notify(`Venta #${receipt.number} cobrada.`);
    } catch (error) {
        // Sin respuesta: queda en verificación y se reintentará con la misma clave.
        if (!charge.uncertain.value) failure.value = errorMessage(error);
    }
}
function discard(): void {
    if (window.confirm("Descarta esta venta sólo si comprobaste que no se registró.")) charge.discard();
}
</script>
<template>
    <div role="alert" if:when="charge.uncertain.value">
        <p>Venta en verificación: no tuvo respuesta. Se reintentará con la misma clave, así que no se cobrará dos veces.</p>
        <button bind:disabled="charge.pending.value" on:click="() => charge.retry().catch(() => {})">Reintentar ahora</button>
        <button on:click="discard">Descartar</button>
    </div>
    <p if:when="failure.value">{failure.value}</p>
</template>
```

##### Avisos de cada intento: `onSuccess` y `onError`

Un reintento automático (al volver la conexión o al montarse el componente) no tiene una promesa a la que esperar. Desde `1.2`, las opciones `onSuccess` y `onError` de `useRpcMutation` y `useApiMutation`, con o sin `retrySafe`, se llaman una vez por cada intento que termina, lo haya enviado quien sea, después de actualizar `data`, `error`, `pending` y `uncertain`:

```ts
const charge = useRpcMutation("sales.checkout", {
    retrySafe: { key: "pos:sale" },
    onSuccess(receipt, attempt) {
        // También tras un reintento en segundo plano: la venta en verificación se confirmó.
        if (attempt.trigger !== "mutate") notify(`Venta #${receipt.number} cobrada.`);
        ticket.clear();
    },
    onError(error, attempt) {
        // Sólo los rechazos con respuesta: sin respuesta, la venta sigue en verificación.
        if (!attempt.uncertain) notify(`La venta no se registró: ${errorMessage(error)}`);
    },
});
```

- **`intento`.** Lleva la entrada enviada (`input`), su clave (`idempotencyKey`, `null` sin `retrySafe`) y quién lo envió (`trigger`): `"mutate"`, `"retry"` (una llamada a `retry()`) o `"resume"` (el reintento automático). En `onError`, `uncertain` es `true` cuando no hubo respuesta y la intención se conserva para reintentarla; sin `retrySafe` siempre es `false`.
- **Una vez por intento.** Si `mutate` y `retry()` esperan la misma petición, o dos componentes con la misma clave la comparten, cada mutación avisa una sola vez. La promesa de `mutate` y `retry()` sigue resolviendo o rechazando como siempre: use los avisos para lo que también debe pasar tras un reintento en segundo plano y la promesa para lo propio de esa llamada.
- **Errores.** Un fallo dentro del aviso (o la promesa que rechaza si es asíncrono) llega al `provideErrorHandler` más cercano con la fuente `"event"`, como un manejador `on:`; no cambia el estado de la mutación ni el resultado de la promesa.

**En el servidor**, la clave llega validada como `context.idempotencyKey`: el UUID en minúsculas, o `undefined` si la cabecera falta o no es un UUID (se acepta con o sin comillas). Meeko no deduplica: la aplicación guarda la clave junto al resultado, con una restricción única, y ante una clave repetida devuelve el resultado que ya registró en lugar de aplicar la escritura otra vez.

```sql
ALTER TABLE sales ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX sales_idempotency_key ON sales (restaurant_id, idempotency_key);
```

```ts
// server/rpc/sales/checkout.ts
export default defineRpc({
    input: saleInput,
    output: saleReceipt,
    auth: "required",
    handler: async ({ input, context }) => {
        const key = context.idempotencyKey;
        if (!key) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED", 400);
        const { db, restaurantId } = context.services;
        // Un reintento de una venta ya registrada devuelve el mismo recibo, sin cobrar otra vez.
        const existing = await db.sales.findByKey(restaurantId, key);
        if (existing) return existing.receipt;
        // La restricción única cubre también dos reintentos simultáneos: el segundo INSERT falla
        // y vuelve a leer la venta del primero.
        return db.sales.insertOrGet(restaurantId, key, input);
    },
});
```

Acote la clave al usuario o a la cuenta, como en el índice, y, si quiere seguir el borrador del IETF al pie de la letra, responda `422` cuando la misma clave llega con otra entrada. La cabecera no cambia la seguridad: la petición sigue necesitando la sesión, el token CSRF y el `Origin` de siempre. En una petición del mismo origen el navegador la envía sin más; si un cliente de otro origen llama a la API con CORS, añada `Idempotency-Key` a `Access-Control-Allow-Headers` en su proxy o middleware.

##### Una clave propia en `api.*` y `rpc.*`

Desde `1.2`, una llamada de los clientes generados acepta `idempotencyKey`, un UUID que viaja en la misma cabecera `Idempotency-Key`. Va junto a `params`, `query`, `body` y `signal` en `api.*`, y en las opciones de `rpc.*`:

```ts
const key = crypto.randomUUID();
await api.sales.post({ body: sale, idempotencyKey: key });
await rpc.sales.checkout(sale, { idempotencyKey: key, signal: AbortSignal.timeout(10_000) });
```

Un valor que no es un UUID rechaza con `TypeError` sin enviar la petición. La clave no se guarda ni se reintenta: es la misma cabecera, y la deduplicación sigue siendo del servidor.

| Situación | Use |
| --- | --- |
| Una escritura desde un componente que debe sobrevivir a una caída de red o a una recarga, con aviso de «en verificación» | `useRpcMutation` / `useApiMutation` con `retrySafe`: Meeko crea la clave, guarda la intención y la reintenta |
| Código que no es un componente (un script, una cola propia, un service worker) o una clave que ya existe fuera de Meeko, como el id de un pedido sin conexión | `api.*` / `rpc.*` con `idempotencyKey`: usted guarda la clave y repite la llamada con ella |
| Pruebas de la deduplicación del servidor | `api.*` / `rpc.*` con `idempotencyKey`, sin escribir la cabecera a mano |

#### `load` o composables

| Necesidad | Use |
| --- | --- |
| Datos de la página que determinan `head`, una redirección, la sesión o el estado HTTP | Código de nivel superior de `<script server>` (o `load`) |
| Datos lentos y secundarios en una ruta `"stream"` | Un export, o un campo de `load`, con `defer` |
| Datos que pertenecen a un componente reutilizable o a un layout | `await useApi` / `await useRpcQuery` |
| Datos que dependen de señales del componente y se recargan al cambiar | `useApi` / `useRpcQuery`, con o sin `await` |
| Datos que pueden llegar después del primer pintado, con un indicador de carga | `useApi` / `useRpcQuery` sin `await` |
| Escrituras | `useRpcMutation` / `useApiMutation`, o `api.*`/`rpc.*` en un handler |
| Escrituras que no deben aplicarse dos veces si se pierde la respuesta (cobros, pasos de cocina) | `useRpcMutation` / `useApiMutation` con `retrySafe` |
| Estado del navegador que debe sobrevivir a una recarga (un ticket abierto, la caja elegida) | [`useStorage`](#estado-persistente-usestorage) |
| Formularios que envían datos, con validación y errores por campo | `useForm` con `api.*`/`rpc.*` en su `submit` |

Las reglas de nivel superior de estos composables (`MEEK054`, `MEEK055`) se describen en [api.md](api.md#composables-de-nivel-superior-y-await). Un host propio puede crearlos con `createUseApi(manifest, options)`, `createUseRpcQuery(manifest, options)`, `createUseRpcMutation(manifest, options)` y, desde `1.2`, `createUseApiMutation(manifest, options)` de `@meekojs/meeko/framework`, que es lo que hacen los clientes generados; los tipos `DataResource`, `LoadedResource`, `RpcMutation`, `UseApi`, `UseRpcQuery`, `UseRpcMutation`, `ApiQueryContract`, `ApiQueryOptions` y `Reactive`, y desde `1.2` `ApiMutation`, `ApiMutationInput`, `ApiMutationContract`, `UseApiMutation`, `MutationOptions`, `RetrySafeOptions`, `RetrySafeMutation` y `UncertainMutation`, describen su forma.

### Estado persistente: `useStorage`

Desde `1.2`, `useStorage(clave, inicial, opciones?)` devuelve una señal editable cuyo valor se guarda en JSON en `localStorage` (o en `sessionStorage` con `storage: "session"`). Se autoimporta en los `.meeko` desde `@meekojs/meeko/framework`, como `useState`, y se llama mientras se ejecuta el script de un componente (en su nivel superior o dentro de un composable que este llama).

```html
<script lang="ts">
const lines = useStorage("pos:ticket", [] as TicketLine[]);
const registerId = useStorage("pos:register", "");
const add = (line: TicketLine): void => { lines.value = [...lines.value, line]; };
</script>
<template><p>{lines.value.length} productos en el ticket</p></template>
```

- **SSR e hidratación sin desajustes.** El servidor nunca lee el almacenamiento: el HTML usa `inicial`, y la hidratación también. El valor guardado se aplica justo al terminar de hidratar la página, antes de `onMounted`, igual que `model` con un control que el usuario editó antes de hidratar. Un componente que se monta después (un `if:` que se abre, la página de una navegación en el navegador) ya pinta el valor guardado en su primer render. La señal no viaja en el estado del payload: su fuente es el almacenamiento.
- **Escrituras.** Cada asignación se guarda al momento, en JSON. Asigne valores nuevos (`lines.value = [...lines.value, line]`), como con cualquier señal: mutar el objeto no avisa ni guarda. Asignar `undefined` borra la clave, y la siguiente lectura vuelve a `inicial` (declare el tipo con `| undefined`, por ejemplo `useStorage<string | undefined>("draft", undefined)`).
- **Lecturas inválidas.** Un valor que no es JSON o que no cumple `schema` se ignora y la señal vale `inicial`. `schema` es un Standard Schema síncrono (Valibot, Zod…); con él, el tipo de la señal sale del schema:

  ```ts
  import * as v from "valibot";
  const theme = useStorage("theme", "light", { schema: v.picklist(["light", "dark"]) });
  ```

- **Almacenamiento bloqueado.** En modo privado, sin permiso o con la cuota llena, nunca lanza: la señal sigue funcionando en memoria. Sólo un fallo inesperado, como un valor que JSON no puede representar (`BigInt`, ciclos) o un `schema` que lanza o es asíncrono, llega al `provideErrorHandler` más cercano o al `onError` de la aplicación.
- **Otras pestañas.** Mientras algún componente usa la clave, el evento `storage` de otra pestaña actualiza la señal (con la misma validación); un `localStorage.clear()` la devuelve a `inicial`. El listener se libera con el último componente que la usa.
- **Una señal por clave.** Dos componentes que usan la misma clave y el mismo almacenamiento comparten una sola señal; el primero que la crea fija `inicial` y `schema`. Cuando ya ningún componente la usa, el siguiente vuelve a leer el almacenamiento.

| Necesidad | Use |
| --- | --- |
| Estado compartido de la aplicación, igual en SSR y en el navegador | `useState` |
| Estado del navegador que sobrevive a una recarga o se comparte entre pestañas | `useStorage` |
| Datos que pertenecen al servidor | `useApi` / `useRpcQuery` |

No guarde secretos ni tokens: el almacenamiento es legible por cualquier script de la página. Incluya en la clave lo que distinga a usuarios o cuentas que comparten navegador (`` `pos:ticket:${restaurant.slug}` ``).

### Formularios: `useForm`

Desde `1.2`, `useForm` reúne lo que repite cada formulario: una señal por campo, la validación en el navegador, `pending`, el mensaje de error, `event.preventDefault()` y los `issues` de un `400` del servidor llevados a cada campo. Se autoimporta desde `@meekojs/meeko/framework` y valida con cualquier Standard Schema, como los de Valibot.

```ts
// shared/schemas/menu.ts
import * as v from "valibot";

export const categoryInput = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, "Escribe un nombre."), v.maxLength(60, "Usa como mucho 60 caracteres.")),
  description: v.pipe(v.string(), v.trim(), v.maxLength(200, "Usa como mucho 200 caracteres.")),
});
export const categorySchema = v.object({ id: v.string(), name: v.string(), description: v.string() });
```

```ts
// server/api/menu/categories/index.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { categoryInput, categorySchema } from "../../../../shared/schemas/menu.js";
import { createCategory } from "../../../utils/menu.js";

export default defineApiRoute({
  body: categoryInput,
  response: categorySchema,
  status: 201,
  handler: async ({ body }) => {
    const category = await createCategory(body);
    if (!category) throw new ApiError("CATEGORY_EXISTS", 409);
    return category;
  },
});
```

```html
<!-- app/components/TextField.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; error?: string | undefined }>();
const value = defineModel<string>("value");
</script>
<template>
    <label>{props.label} <input model="value" bind:aria-invalid="props.error ? 'true' : null"></label>
    <p class="field-error" if:when="props.error">{props.error}</p>
</template>
```

```html
<!-- app/pages/menu/categories/new.meeko -->
<script lang="ts">
import { ClientError } from "@meekojs/meeko/framework";

const form = useForm({
    schema: categoryInput,
    initial: { name: "", description: "" },
    submit: (values) => api.menu.categories.post({ body: values }),
    errorMessage: (failure) => failure instanceof ClientError && failure.code === "CATEGORY_EXISTS"
        ? "Ya existe una categoría con ese nombre."
        : "No se pudo guardar. Revisa la conexión e inténtalo de nuevo.",
});
</script>
<template>
    <form on:submit="form.submit" novalidate>
        <p class="alert" role="alert" if:when="form.error.value">{form.error.value}</p>
        <label>Nombre <input model="form.fields.name" bind:aria-invalid="form.errors.value.name ? 'true' : null"></label>
        <p class="field-error" if:when="form.errors.value.name">{form.errors.value.name}</p>
        <TextField label="Descripción" model:value="form.fields.description" bind:error="form.errors.value.description" />
        <button bind:disabled="form.pending.value">{form.pending.value ? "Guardando…" : "Guardar"}</button>
        <p if:when="form.submitted.value">Categoría guardada.</p>
    </form>
</template>
```

`useForm(options)` recibe:

| Opción | Uso |
| --- | --- |
| `schema` | Opcional. Standard Schema que valida los campos al enviar. |
| `initial` | Valor inicial de cada campo. Con `schema`, uno por cada clave de su entrada, también las opcionales (`undefined` si no hay valor). |
| `submit(values)` | Envía los datos: recibe la salida del schema (o los valores de los campos, sin schema) y devuelve el resultado, o rechaza. |
| `errorMessage(failure)` | Opcional. Texto de `error` para un fallo sin `issues`; por defecto, `failure.message`, que en un `ClientError` es su `code`. |

y devuelve un `Form`:

| Propiedad | Valor |
| --- | --- |
| `fields` | Una `Signal` escribible por campo, para `model` en un `<input>`, `<textarea>` o `<select>` y `model:nombre` en un componente. |
| `errors` | Señal con el primer mensaje de cada ruta con error (`errors.value.name`, `errors.value["items.0.name"]`); un campo sin error no tiene clave. |
| `error` | Señal con el mensaje del formulario completo, o `null`. |
| `failure` | Señal con el error original del último envío fallido (también el `ClientError` de un `400`), o `null`. |
| `pending` | `true` mientras se valida de forma asíncrona o se ejecuta `submit`. |
| `submitted` | `true` cuando el último envío terminó bien. |
| `dirty` | `true` si algún campo difiere de los valores iniciales (los arrays y objetos se comparan por contenido). |
| `submit(event?)` | Envía el formulario; resuelve con lo que devuelve `submit`, o con `undefined`. Nunca rechaza. |
| `reset(values?)` | Vuelve a los valores iniciales, o a `initial` combinado con `values`. |

Todas las señales salvo `fields` son de sólo lectura.

**Envío.** `form.submit(event)` llama a `event.preventDefault()`, valida los campos con el schema y, si son válidos, llama a `submit` con la salida del schema. Mientras hay un envío en curso, otro `form.submit()` se ignora (resuelve `undefined`, y también evita el envío nativo del navegador). Al empezar un envío válido se borran `errors`, `error`, `failure` y `submitted`. `submit` puede devolver un valor o una promesa; para hacer algo con el resultado, envuelva la llamada:

```ts
async function save(event: SubmitEvent): Promise<void> {
    const category = await form.submit(event);
    if (category) form.reset();
}
```

**Validación.** El schema se ejecuta al enviar, no mientras se escribe. Cada issue va a `errors` con su ruta unida con `.`, como los `issues` del servidor: `"name"`, o `"items.0.name"` en un campo anidado. Si una ruta tiene varios, se conserva el primero. Un issue con ruta `""` (de una regla sobre el objeto completo) o de una clave que el formulario no tiene va a `error`. Tras un error, el campo se vuelve a validar cada vez que cambia: su mensaje se actualiza o desaparece en cuanto es válido, sin esperar al siguiente envío. Un campo sin error no se valida hasta el envío. Si el schema es asíncrono, `pending` vale `true` mientras valida.

**Errores del servidor.** Un `ClientError` con `issues` (la respuesta `400` de una entrada que no supera el schema del servidor) se reparte igual: cada mensaje en su campo y los demás en `error`. Es útil sin schema en el navegador, o cuando el servidor tiene reglas que el formulario no comprueba. Sin schema, cambiar un campo borra sus mensajes del servidor:

```ts
// app/pages/ingresar.meeko: sin schema, valida sólo el servidor
const form = useForm({
    initial: { email: "", password: "" },
    submit: (values) => api.session.post({ body: values }),
    errorMessage: (failure) => failure instanceof ClientError && failure.code === "INVALID_CREDENTIALS"
        ? "Los datos no coinciden con ninguna cuenta."
        : "No se pudo conectar con el servidor.",
});
```

```json
{ "code": "INVALID_BODY", "status": 400, "requestId": "…", "issues": [{ "path": "email", "message": "Escribe un correo válido." }, { "path": "password", "message": "Escribe tu contraseña." }] }
```

Con esa respuesta, `form.errors.value` vale `{ email: "Escribe un correo válido.", password: "Escribe tu contraseña." }`, `form.error.value` vale `null` y `form.failure.value` es el `ClientError`. Un `401` `INVALID_CREDENTIALS` deja `errors` vacío y `error` con el texto de `errorMessage`. Para marcar un campo desde el propio `submit` (por ejemplo, tras comprobar algo en el navegador), lance un `ClientError` con `issues`: `throw new ClientError("EMAIL_TAKEN", 409, undefined, [{ path: "email", message: "Ese correo ya tiene cuenta." }])`.

**Otros fallos.** Un error sin `issues` pone en `error` el texto de `errorMessage(failure)` y en `failure` el error original, y `form.submit()` resuelve `undefined`. Un `ClientError` es una respuesta prevista del servidor y no se informa en otro sitio. Cualquier otro error (un fallo de red, un error de programación en `submit` o un schema que lanza) llega además al observador de errores del componente, `provideErrorHandler` o el `onError` de `mountClientApp`, con la fuente `"event"`; sin observador, se escribe en la consola. Así un fallo inesperado nunca se pierde en silencio, aunque la plantilla no muestre `error`.

**`reset` y `dirty`.** `reset()` devuelve los campos a `initial`; `reset(values)` los lleva a `initial` combinado con `values`, por ejemplo para editar un registro existente: `form.reset({ name: category.name, description: category.description })`. Esos valores pasan a ser la referencia de `dirty`. `reset` borra `errors`, `error`, `failure` y `submitted`, y descarta el resultado de una validación o un envío que siga en curso (aunque `pending` sigue en `true` hasta que termine). Como con cualquier señal, sustituya los arrays y objetos en lugar de mutarlos: `form.fields.items.value = [...form.fields.items.value, item]`.

**Tipos.** Con `schema`, los campos tienen el tipo de la entrada del schema y `submit` recibe su salida: con un `v.transform`, el campo puede ser texto (`price: Signal<string>`) y `submit` recibir un número. Sin schema, los campos y los valores tienen el tipo de `initial`. `meeko check` comprueba `initial` contra la entrada del schema, rechaza un campo que no existe (`form.fields.nmae`) o una ruta de `errors` que no existe, y exige que el campo de un `model` tenga el tipo del control (un campo `number` no sirve para un `<input>` de texto). El tipo `Form<Values, Result>` describe el resultado, por ejemplo para pasar el formulario a un componente.

**SSR e hidratación.** En SSR el formulario se renderiza con `initial` y nunca envía: los eventos no existen en el servidor, y `form.submit()` no hace nada si se llama mientras el script se ejecuta para producir sólo HTML (SSR o la pasada en seco de una navegación). Los campos son estado del componente que no viaja en el payload: no forman parte del estado transferido ni del que conserva HMR, porque `form` no es una señal. Al hidratar, el navegador vuelve a ejecutar `useForm` con el mismo `initial`, así que `initial` debe depender sólo de props, datos de la ruta y estado, como la entrada de un `await useApi`. Lo que el usuario escriba antes de que la página se hidrate se conserva: `model` lo copia a la señal del campo al terminar la hidratación.

Llame a `useForm` en el nivel superior del `<script>`, como cualquier estado del componente. A diferencia de `useApi`, no tiene la restricción `MEEK054` ni admite `await`.

## WebSocket

`server/socket/chat.ts` exporta un `defineSocketChannel` con schemas separados para cada dirección. Los schemas expuestos al cliente deben venir de `shared/`. El generador emite un contrato público sin importar handlers privados. Cada evento se declara como `evento: schema` o, desde `1.2`, con la forma abreviada `{ kitchenChanged }` cuando el schema importado se llama como el evento; lo mismo vale para los campos de `defineApiRoute` y `defineRpc` (`{ body, response }`).

```ts
// server/socket/chat.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { chatInput, chatMessage } from "../../shared/schemas/chat.js";

export default defineSocketChannel({
  clientToServer: { message: chatInput },
  serverToClient: { message: chatMessage },
  auth: "required",
  authorize: ({ context, roomId }) => !!context.session.current && roomId === "general",
  handlers: { message: async ({ payload, emit }) => emit("message", payload) },
});
```

```ts
// Dentro de <script lang="ts"> de app/pages/chat/index.meeko
const chat = typeof window === "undefined" ? undefined : useSocket("chat", { roomId: "general" });
const unsubscribe = chat?.on("message", (message) => console.log(message.text));
const send = async () => chat?.emit("message", { text: "Hola", roomId: "general" });
```

`useSocket` sin `await` sólo puede llamarse en el navegador (en SSR lanza un error), de ahí la comprobación de `window`. Desde `1.1`, `await useSocket(...)` en el nivel superior evita esa comprobación: el setup se divide en ese punto y el resto se ejecuta sólo en el navegador, tras montar el componente y con el socket ya abierto (estado `"open"`). La plantilla sólo puede usar los nombres declarados antes del `await` (`MEEK057`), y si el socket no llega a abrirse, la continuación sigue esperando (véase [api.md](api.md#composables-de-nivel-superior-y-await)):

```html
<script lang="ts">
const messages = signal<string[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
chat.on("message", (message) => { messages.value = [...messages.value, message.text]; });
</script>
<template><p each:of="messages.value" each:as="text">{text}</p></template>
```

La firma y el contrato de `useSocket` sin `await` no cambian. `socket.chat.on(...)` y `socket.chat.emit(...)` ofrecen un registro tipado alternativo. El registro abre conexiones sólo al acceder al canal en navegador. Dentro de `mountClientApp`, cada aplicación conserva su propia conexión por canal y la cierra al desmontarse; los listeners registrados durante el setup se desuscriben al liberar su raíz. Fuera de una aplicación montada, el registro conserva su cliente compartido y el llamador debe liberar sus listeners. `useSocket` requiere una raíz de componente y libera su conexión al desmontar. Durante SSR no se abre ninguna conexión. En el navegador tampoco la abren el render que produce el HTML de un componente antes de montarlo (bajo un `if:` o al confirmar una navegación) ni las pasadas en seco: ahí `useSocket` y `socket.x` devuelven un cliente que se queda en `"connecting"`, cuyo `emit` rechaza, y la conexión la abre el montaje, una sola vez. El cliente usa WebSocket nativo, reconexión con retroceso configurable y entrega a lo sumo una vez: `emit` rechaza si está desconectado, sin cola ni reenvío. Los mensajes entrantes inválidos cierran el canal; un error del transporte se informa una vez por conexión activa y los errores de conexiones reemplazadas se ignoran. Un listener u observador de `state` que falle se informa sin impedir la ejecución de los demás listeners ni salir del callback del transporte. El cliente de bajo nivel acepta `onError(error)` para observar estos fallos; sin callback de aplicación o componente, los registra en la consola.
El registro `socket` es de alcance de aplicación: cancele listeners con la función que devuelve `on` y cierre el canal cuando ya no se necesite.

**Rechazo de autenticación o autorización.** Desde `1.1`, cuando el servidor rechaza la sesión, el cliente no reintenta: su `state` pasa al estado terminal `"unauthorized"`, deja de escuchar y el observador de errores recibe un `ClientError` con `status` `401` (código `UNAUTHENTICATED`) o `403` (`FORBIDDEN`), no el error genérico del transporte. Lo detecta en los códigos de cierre `4401` y `4403`, en el código de política del hub (`1008`, con el motivo `Unauthorized`, `Session expired` o `Session revoked`) y en un handshake rechazado con `401` o `403` cuando la implementación de `WebSocket` expone el estado HTTP, como el paquete `ws` en Node mediante `webSocketFactory`. `close()` pasa un cliente `"unauthorized"` a `"closed"`; para volver a intentarlo, cree otro cliente (en un componente, al volver a montarlo).

**Cierres `4401` y `4403` del handshake.** El `WebSocket` del navegador (y el global de Node) no expone el estado HTTP de un handshake rechazado, así que desde `1.1` los adaptadores de Meeko no responden con `401` ni `403` a un rechazo de sesión o de autorización del canal. Si la comprobación previa del hub rechaza la sesión (un canal `auth: "required"` sin sesión, `401`) o la autorización (`authorize` devuelve `false`, `403`), el servidor acepta el upgrade y cierra en seguida con `4401` (motivo «Autenticación requerida») o `4403` («Acceso denegado»). No llama a ningún handler ni entrega mensajes, y el motivo es un texto fijo, sin datos de la sesión. El cliente llega así a `"unauthorized"` también en el navegador, sin reintentar. Como el upgrade se completa, `state` puede pasar un instante por `"open"` antes del cierre, y un `emit` hecho en ese momento se descarta. Un hub que vuelve a autorizar una conexión ya aceptada, como el Durable Object de una sala al despertar, cierra del mismo modo con `4401` o `4403`.

Los demás rechazos del handshake mantienen su respuesta HTTP, que el navegador ve como un fallo de red y reintenta con retroceso: nombre de canal inválido, método o petición que no es de upgrade (`400`), canal inexistente (`404`), los límites (como `431` en Cloudflare) y el Origin no permitido (`403` `INVALID_ORIGIN`). El Origin es una política de la petición, no la autorización del canal: un origen ajeno nunca completa un upgrade ni llega a la comprobación de la sesión, de modo que tampoco puede distinguir un `4401` de un `4403`.

`serveNode` conecta `attachNodeWebSocketServer` al mismo servidor HTTP cuando la aplicación declara canales. El adaptador Node usa `ws` para framing y upgrades; Bun usa el WebSocket nativo de `Bun.serve` y Deno `Deno.upgradeWebSocket` (véanse sus límites en [Bun](#bun) y [Deno](#deno)), y Cloudflare Workers aloja cada sala en un Durable Object con hibernación (véase [Cloudflare Workers](#cloudflare-workers)). Todos comparten `createSocketUpgradeHandler`, que comprueba ruta, Origin y sesión antes del upgrade y devuelve `{ action: "reject", status, close }` en los rechazos de sesión o autorización. Un adaptador propio que atiende `close` hace el upgrade y cierra con `close.code` y `close.reason`; uno escrito para `1.0`, que lo ignora, sigue respondiendo `status`. El hub existente valida Origin, sesión, canal, sala, evento y payload; aplica límites de mensaje/buffer, heartbeat y cierre ordenado. Tras un proxy, el mismo `publicOrigin` de `server/runtime.ts` o `MEEKO_PUBLIC_ORIGIN` rige la comprobación de Origin de HTTP y de Socket.

### Clientes con URL y contrato explícitos

El autoimport `useSocket("canal", opciones)` cubre los canales de la propia aplicación. Para otra URL o un contrato propio, `@meekojs/meeko/framework` ofrece dos funciones con la firma `(url, contract, options)`:

- `useSocketClient` (desde `1.1`) liga el cliente a la raíz del componente actual, igual que el autoimport: lanza un error en SSR, no conecta en un render que sólo produce HTML, usa el observador de errores más cercano y cierra la conexión al desmontar. Admite `await useSocketClient(...)` en el nivel superior del `<script>`.
- `createSocketClient` crea un cliente independiente, también fuera de un componente; el llamador lo cierra con `close()`.

```ts
import { useSocketClient } from "@meekojs/meeko/framework";

// Dentro de <script lang="ts"> de un componente
const feed = await useSocketClient("wss://feed.example.com/_meeko/socket/prices", pricesContract);
feed.on("price", (price) => console.log(price.symbol, price.value));
```

Hasta `1.0` esta función se exportaba como `useSocket` desde `@meekojs/meeko/framework`, con el mismo nombre que el autoimport generado y otra firma. Ese export sigue disponible como alias obsoleto de `useSocketClient` (es la misma función) durante toda la serie 1.x y se retirará en `2.0`. El autoimport `useSocket("canal")` de los clientes generados no está obsoleto. En un proyecto sin clientes generados, el autoimport `useSocket` resuelve a `useSocketClient`.

### Broadcast desde el servidor

Desde `1.2`, el autoimport `socket` del código de servidor (API, RPC, `<script server>`, middleware y handlers de Socket) añade a cada canal `broadcast(roomId, event, payload)`, tipado con el contrato generado del canal. Sustituye a publicar a mano en el `SocketPubSub` del runtime, que no comprueba el evento ni el payload:

```ts
// server/socket/operations.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { kitchenChanged, subscribe } from "../../shared/schemas/operations.js";

export default defineSocketChannel({
  clientToServer: { subscribe },
  serverToClient: { kitchenChanged },
});
```

```ts
// server/api/orders/[id]/ready.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { orderParams, orderSchema } from "../../../../shared/schemas/order.js";
import { markReady } from "../../../utils/orders.js";

export default defineApiRoute({
  params: orderParams,
  response: orderSchema,
  handler: async ({ params }) => {
    const order = await markReady(params.id);
    await socket.operations.broadcast(order.storeId, "kitchenChanged", { orderId: order.id, status: "ready" });
    return order;
  },
});
```

- **Mismas comprobaciones que `hub.broadcast`.** El hub valida con la definición del canal: un evento que no está en `serverToClient` rechaza con `UNKNOWN_SOCKET_EVENT` (404), un payload que no cumple su schema con `INVALID_SOCKET_PAYLOAD` (400) y un mensaje serializado mayor que `socket.maxMessageBytes` con `SOCKET_LIMIT_EXCEEDED` (413), siempre antes de publicar. Se resuelve cuando el broker acepta el mensaje; véase [Broadcast y varias instancias](#broadcast-y-varias-instancias). Dentro de un handler de API o RPC, un rechazo no capturado es la respuesta de error, con ese código y estado.
- **Sala.** `roomId` es la sala de `?room=`; las conexiones sin sala usan `""`.
- **Qué hub.** `broadcast` publica en el hub de la aplicación que atiende la petición HTTP en curso, también desde su trabajo asíncrono (como `platform.waitUntil` o un temporizador iniciado en la petición), o en el hub del handler de Socket en curso. Funciona igual en Node, Bun, Deno y Cloudflare Workers, donde el broker es el Durable Object de cada sala.
- **Fuera de una petición.** Una tarea que empieza al arrancar, fuera de cualquier petición, no tiene aplicación actual y `broadcast` lanza un error. Cree un registro con el hub explícito: `createServerSocketRegistry(socketContracts, { hub: () => app.socket?.hub })` de `@meekojs/meeko/server`, o use `app.socket.hub.broadcast(canal, sala, evento, payload)` sin tipos.
- **Sólo servidor.** En el navegador `socket.<canal>` sigue siendo el cliente WebSocket y no tiene `broadcast`. En el servidor, `on`, `emit`, `state` y `close` de `socket.<canal>` lanzan un error, porque durante SSR no hay conexión. Hasta `1.1`, leer `socket.<canal>` en el servidor ya lanzaba ese error.

### Broadcast y varias instancias

`hub.broadcast(channel, room, event, payload)` valida el evento y el payload, y se resuelve cuando el broker acepta el mensaje. No espera a que lleguen a los peers ni informa de sus fallos al emisor. Sólo rechaza si el evento no existe, el payload no cumple su schema, el mensaje es demasiado grande o el broker no acepta la publicación.

- **`broadcast` rechaza por tamaño.** El mensaje se mide ya serializado con `serializeJson`, que escribe `<`, `>` y `&` como secuencias de 6 bytes; si supera `maxMessageBytes` del hub (64 KiB por defecto), `broadcast` rechaza con `SOCKET_LIMIT_EXCEEDED` (413) antes de publicar y ningún peer se cierra. Así, un mensaje de cliente de unos 11 KB lleno de `<` no puede reenviarse tal cual. Un receptor con un `maxMessageBytes` menor que el del emisor sigue cerrando su peer con `1009`.
- **Entrega a lo sumo una vez por peer.** No hay reenvío: un mensaje publicado mientras una instancia está desconectada del broker se pierde. Cada peer recibe los mensajes de una instancia en el orden de llegada.
- **Cola acotada por peer.** Las entregas a un peer se procesan de una en una. Si un peer acumula más de `maxPendingDeliveries` entregas pendientes (256 por defecto, contando la que está en curso), se cierra con `1013` ("try again later") y el error `SOCKET_BACKLOG_EXCEEDED` (503) llega a `onDeliveryError`, en lugar de crecer la memoria sin límite.
- **Comprobaciones en el receptor.** Cada instancia receptora vuelve a validar el payload con el schema y ejecuta `authorize` y `authorizeSend` antes de enviar a cada peer local. La sesión no se relee en cada entrega: una revocación cierra el peer de inmediato mediante `SessionHandle.signal`, y el resto de cambios (caducidad, rotación o un borrado sin aviso) se detecta al releer el store, como mucho una vez cada `sessionRefreshMs` por peer (1000 ms por defecto; `0` relee en cada entrega). Cada evento del cliente relee siempre la sesión.
- **`authorizeSend` filtra.** Si devuelve `false`, ese peer no recibe el broadcast y sigue conectado. En un `emit` directo, el mismo rechazo lanza `FORBIDDEN`.
- **Un peer que falla se cierra.** Puede fallar por sesión caducada, `authorize` rechazado, límite de tamaño, cola llena o error de envío. El peer se cierra con `1008` (fallo de política), `1009` (tamaño), `1013` (cola llena) o `1011` (error interno) y se desuscribe. El error llega a `SocketHubOptions.onDeliveryError(error, { channel, room, event })` de la instancia que tiene ese peer. Un payload que no cumple el schema en el receptor se descarta y se informa sin cerrar al peer.
- **Observador por defecto.** `createServerApp` envía `onDeliveryError` al `onError` del runtime con un ID nuevo; `socket.onDeliveryError` de `server/runtime.ts` lo sustituye. Sin observador, el hub usa `console.error`.

`LocalSocketPubSub` cubre una sola instancia, y su `publish` también espera los intentos de entrega locales. Para varias instancias o procesos, use `RedisSocketPubSub`:

```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  const subscriber = redis.duplicate(); // conexión dedicada en modo suscriptor
  await subscriber.connect();
  return {
    sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber }), production: production && !prerendering }),
    socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:" }) },
    close: async () => { await subscriber.quit(); await redis.quit(); },
  };
});
```

- **Clientes.** `publisher` y `subscriber` siguen la interfaz de node-redis 4 o posterior (`publish`, `subscribe(channel, listener)`, `unsubscribe(channel, listener)`); el suscriptor necesita su propia conexión. La aplicación abre y cierra ambos clientes.
- **Canales Redis.** Cada par canal/sala usa el canal `<prefix>socket:<canal>:<sala>`, con canal y sala codificados con `encodeURIComponent`. Cada instancia se suscribe una sola vez por sala mientras tenga peers locales en ella y se desuscribe al irse el último. `hub.accept` se resuelve cuando Redis confirma la suscripción.
- **Formato.** El mensaje viaja como `{ v: 1, event, payload }`, serializado con `serializeJson`. `publish` rechaza con `SOCKET_LIMIT_EXCEEDED` (413) los mensajes de más de `maxMessageBytes` (1 MiB por defecto) antes de enviarlos a Redis. El receptor descarta los mensajes mal formados o con otra versión y los informa a `onError` de `RedisSocketPubSub` (por defecto, `console.error`).
- **Redis Cluster.** Con Redis 7 o posterior, `sharded: true` usa `SPUBLISH`/`SSUBSCRIBE`/`SUNSUBSCRIBE`, que en un clúster mantienen cada sala dentro de su shard. Los clientes deben ofrecer `sPublish`, `sSubscribe` y `sUnsubscribe`.

Una implementación propia de `SocketPubSub` debe cumplir el mismo contrato:

- `publish(channel, room, { event, payload })` se resuelve cuando el broker acepta el mensaje.
- `subscribe(channel, room, listener)` devuelve, o promete, una función `Unsubscribe` que puede ser asíncrona.
- Los listeners del hub nunca rechazan, así que el broker no debe agregar sus errores.

## Runtime de servidor

`server/runtime.ts` exporta por defecto `defineServerRuntime(factory)`. Meeko llama a la fábrica una vez por proceso con `{ env, production, platform, prerendering }` y espera los recursos de la aplicación:

```ts
import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";
import { createDatabase } from "./utils/database.js";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const db = await createDatabase(env.DATABASE_URL);
  return {
    sessions: new SessionManager({ store: db.sessionStore(), production: production && !prerendering }),
    services: (request, { platform }) => ({ db, region: platform.env.REGION }),
    socket: { allowedOrigins: [], maxMessageBytes: 64 * 1024 },
    publicOrigin: env.MEEKO_PUBLIC_ORIGIN,
    onError: (error, requestId) => console.error("request failed", requestId, error),
    close: () => db.close(),
  };
});
```

- `sessions` es opcional desde `1.2`. Sin `server/runtime.ts`, o si no devuelve `sessions`, Meeko las crea: en memoria en desarrollo y en Redis con `MEEKO_REDIS_URL` en producción (véase [Sesiones sin configuración](#sesiones-sin-configuración)). Unas `sessions` explícitas siempre ganan.
- `services` puede ser un objeto compartido o una función por petición; llega a páginas, API, RPC y Socket como `RequestContext.services`.
- `RequestContext.platform` expone `{ name, env, waitUntil(promise) }`. En Node, `serveNode` espera las tareas registradas con `waitUntil` antes de cerrar la aplicación. Las tareas registradas fuera de una petición HTTP, como en callbacks de Socket, quedan a cargo de la aplicación: `app.close()` las espera y sus fallos llegan al observador `onError` del runtime en lugar de la consola.
- `publicOrigin` es el origen público de la aplicación, por ejemplo `https://example.com` tras un proxy que termina TLS. HTTP y Socket comparan `Origin` con ese valor; `MEEKO_PUBLIC_ORIGIN` lo sustituye en `meeko dev` y en las salidas de Node, Bun, Deno y Workers. Sin `publicOrigin`, Socket usa la dirección en la que escucha el servidor. Si esa dirección o el `publicOrigin` es de loopback, Socket acepta también los otros nombres de loopback (`localhost`, `127.0.0.1`, `[::1]`) con el mismo esquema y puerto. Esto supone que ningún otro proceso escucha en ese puerto con otra dirección de loopback; si ocurre, configure `publicOrigin` con un origen que no sea de loopback o cambie el puerto.
- `onError` recibe los fallos internos con su ID de petición; sin él, Meeko registra el nombre del error y el ID, y en desarrollo también el error completo. También recibe los fallos de entrega de Socket, salvo que `socket.onDeliveryError` los observe por separado.
- `socket.pubsub` elige el broker de broadcast; `socket.maxPendingDeliveries` y `socket.sessionRefreshMs` limitan la cola de cada peer y la frecuencia con que sus entregas releen la sesión. Véase [Broadcast y varias instancias](#broadcast-y-varias-instancias).
- `close` se ejecuta después de cerrar las sesiones, al detener el servidor.

`createServerApp({ manifest, load, runtime, production })` de `@meekojs/meeko/server` crea la misma aplicación a partir de un manifiesto y un cargador de módulos, y expone `fetch(request, platform?)`, `socket`, `publicOrigin`, `reportError` y `close()`. El entry generado por `meeko build` la usa; un host propio puede servirla con `serveNode(app, { host, port, publicOrigin, handleSignals, shutdownTimeout })` de `@meekojs/meeko/node`. Si el servidor arranca pero falla la conexión de Socket, `serveNode` libera el puerto y cierra la aplicación antes de propagar el error.

## Autenticación

Desde `1.2`, Meeko se ocupa de las piezas delicadas de un inicio de sesión: cookie opaca `HttpOnly`, `Secure` y host-only, sesiones en Redis entre instancias con revocación, Origin y CSRF, contraseñas con scrypt, límite de intentos y tipos de la sesión. La aplicación sólo decide quién puede entrar. Un panel privado para una cuenta queda así:

**1. Variables** (`.env` en desarrollo, ignorado por git; en producción, las del entorno):

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com       # el origen exacto tras el proxy HTTPS
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_TRUST_PROXY=1                           # un proxy (Traefik, Caddy, nginx) delante
ADMIN_USERNAME=ada
ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…       # npx meeko auth hash
```

Las dos últimas son de la aplicación, sin el prefijo `MEEKO_`, que queda reservado. Instale el cliente Redis con `npm install redis`; en desarrollo las sesiones viven en memoria y no hace falta Redis. No hay `server/runtime.ts`: véase [Sesiones sin configuración](#sesiones-sin-configuración).

**2. El tipo de la sesión**, una sola vez para páginas, API, RPC y Socket:

```ts
// server/types/session.d.ts
export {};
declare module "@meekojs/meeko/server" {
  interface MeekoSession { user: string; role: "owner" }
}
```

**3. Inicio y cierre de sesión:**

```ts
// server/api/auth/login.post.ts
import { verifyPassword } from "@meekojs/meeko/password";
import { loginInput, okResult } from "../../../shared/schemas/auth.js";

export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ body, context }) => {
    const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? "");
    if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.session.create({ user: body.username, role: "owner" });
    return { ok: true as const };
  },
});
```

```ts
// server/api/auth/logout.post.ts
export default defineApiRoute({
  auth: "required",
  status: 204,
  handler: async ({ context }) => { await context.session.revoke(); },
});
```

`verifyPassword` se ejecuta siempre, también con un usuario incorrecto, para que el tiempo de respuesta no revele cuál de los dos falló. `defineApiRoute` y `ApiError` se autoimportan en `server/`. Desde el navegador, `await api.auth.login.post({ body })` y `await api.auth.logout.post()`: el cliente envía Origin y el token CSRF.

**4. Una página protegida:**

```html
<!-- app/pages/dashboard.meeko -->
<script server lang="ts">
const { context } = usePage();
const session = context.session.current;
if (session?.data.role !== "owner") redirect("/login");
export const user = session.data.user;
</script>

<template>
  <h1>Hola, {user}</h1>
</template>
```

Lo que hace Meeko por usted en este ejemplo:

- La cookie `__Host-meeko.sid` es opaca, `HttpOnly`, `Secure`, `SameSite=Lax` y host-only; `MEEKO_SESSION_TTL` y `MEEKO_SESSION_SAMESITE` la ajustan. El ID cambia al iniciar sesión y la familia completa se revoca al cerrarla, también en las demás instancias.
- `origin: "required"` y, aunque falte, el propio `session.create()` impiden el *login CSRF* (véase [Origin en mutaciones anónimas](#origin-en-mutaciones-anónimas)); `auth: "required"` y el token CSRF protegen el cierre de sesión.
- `rateLimit` cuenta los intentos por IP en Redis, y `MEEKO_TRUST_PROXY` hace que la IP sea la del cliente y no la del proxy.
- `verifyPassword` compara en tiempo constante y acepta los hashes que ya tenga con el mismo formato.

### Tipos de la sesión: `MeekoSession`

Sin declaración, `context.session.current.data` es `unknown`, como hasta `1.1`, y `session.create(data)` acepta cualquier valor serializable. Desde `1.2`, una aumentación de módulo de la interfaz `MeekoSession` de `@meekojs/meeko/server` fija la forma en toda la aplicación: `RequestContext.session` pasa a ser `SessionHandle<MeekoSession>`, así que `context.session.current?.data` y `create(data)` quedan tipados en el `<script server>` de las páginas (`usePage().context`), en API, RPC y Socket, y en `authorize` y `locals`. El tipo resultante se llama `SessionData`. Declárela en un archivo de `server/`, que comprueba el proyecto TypeScript del servidor, y con `export {}` para que sea un módulo. El tipo no valida en ejecución: si cambia la forma, las sesiones guardadas antes conservan la anterior hasta que caducan o se crean de nuevo.

### Contraseñas

`@meekojs/meeko/password` (desde `1.2`) guarda y comprueba contraseñas con scrypt:

- `hashPassword(password)` devuelve `scrypt$<N>$<r>$<p>$<sal>$<hash>`, con N = 2^17, r = 8, p = 1 (128 MiB por cálculo), una sal aleatoria de 16 bytes y una clave de 32, ambas en base64url. El formato describe sus propios parámetros, así que un hash guardado sigue siendo válido aunque cambien los valores por defecto.
- `verifyPassword(password, hash)` recalcula con los parámetros del hash y compara en tiempo constante (`timingSafeEqual`). Acepta los hashes escritos a mano con el mismo formato, como `scrypt$131072$8$1$…` con una sal de 32 bytes y una clave de 64, sin regenerarlos. Un hash mal formado o con parámetros fuera de los límites (N potencia de dos entre 2^10 y 2^20, `r` hasta 32, `p` hasta 16) lanza `TypeError`: es un fallo de configuración, no una contraseña incorrecta. Una contraseña vacía o de más de 4096 bytes devuelve `false` sin calcular nada.
- `needsRehash(hash)` indica si el hash usa parámetros más débiles que los actuales; tras un inicio de sesión correcto, guarde `await hashPassword(password)` en su lugar.

Como mucho se calculan dos hashes a la vez por proceso, para acotar la memoria (256 MiB) y no ocupar todos los hilos de `libuv`; combine el inicio de sesión con [`rateLimit`](#límite-de-peticiones-ratelimit). Cuando el usuario no existe, compare igualmente contra un hash fijo para que el tiempo de respuesta no revele qué cuentas existen.

**Por qué una subruta aparte.** Web Crypto, la única criptografía de `@meekojs/meeko/server`, no ofrece funciones de derivación costosas en memoria (scrypt, Argon2), y una implementación en JavaScript sería decenas de veces más lenta, lo que obliga a bajar el coste. `node:crypto` las implementa en código nativo y existe en Node, Bun y Deno, así que `/password` lo importa y `/server` sigue siendo portable (Web APIs y `node:async_hooks`). No vale para Cloudflare Workers: aunque `nodejs_compat` ofrece scrypt, los 128 MiB de un cálculo con estos parámetros agotan la memoria de un aislado; en Workers, delegue la verificación en un servicio externo.

Para obtener un hash sin escribir código:

```sh
npx meeko auth hash                       # pide la contraseña dos veces, sin mostrarla
printf '%s' "$PASSWORD" | npx meeko auth hash   # o la lee de stdin
```

El comando escribe en stdout sólo la línea del hash, lista para `.env` (`ADMIN_PASSWORD_HASH=…`); los avisos van a stderr.

### Límite de peticiones: `rateLimit`

Desde `1.2`, `defineApiRoute` y `defineRpc` aceptan `rateLimit: { limit, window, key? }`: como mucho `limit` peticiones por ventana fija de `window` (milisegundos o un texto como `"30s"`, `"5m"`, `"1h"`). La petición que lo supera recibe `429 RATE_LIMITED` con `Retry-After` (segundos hasta la ventana siguiente), sin validar la entrada ni ejecutar el handler. Se comprueba tras Origin y CSRF y antes de `auth`, `authorize`, la entrada y `locals`, así que también frena a los clientes anónimos.

```ts
export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ body, context }) => { /* … */ },
});
```

- **Clave.** Sin `key`, cada IP de cliente tiene su contador por ruta (las IPv6 por su red /64, porque un cliente dispone de toda una /64). La IP es `context.clientAddress`: la de la conexión que entrega el adaptador (Node, Bun, Deno; en Workers, `CF-Connecting-IP`, que fija Cloudflare). Si Meeko no la conoce, todos los clientes comparten el contador de la ruta. `key: (context) => string` cuenta por otro sujeto, como el usuario de la sesión; se ejecuta antes de validar la entrada, así que no recibe el cuerpo. Una ruta dinámica (`/api/users/[id]`) tiene un solo contador para todos sus valores.
- **Proxies.** `X-Forwarded-For` nunca se lee salvo con `MEEKO_TRUST_PROXY`, porque cualquier cliente puede enviarlo. Con un número `n`, la IP es la entrada que añadió el proxy de confianza más externo, la `n`-ésima desde la derecha: con un único proxy (Traefik en Coolify, Caddy, nginx) use `MEEKO_TRUST_PROXY=1`, y las entradas que el cliente falsificó a la izquierda se ignoran. `true` toma la entrada de la izquierda: sólo es seguro si el proxy de entrada sustituye la cabecera en lugar de añadirse. Sin la variable, tras un proxy todos los clientes comparten el contador del proxy. Un valor no válido detiene el arranque.
- **Almacenamiento.** Los contadores viven en el store de sesiones: en memoria con `MemorySessionStore` y, con `RedisSessionStore` (también el de [Sesiones sin configuración](#sesiones-sin-configuración)), en `<prefix>ratelimit:<resumen>`, con un script Lua que hace `INCR` y `PEXPIRE` de forma atómica para todas las instancias. La clave guarda un resumen SHA-256 de la ruta y el sujeto, nunca la IP ni la clave en claro. Si Redis falla, la petición se rechaza con `500` (*fail closed*) y el error llega a `onError`.
- **Store propio.** Un `SessionStore` puede implementar `rateLimit(key, windowMs)`, que cuenta una petición en la ventana fija `key` y resuelve `{ count, resetInMs }` (tipo `RateLimitHit`); debe ser atómico entre instancias y rechazar si falla. `SqlSessionStore` (y D1) no lo implementa: con él, los contadores viven en la memoria de cada instancia o aislado, y Meeko lo avisa una vez en producción.
- Un `limit` que no es un entero positivo, una `window` no válida o una `key` vacía responden `500 INVALID_RATE_LIMIT`.

## Sesiones y seguridad

Las sesiones usan IDs opacos aleatorios en cookies `HttpOnly`, host-only, `Secure` por defecto y `SameSite=Lax` por defecto. Cada sesión nueva recibe también un `familyId` opaco que permanece al rotar su ID. `SessionHandle` permite crear, rotar y revocar; la rotación y la revocación de toda la familia requieren operaciones atómicas en el store. Así, un logout iniciado con un handle anterior invalida el ID activo aunque otra petición ya lo haya rotado. Las mutaciones autenticadas con cookie verifican Origin y `x-meeko-csrf`. Las respuestas SSR y API entregan el token CSRF por meta o cabecera same-origin. La aplicación debe definir verificación de identidad y reglas de autorización; Meeko no guarda secretos de autenticación en el navegador.

`MemorySessionStore` sirve sólo en desarrollo. `SessionManager({ production: true, store })` exige `persistent: true`, `replace` atómico y `revokeFamily`; una aplicación sin `MEEKO_REDIS_URL` ni `sessions` propias no arranca en producción. `RedisSessionStore` acepta un cliente compatible con `get`, `set` con `PX`, `del` y `eval`; usa un índice de familia con el TTL de la sesión activa. Use un prefijo propio por aplicación y entorno. Los registros Redis anteriores sin `familyId` siguen siendo legibles y adquieren una familia en la primera rotación. `SqlSessionStore` acepta un `SqlSessionDriver` con `read`, `write`, `remove`, `replace` transaccional, `revokeFamily` y `close` opcional. El ejemplo ejecutable en `tests/fixtures/fullstack-consumer/server/runtime.ts` usa SQLite real; el framework no depende de una librería SQL ni de un motor de base de datos concreto. `SessionManager.close()` libera el store cuando el host es propietario del recurso.

Todo `SessionStore` persistente personalizado debe almacenar `familyId` y garantizar que `replace` y `revokeFamily` sean atómicos frente a peticiones concurrentes. Antes de actualizar, migre los registros existentes y los índices necesarios para localizar la sesión activa por familia. No despliegue el nuevo runtime sobre un store antiguo: en producción la construcción falla de forma deliberada cuando no puede garantizar rotación y revocación familiar seguras. Desde `1.2`, un store puede implementar además `rateLimit(key, windowMs)` para los contadores de [`rateLimit`](#límite-de-peticiones-ratelimit).

**Migración de drivers SQL existentes:** añada una columna de familia a la tabla (por ejemplo, `family_id`), rellene las filas existentes con `family_id = id` y cree un índice único sobre ella. `read` y `write` deben transferir `SqlSessionRow.familyId`; `replace` debe comprobar la misma familia y sustituir la fila en una transacción; `revokeFamily(familyId)` debe borrar la fila activa por familia. Migre el esquema antes de iniciar la nueva versión. Un driver antiguo sin `revokeFamily` falla al construir `SqlSessionStore`; no se admite silenciosamente en producción.

Sin `server/runtime.ts`, Meeko hace todo esto por usted con `MEEKO_REDIS_URL` (véase la sección siguiente). Para un cliente propio, instale `redis` en la aplicación, cree el cliente con `createClient({ url: process.env.MEEKO_REDIS_URL })`, llame `connect()` antes de servir tráfico y páselo a `RedisSessionStore` con un prefijo propio. El host debe cerrar su cliente con `quit()` al detenerse; `SessionManager.close()` cierra el store, pero no se apropia de clientes externos. La prueba de integración `tests/redis.integration.ts` usa un namespace aleatorio y sólo borra sus propias claves. Se ejecuta contra un Redis real con `MEEKO_REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx --test tests/redis.integration.ts`; CI dispone de un servicio Redis dedicado. La prueba local requiere un Redis accesible y no usa bases ajenas.

### Sesiones sin configuración

Desde `1.2`, una aplicación no necesita `server/runtime.ts` para tener sesiones seguras. Si el archivo no existe, o su fábrica no devuelve `sessions`, `createServerApp` las crea:

- **Desarrollo** (`meeko dev`) y el prerender de `meeko build`: `MemorySessionStore`.
- **Producción** en Node, Bun y Deno: con `MEEKO_REDIS_URL` (`redis://` o `rediss://`), Meeko importa el paquete `redis` del proyecto, conecta un cliente y un suscriptor dedicado (`client.duplicate()`) **antes de servir tráfico**, crea un `RedisSessionStore` con revocación entre instancias y cierra ambas conexiones al detenerse, después del `close` de la aplicación. Instale el paquete con `npm install redis`: el build sólo lo incluye si está instalado, y sin él el arranque falla con un mensaje que lo pide. Si la primera conexión falla, el arranque falla; si se corta después, el cliente reconecta y, mientras tanto, las peticiones que leen la sesión fallan en el acto en lugar de esperar (*fail closed*). Los mensajes nunca incluyen la URL, que lleva la contraseña.
- **Producción sin `MEEKO_REDIS_URL`**: la aplicación no arranca, como hasta ahora. En Workers no hay TCP, así que `MEEKO_REDIS_URL` también detiene el arranque: declare un `SessionManager` con D1 o con Upstash (véase [Cloudflare Workers](#cloudflare-workers)).

Las claves usan el prefijo de `MEEKO_REDIS_PREFIX` o, por defecto, `meeko:<name de package.json>:prod:`. `MEEKO_SESSION_TTL` (`30m`, `12h`, `7d`…; 7 días por defecto) y `MEEKO_SESSION_SAMESITE` (`Lax` por defecto, o `Strict`) ajustan esas sesiones, también en desarrollo; un valor no válido detiene el arranque. La cookie conserva los valores seguros: `__Host-meeko.sid`, `Secure`, `HttpOnly`, `Path=/` y sin `Domain` (host-only). Con unas `sessions` propias en `server/runtime.ts`, esas variables no se aplican y Meeko lo avisa una vez.

### Duración de cada sesión

`SessionManager({ ttlMs })` fija la duración por defecto (7 días). Desde `1.2`, `context.session.create(data, { ttlMs })` da a una sesión su propia duración, un entero positivo de milisegundos; por ejemplo, 30 días para los propietarios y 12 horas para el personal. Un valor no válido rechaza con `RangeError` sin tocar el store. Esa duración fija el `Max-Age` de la cookie y la caducidad en el store (`expiresAt`, que Redis aplica con `PX` y SQL y D1 guardan en `expires_at`), se guarda en `SessionRecord.ttlMs` y `rotate()` la conserva: cada rotación cuenta de nuevo esa duración desde el momento de rotar.

```ts
const ttlMs = user.role === "staff" ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
await context.session.create({ userId: user.id }, { ttlMs });
```

Las sesiones creadas sin `ttlMs`, y los registros escritos antes de `1.2`, usan la duración del gestor también al rotar. `SqlSessionStore` no necesita una columna nueva: deduce la duración de cada fila como `expiresAt - createdAt`, así que una fila anterior conserva al rotar la duración con la que se creó. Un `SessionStore` propio debe conservar el campo `ttlMs` del registro si quiere que la duración sobreviva a la rotación; si lo pierde, la sesión rota con la duración del gestor.

### Origin en mutaciones anónimas

Origin y `x-meeko-csrf` se comprueban sólo en las mutaciones que llegan con una cookie de sesión. Un endpoint que crea la sesión, como el inicio de sesión, se llama sin ella y queda expuesto al *login CSRF*: otra web podría iniciar sesión en el navegador de la víctima con una cuenta del atacante. Desde `1.2`, `origin: "required"` en `defineApiRoute` o `defineRpc` exige un `Origin` permitido aunque no haya sesión:

```ts
// server/rpc/auth/login.ts
export default defineRpc({
  input: loginInput,
  output: loginOutput,
  origin: "required",
  handler: async ({ input, context }) => { /* … */ },
});
```

En un endpoint de API se comprueban los métodos `POST`, `PUT`, `PATCH` y `DELETE` (un `GET` no lleva `Origin` al navegar); en un RPC, todas las llamadas. Se acepta el origen de la petición, que tras `createServerApp` es el `publicOrigin` configurado, y los de `SessionManager({ allowedOrigins })`: la misma regla que en las mutaciones autenticadas. Un `Origin` ausente, `null` u otro distinto responde `403 INVALID_ORIGIN` antes de leer o validar la entrada y de ejecutar el handler. Las llamadas de los clientes `api.*` y `rpc.*` durante el SSR envían el origen de la petición en curso, así que el despacho local sigue funcionando. Una llamada desde fuera del navegador (una app nativa o un script) debe enviar una cabecera `Origin` permitida.

**`session.create()` protege el inicio de sesión aunque falte `origin: "required"`.** Desde `1.2`, en una petición `POST`, `PUT`, `PATCH` o `DELETE`, `context.session.create()` sólo crea la sesión si el `Origin` de esa petición ya se comprobó (con `origin: "required"`, o en una mutación autenticada que superó Origin y CSRF) o si está permitido en ese momento; si no, rechaza con `403 INVALID_ORIGIN` sin tocar el store ni enviar la cookie. Los navegadores envían `Origin` en toda petición `POST`, también en las de su propio origen, así que un inicio de sesión desde la propia aplicación sigue funcionando sin cambios. Lo que cambia:

- Un script, una prueba o una app nativa que inicia sesión sin cabecera `Origin` recibe `403`. Envíe el `Origin` de la aplicación o declare `origin: "none"` en esa ruta. `"none"` es **inseguro**: desactiva esta comprobación y deja la ruta expuesta al *login CSRF*, así que úselo sólo con otra prueba de que la petición no viene de otra web (por ejemplo, un secreto de la app que el navegador no tiene). En desarrollo, el primer rechazo escribe un aviso con estas dos salidas.
- `GET`, `HEAD` y `OPTIONS` no se comprueban, porque un callback de OAuth o un enlace mágico llegan como navegación desde otro sitio, sin `Origin`. Esos flujos deben validar su propio `state` o token de un solo uso.
- Un `SessionHandle` que no cargó `SessionManager.load` (un host propio que lo construye a mano) no conoce su petición y crea la sesión como antes.

Es un cambio incompatible publicado en un minor como corrección de seguridad, según la [política de estabilidad](stability.md#excepciones-aprobadas): sin él, cualquier ruta de inicio de sesión sin `origin: "required"` que acepte formularios o `text/plain` era vulnerable por defecto.

### Revocación durante una petición

Revocar una familia también detiene el trabajo que ya había pasado la autenticación:

- **Peticiones en curso.** `SessionHandle.signal` se aborta con `SessionRevokedError` cuando se revoca la familia de su sesión, y `RequestContext.signal` combina esa señal con la de la petición (`AbortSignal.any`, creada al leerla por primera vez). Ambas señales se abortan aunque el código sólo conserve la señal y no el handle ni el contexto. Pase `context.signal` a `fetch`, consultas y otras operaciones cancelables. `SessionRevokedError` es un `ApiError` con código `SESSION_REVOKED` y estado `401`; si escapa del handler, la respuesta es ese `401`. La petición que llama a `revoke()` no se aborta, porque debe enviar la cookie vacía.
- **Sockets abiertos.** Las conexiones Socket cuya sesión de handshake pertenece a la familia revocada se cierran de inmediato con `1008` ("Session revoked"), sin esperar a otro evento.
- **Otras instancias.** Dentro de la misma instancia, `revoke()` aborta siempre. Para alcanzar a otras instancias, el store implementa `subscribeRevocations(listener)`, que devuelve, o promete, un `Unsubscribe`. `RedisSessionStore` la ofrece cuando recibe `subscriber` (una conexión dedicada, por ejemplo `client.duplicate()`). El script de `revokeFamily` publica el `familyId` en `<prefix>revoked` en la misma operación atómica que borra la sesión. `MemorySessionStore` avisa a los `SessionManager` del mismo proceso que lo comparten. `SqlSessionStore` no tiene notificación: sin ella, las demás instancias sólo detectan la revocación al releer el store.
- **Inicio de la suscripción.** `SessionManager` se suscribe en la primera llamada a `load` y espera la confirmación antes de autenticar. Si la suscripción falla, `load` rechaza esa petición y la siguiente lo reintenta. `SessionManager.close()` cancela la suscripción.

La notificación es asíncrona: entre el borrado en el store y la llegada del aviso, otra instancia puede seguir ejecutando código. Antes de un efecto irreversible (un pago, un envío, un borrado), llame `await context.session.verify()`. Relee el store y lanza `SessionRevokedError` si la sesión fue revocada, reemplazada por una rotación o caducó; sin sesión no hace nada.

Límites conocidos de la notificación:

- **Suscriptor Redis desconectado.** Redis pub/sub no guarda mensajes: las revocaciones publicadas mientras el `subscriber` de una instancia está desconectado se pierden para esa instancia, aunque node-redis restablezca la suscripción al reconectar. El borrado en el store sí es atómico, así que esas sesiones dejan de valer en cuanto se releen: cada petición nueva y cada evento de Socket releen la sesión, y una entrega de broadcast la relee si pasó más de `sessionRefreshMs` desde la última lectura. Lo que no se detecta es el trabajo ya autenticado en esa instancia: una petición en curso no se aborta y un socket sin tráfico permanece abierto hasta su siguiente evento o entrega. Use `verify()` antes de efectos irreversibles y vigile los eventos de reconexión del cliente Redis.
- **Ventana de revocaciones recientes.** Cada instancia recuerda las familias revocadas durante 60 segundos, hasta 4096; con más revocaciones en esa ventana olvida primero las más antiguas. Un handle cuyo registro se leyó antes del aviso y se crea después de que su familia salga de esa memoria no se aborta al registrarse, pero `verify()` y la siguiente relectura sí detectan la revocación, porque el registro ya no existe.
- **Avisos falsificables.** Cualquiera con permiso `PUBLISH` sobre el Redis puede publicar un `familyId` en `<prefix>revoked`. El aviso no borra datos ni concede acceso, pero aborta las peticiones en curso y cierra los sockets de esa familia en todas las instancias (denegación de servicio). Restrinja con ACL de Redis quién puede publicar en ese canal.

Un almacenamiento caído propaga error y no concede acceso. No se debe usar un store en memoria en producción. `Secure` requiere HTTPS en despliegue; configure el proxy y `MEEKO_PUBLIC_ORIGIN` acorde al origen público.

## Limpiar el proyecto

`meeko clean [directorio]` borra todo lo que genera Meeko para dejar el proyecto limpio:

| Comando | Borra | Conserva |
| --- | --- | --- |
| `meeko clean` | `.meeko/` (tipos, entradas, manifiestos, builds, `tsconfig.*` generados) y la caché de Vite `node_modules/.vite` | El resto de `node_modules` y todos los archivos de la aplicación |
| `meeko clean --all` | Lo anterior y `node_modules` | Lockfiles, `.env`, `package.json` y el código |
| `meeko clean --dry-run` | Nada: muestra qué borraría, con el número de archivos y el tamaño | Todo |

El comando sólo actúa sobre un proyecto Meeko (con `meeko.config.*` o con `@meekojs/meeko` en `dependencies`/`devDependencies`) y rechaza la raíz de una unidad y el directorio del usuario. Borra únicamente esa lista fija de rutas dentro del proyecto y **nunca sigue enlaces**: un symlink o una junction se elimina como enlace sin entrar en su destino, así que es seguro con `link:` de pnpm, donde `node_modules/@meekojs/meeko` apunta a otro repositorio. Si `node_modules` es un enlace, la caché de Vite se omite con un aviso. Un archivo bloqueado se reintenta; si el error persiste, se informa, se sigue con el resto y el comando termina con código 1. Para reinstalar desde cero: `meeko clean --all` y después `pnpm install`.

## Build, despliegue y verificación

```sh
npm run check   # manifiestos, tipos, componentes y proyectos TypeScript separados
npm run build   # cliente, servidor Node y prerender bajo .meeko/output/node/
npm start       # Node 24, con store persistente configurado
```

`meeko build [directorio] [--adapter <nombre>]` toma el adaptador de `--adapter` o de `server.adapter` en `meeko.config.ts`, con `node` por defecto. `MeekoConfig.server` es una unión discriminada; para Node acepta `{ adapter: "node", host?, port? }`. El build Node escribe `.meeko/output/node/` con `index.mjs`, `chunks/`, `client/` y `prerender/`. Esa carpeta contiene el manifiesto de rutas, endpoints y assets ya resuelto: no lee `app/`, `server/` ni `meeko.config.ts` y no carga TypeScript ni Vite. Sólo necesita las dependencias de `node_modules`, incluida `@meekojs/meeko`. `meeko start` y `meeko preview` ejecutan `index.mjs`; también puede ejecutarse con `node .meeko/output/node/index.mjs`. Para Bun y Deno, `meeko build --adapter bun` o `--adapter deno` (o `server: { adapter: "bun" }` / `{ adapter: "deno" }`) produce una salida autónoma descrita en [Bun](#bun) y [Deno](#deno), y `--adapter cloudflare` un Worker descrito en [Cloudflare Workers](#cloudflare-workers).

El servidor escucha en `127.0.0.1:4173` salvo que `server.host`/`server.port` o las variables `MEEKO_HOST` y `MEEKO_PORT` (o `PORT`) indiquen otra dirección; use `MEEKO_HOST=0.0.0.0` para aceptar tráfico remoto. `MEEKO_PUBLIC_ORIGIN` fija el origen público para las comprobaciones de Origin de HTTP y Socket cuando un proxy termina TLS. `SIGINT` y `SIGTERM` cierran Socket, HTTP, las tareas de `waitUntil` y el runtime, por ese orden. Las respuestas abiertas, como un stream, disponen de `shutdownTimeout` milisegundos (10 000 por defecto) para terminar; después se cortan sus conexiones y el cierre continúa. Si el cliente se desconecta antes o durante el envío, el cuerpo de la respuesta se cancela, lo que libera archivos abiertos y detiene productores de streams. Un request-target que empieza por `//` se interpreta siempre como ruta del origen propio (o de `MEEKO_PUBLIC_ORIGIN`), nunca como otro host.

Los archivos públicos se sirven sólo si figuran en el manifiesto de assets generado con el build cliente (incluida la copia de `public/`); cualquier otra ruta pasa a la aplicación y nunca se lee del disco. Cada asset lleva `ETag`, `content-length` y soporte de `HEAD` y `304`; sólo los archivos emitidos por Vite y listados en su manifiesto (con hash de contenido) usan `cache-control: public, max-age=31536000, immutable`; el resto, incluidos los de `public/assets/`, usan `public, max-age=0, must-revalidate`. La clave de cada asset es su ruta tal como la serializa la URL WHATWG, la misma que pide el navegador: `public/logo@2x.png` se sirve en `/logo@2x.png`, `a b.txt` en `/a%20b.txt` y un nombre no ASCII en su forma codificada en UTF-8. El HTML enlaza la entrada cliente, su CSS y sus `modulepreload` desde el manifiesto de Vite; la lista de rutas del cliente se importa como módulo y ya no se inserta en el documento.

Para un servicio público, sitúelo tras un proxy HTTPS, configure `MEEKO_PUBLIC_ORIGIN`, sesiones persistentes y cierre ordenado. La exportación OpenAPI es opcional mediante `generateOpenApi`; un schema que no pueda representarse produce error explícito.

El starter independiente creado con `meeko init` coordina el cierre de HTTP y Vite ante `SIGINT` y `SIGTERM`. El cierre es idempotente; si fallan ambos recursos conserva las dos causas y fija un código de salida fallido, sin dejar rechazos de promesas sin observar. El host de framework conserva del mismo modo el error original de arranque y comunica por el observador central cada fallo adicional al cerrar Socket, sesiones o Vite.

El adaptador Node entrega por separado varias cabeceras `Set-Cookie` y deja de transmitir el cuerpo si el cliente cierra la conexión. Una respuesta ya iniciada no puede sustituirse por un JSON de error; el adaptador cierra esa conexión y comunica el fallo al observador del host.

### Bun

```sh
npx meeko build --adapter bun
npx meeko preview --adapter bun      # ejecuta la salida con `bun`
bun .meeko/output/bun/index.js       # en producción
```

El build Bun escribe `.meeko/output/bun/` con `index.js`, `chunks/`, `client/` y `prerender/`. A diferencia del build Node, `index.js` incluye `@meekojs/meeko` y el resto de dependencias del servidor: la carpeta no necesita `node_modules`, ni las fuentes de la aplicación, ni TypeScript o Vite. Copie la carpeta completa al servidor. El build y el prerender siguen ejecutándose con Node; Meeko construye para ello un servidor Node intermedio en `.meeko/build/node/`, que no forma parte de la salida.

La salida escucha en `127.0.0.1:4173` salvo que `MEEKO_HOST` y `MEEKO_PORT` (o `PORT`) indiquen otra dirección; `MEEKO_PUBLIC_ORIGIN` cumple la misma función que en Node. `server.host` y `server.port` sólo se aplican a Node. `SIGINT` y `SIGTERM` detienen `Bun.serve`, cierran las conexiones activas y después la aplicación. `meeko preview` lanza `bun` como proceso hijo, le reenvía las señales y adopta su código de salida; si `bun` no está en el `PATH`, falla con un mensaje explícito.

Para alojar la aplicación en un servidor propio, `createBunServer(app, options)` devuelve `{ fetch, websocket }` para `Bun.serve({ port, ...createBunServer(app) })`, y `createBunAssetReader({ root, assets })` sirve los archivos del manifiesto con `Bun.file`. Límites de Socket:

- `maxPayloadLength`: el frame entrante más grande. Por defecto, `socket.maxMessageBytes` de `server/runtime.ts` o 64 KiB. Bun cierra los frames mayores y el hub responde `1009` a un mensaje que supere el límite de la aplicación.
- `backpressureLimit`: bytes salientes pendientes por peer, 1 MiB por defecto. Un envío que lo supera cierra ese peer con `1011` sin bloquear al resto de la sala.
- `idleTimeout` (60 s) y `sendPings` (activo) mantienen vivas las conexiones sanas y cierran las inactivas. Los mensajes binarios se cierran con `1003`. La compresión por mensaje está desactivada.

### Deno

```sh
npx meeko build --adapter deno
npx meeko preview --adapter deno                 # ejecuta `deno run -A` sobre la salida
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

El build Deno escribe `.meeko/output/deno/` con `main.js`, `chunks/`, `client/` y `prerender/`. Como en Bun, `main.js` incluye todas las dependencias del servidor y no necesita `node_modules`, las fuentes, TypeScript ni Vite. `meeko preview` concede todos los permisos (`-A`). En producción bastan `--allow-net`, `--allow-env` (el runtime recibe `Deno.env.toObject()`) y lectura de la carpeta de salida. `MEEKO_HOST`, `MEEKO_PORT` (o `PORT`) y `MEEKO_PUBLIC_ORIGIN` funcionan como en Node.

`serveDeno(app, { host, port, publicOrigin, platform, onError, maxMessageBytes, idleTimeout, handleSignals })` sirve la aplicación con `Deno.serve` y devuelve `{ url, finished, close() }`. `close()` cierra los peers de Socket con `1001`, detiene HTTP, espera las tareas de `waitUntil` y cierra la aplicación, por ese orden. Con `handleSignals`, lo hace ante `SIGINT` y `SIGTERM` (en Windows, `SIGINT` y `SIGBREAK`). `createDenoAssetReader({ root, assets })` sirve los archivos del manifiesto. Límites de Socket:

- `Deno.upgradeWebSocket` no ofrece un límite de frame, así que el adaptador mide cada mensaje con `maxMessageBytes` (por defecto, el límite de Socket de la aplicación o 64 KiB) y cierra con `1009` los mayores. Deno reensambla el frame en memoria antes de esa comprobación; limite el tamaño de las peticiones en el proxy si necesita un tope anterior.
- El búfer saliente se controla con el límite de búfer del hub mediante `bufferedAmount`.
- `idleTimeout` (60 s) cierra un peer que no responde al ping. Los mensajes binarios se cierran con `1003`.

### Cloudflare Workers

```sh
npx meeko build --adapter cloudflare
npx meeko preview --adapter cloudflare   # wrangler dev sobre la salida
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

El build Cloudflare escribe `.meeko/output/cloudflare/` con:

- `worker.js`: un único módulo ES que incluye `@meekojs/meeko` y las dependencias del servidor. Sólo importa `cloudflare:workers` y `node:async_hooks`, que proporciona el runtime.
- `assets/`: el build cliente y `public/`, más las páginas prerenderizadas bajo `assets/_meeko/prerender/`. El Worker lee esas páginas mediante el binding de assets y nunca las sirve como archivos; `public/_meeko/` queda reservado y detiene el build.
- `wrangler.jsonc`: la configuración generada. No la edite; se regenera en cada build.

Wrangler no vuelve a empaquetar la salida (`no_bundle: true`), así que se despliega exactamente el código que se probó. Wrangler es una herramienta de despliegue, no una dependencia de ejecución: `meeko preview` usa el de la aplicación o, en su defecto, el de la instalación de Meeko, y si no encuentra ninguno falla con «Wrangler is not installed; add it with pnpm add -D wrangler…». `MEEKO_PORT` (o `PORT`) y `MEEKO_HOST` se pasan a `wrangler dev` como `--port` e `--ip`. El build y el prerender siguen ejecutándose con Node; durante el prerender, la fábrica de `server/runtime.ts` se ejecuta en Node con `prerendering: true` y sin bindings.

La configuración se declara en `meeko.config.ts`:

```ts
export default defineMeekoConfig({
  server: {
    adapter: "cloudflare",
    name: "mi-app",                     // por defecto, el nombre del package.json
    socketClassName: "MeekoSocketRoom", // clase Durable Object de las salas
    compatibilityDate: "2026-10-19",    // por defecto, la fecha con la que Meeko se prueba
    wrangler: {                         // campos adicionales de wrangler.jsonc
      d1_databases: [{ binding: "DB", database_name: "mi-app", database_id: "<id>" }],
      vars: { MEEKO_PUBLIC_ORIGIN: "https://mi-app.example" },
    },
  },
});
```

El `wrangler.jsonc` generado contiene:

- `main: "./worker.js"`, `no_bundle: true` y `find_additional_modules: false`, para que los archivos de `assets/` no se suban también como módulos del Worker.
- `compatibility_flags` con `nodejs_als`, que habilita `AsyncLocalStorage` de `node:async_hooks`, unido a los flags declarados en `server.wrangler.compatibility_flags`. `nodejs_compat` también es válido, porque incluye `AsyncLocalStorage`.
- `assets` con `directory: "./assets"`, binding `ASSETS`, `run_worker_first: true` y `html_handling`/`not_found_handling` en `"none"`. Todas las peticiones llegan al Worker, que sólo sirve los archivos listados en el manifiesto con el `ETag` y la política de caché de los demás adaptadores.
- El binding Durable Object `MEEKO_SOCKET` hacia la clase de salas, antepuesto a los bindings de `server.wrangler.durable_objects`.
- La declaración de la clase de salas (`MeekoSocketRoom`, o el nombre de `server.socketClassName`), sin reescribir nunca un historial existente. Cloudflare admite dos formas por Worker, el array `migrations` o el mapa declarativo `exports`:
  - Sin `server.wrangler.migrations` ni entradas Durable Object en `exports`, Meeko genera `migrations: [{ "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] }]`. No borre ni renombre esa migración después del primer despliegue.
  - Si declara `migrations`, el historial debe crear la clase él mismo (`new_sqlite_classes`, `new_classes` o el destino de `renamed_classes`/`transferred_classes`). Las migraciones se aplican en orden y se registran por `tag`, así que anteponer la de Meeko cambiaría un historial ya desplegado; el build se detiene con «server.wrangler.migrations does not create the Socket room class …; append { "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] } at the end of server.wrangler.migrations». Añada esa entrada al final de su historial; si `meeko-socket-v1` ya es el tag de otra migración, el mensaje propone `meeko-socket-v1-<n>`, con `<n>` igual al número de migraciones más uno.
  - Si declara Durable Objects en `exports`, Meeko añade `"MeekoSocketRoom": { "type": "durable-object", "storage": "sqlite" }` cuando falta y no genera `migrations`; una entrada propia de la clase debe estar viva (sin `state` o con `"created"`). `exports` con Durable Objects y `migrations` a la vez detienen el build, porque Cloudflare sólo acepta una de las dos formas.

`main`, `assets`, `no_bundle` y `find_additional_modules` pertenecen a Meeko y no se pueden sobrescribir, ni tampoco el binding `MEEKO_SOCKET`. El resto de campos de `server.wrangler` (`routes`, `vars`, `d1_databases`, `observability`…) se copian tal cual.

En Workers, `env` de `server/runtime.ts` es el objeto de bindings del Worker y `platform` vale `"cloudflare"`. La aplicación se crea una vez por aislado, en la primera petición, y `context.platform.waitUntil` usa `ctx.waitUntil`. La variable `MEEKO_PUBLIC_ORIGIN` fija el origen público; sin ella se usa el origen de la URL enrutada. Ejemplo con D1 para las sesiones:

```ts
// server/runtime.ts
import { D1SessionDriver, DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";
import type { D1DatabaseLike, DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";

interface Env { readonly DB?: D1DatabaseLike; readonly MEEKO_SOCKET?: DurableObjectNamespaceLike }

export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
  const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB));
  const pubsub = env.MEEKO_SOCKET ? new DurableObjectSocketPubSub(env.MEEKO_SOCKET) : undefined;
  return {
    sessions: new SessionManager({ production: production && !prerendering, store }),
    services: { pubsub },
    // Sin pubsub, el Worker usa DurableObjectSocketPubSub(env.MEEKO_SOCKET) por defecto;
    // cualquier otro broker se rechaza al crear la aplicación.
    socket: { maxMessageBytes: 16 * 1024 },
  };
});
```

#### Sesiones en D1

`D1SessionDriver(db, { table? })` implementa `SqlSessionDriver` para `SqlSessionStore`. `replace` es un único `UPDATE … WHERE id = ? AND family_id = ? AND expires_at > ?` que comprueba que haya cambiado exactamente una fila; `revokeFamily` es un `DELETE … WHERE family_id = ?`. `UNIQUE(family_id)` impide un segundo ID activo en la misma familia. `D1SessionDriver.schema(table?)` devuelve el esquema de referencia (con la tabla por defecto `meeko_sessions`):

```sql
CREATE TABLE IF NOT EXISTS "meeko_sessions" (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "meeko_sessions_expires_at" ON "meeko_sessions" (expires_at);
```

Aplíquelo como migración D1 antes de desplegar: `npx wrangler d1 migrations create <base> meeko_sessions`, copie el SQL en el archivo creado y ejecute `npx wrangler d1 migrations apply <base> --remote` (o `--local` para `wrangler dev`). Las filas caducadas se borran al leerlas; para limpiar el resto, llame a `driver.deleteExpired()` desde un Cron Trigger. D1 no notifica revocaciones a otros aislados: una conexión abierta en otro aislado detecta la revocación al releer la sesión en su siguiente evento (véase [Revocación durante una petición](#revocación-durante-una-petición)).

#### Redis mediante la API REST de Upstash

Workers no abre conexiones TCP de Redis con el cliente `redis`. `RedisSessionStore` sólo necesita `get`, `set` con `PX`, `del` y `eval`, de modo que un adaptador sobre la API REST de Upstash basta. Guarde la URL y el token como secretos del Worker:

```ts
import { RedisSessionStore } from "@meekojs/meeko/server";
import type { RedisSessionClient } from "@meekojs/meeko/server";

/** Cliente mínimo de la API REST de Upstash para RedisSessionStore. */
function upstashClient(url: string, token: string): RedisSessionClient {
  const command = async (...args: Array<string | number>): Promise<unknown> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = await response.json() as { result?: unknown; error?: string };
    if (!response.ok || body.error) throw new Error(`Upstash ${String(args[0])} failed: ${body.error ?? response.status}`);
    return body.result;
  };
  return {
    get: async (key) => (await command("GET", key)) as string | null,
    set: (key, value, { PX }) => command("SET", key, value, "PX", PX),
    del: (key) => command("DEL", key),
    eval: (script, { keys, arguments: args }) => command("EVAL", script, keys.length, ...keys, ...args),
  };
}

// En la fábrica de server/runtime.ts:
const store = new RedisSessionStore(upstashClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN), { prefix: "mi-app:prod:" });
```

La API REST no mantiene una suscripción, así que no pase `subscriber`: las revocaciones se detectan al releer la sesión, como con D1.

Workers KV no sirve como store de sesiones: no ofrece operaciones atómicas de comparación ni de borrado por familia y su consistencia es eventual, por lo que no puede garantizar `replace` ni `revokeFamily`. `SessionManager({ production: true })` rechaza los stores que no implementan ambas operaciones.

#### Socket y Durable Objects

El Worker comprueba la ruta, el Origin y la autorización del canal antes del upgrade, con las mismas respuestas que el resto de adaptadores: `400`, `403` `INVALID_ORIGIN` y `404` por HTTP, y los rechazos de sesión o autorización con el cierre `4401` o `4403` (véase [WebSocket](#websocket)), que el propio Worker hace con un `WebSocketPair` sin despertar el Durable Object de la sala. Si los acepta, reenvía la conexión al Durable Object de su sala: `env.MEEKO_SOCKET.idFromName(canal + "\0" + sala)`. Cada par canal/sala es un objeto, que:

- acepta el WebSocket con la API de hibernación (`ctx.acceptWebSocket`), de modo que las conexiones inactivas no mantienen el objeto en memoria;
- guarda con `serializeAttachment` el canal, la sala, la URL, la cookie de sesión (sólo la cookie con el nombre de `SessionManager`, no el resto de la cabecera `Cookie`) y las cabeceras `origin` y `authorization`. Al despertar reconstruye cada conexión desde ese estado y el hub vuelve a autorizar. Los canales ven esas mismas cabeceras antes y después de hibernar. `keepHeaders` añade otras (en minúsculas; `"cookie"` conserva la cabecera completa). Cloudflare limita ese attachment a 16.384 bytes serializados: Meeko estima el tamaño antes de aceptar el WebSocket y, si no cabe, responde `431` y notifica el error a `onError` en lugar de abrir una conexión que se cerraría con `1011`;
- responde `pong` a un mensaje de texto `ping` sin despertar (configurable con `autoResponse`, o `false` para desactivarlo). Los pings de protocolo los responde siempre el runtime;
- cierra con `1009` los mensajes mayores que `maxMessageBytes` (por defecto, el límite de Socket de la aplicación o 64 KiB) y con `1003` los binarios.

`DurableObjectSocketPubSub(env.MEEKO_SOCKET)` es el broker por defecto en Workers: `publish` entrega el mensaje a la sala mediante RPC al Durable Object (o directamente si ya se ejecuta en él) y se resuelve cuando la sala lo acepta; la sala reparte el mensaje a sus peers en orden de publicación. Las suscripciones sólo existen dentro del Durable Object de la sala; por eso todo upgrade debe pasar por `createWorker`. Un broadcast desde una API o desde otra sala funciona igual. `runtime.socket.pubsub` sólo puede omitirse o ser un `DurableObjectSocketPubSub`: `LocalSocketPubSub`, `RedisSocketPubSub` u otro broker entregarían sólo a los suscriptores de un aislado, así que el Worker y la sala rechazan la aplicación al crearla con «Socket channels on Cloudflare Workers require DurableObjectSocketPubSub…».

Entrega en la sala:

- Cada publicación se entrega a los peers ya suscritos. Una conexión recién aceptada que todavía se está autorizando no retrasa a las demás; recibe las publicaciones posteriores a su autorización, como en el resto de adaptadores.
- Al despertar de la hibernación, la sala reconstruye las conexiones abiertas y las publicaciones esperan a que se vuelvan a autorizar, como máximo `rebuildTimeoutMs` (5000 ms por defecto) desde el inicio de cada reconstrucción; una conexión que no termina a tiempo recibe sólo las publicaciones siguientes.
- Una sala acepta como máximo `maxPendingPublications` publicaciones sin entregar (1024 por defecto). Por encima, `publish` (y por tanto `broadcast`) rechaza con `SOCKET_BACKLOG_EXCEEDED` (503) y el mensaje no se entrega.
- El nombre de la sala sale de `ctx.id.name`; cuando el runtime no lo da (nombres de más de 1.024 bytes), la sala lo toma de su primera conexión o publicación, y las publicaciones hacia ella misma siguen sin RPC.
- Los WebSockets de Workers no informan de `bufferedAmount`, así que `socket.maxBufferBytes` no se aplica en las salas; `maxMessageBytes` y `maxPendingDeliveries` siguen limitando cada peer.
- Si la aplicación no puede crearse al despertar, la sala notifica el error y cierra con `1011` el WebSocket que la despertó.

Rendimiento: un Durable Object ejecuta su código en un solo hilo, así que todos los mensajes y broadcasts de una sala se procesan en serie en un único lugar. Esto da orden y coherencia, pero limita el caudal de una sala muy concurrida; reparta el tráfico en varias salas (por ejemplo, por documento o por grupo) en lugar de una sala global. Consulte los límites vigentes de Durable Objects en la documentación de Cloudflare.

Para un Worker propio, `@meekojs/meeko/cloudflare` exporta las piezas que usa el build:

- `createWorker(app, { socketBinding?, publicOrigin?, onError? })` devuelve el handler `{ fetch }` del módulo. `app` es un `ServerApp` o una fábrica `({ env, platform }) => ServerApp | Promise<ServerApp>` que se ejecuta una vez por aislado; si falla, el siguiente evento la reintenta.
- `createSocketRoomClass(app, DurableObject, { maxMessageBytes?, autoResponse?, keepHeaders?, maxPendingPublications?, rebuildTimeoutMs?, onError? })` crea la clase de salas. `DurableObject` se importa de `cloudflare:workers` y se pasa como argumento para que el módulo se pueda cargar fuera de Workers. El Worker que genera `meeko build` usa los valores por defecto de estas opciones; para cambiar `keepHeaders`, `maxPendingPublications` o `rebuildTimeoutMs` hace falta un Worker propio.
- `DurableObjectSocketPubSub`, `socketRoomName(canal, sala)`, `D1SessionDriver`, `createCloudflareAssetReader({ binding, assets })` y `createCloudflarePrerenderSource({ binding, directory? })`.
- `ServerAppOptions.defaultSocketPubSub` fija el broker cuando `server/runtime.ts` no declara `socket.pubsub`, y `openSocketSession` de `@meekojs/meeko/server` conecta un peer ya aceptado al hub.

### Conformidad entre adaptadores

`packages/meeko/tests/conformance/` construye la misma aplicación de prueba (`tests/fixtures/conformance-app/`) con cada adaptador. Antes de arrancar la salida en su runtime real, retira las fuentes; para Bun, Deno y workerd retira también `node_modules`. La variante `workerd` construye con el adaptador `cloudflare` y ejecuta la salida con el mismo runtime local que `wrangler dev` (workerd tras el proxy de Wrangler, mediante `createTestHarness`), con D1 y Durable Objects en memoria. Las mismas aserciones cubren:

- SSR con loader y plataforma, API, RPC, CSRF y Origin;
- `404`, `405` con `Allow`, y `HEAD`, incluida la `404` de una página sin ruta con `app/error.meeko` dentro de los layouts;
- assets con `ETag`/`304` y política de caché, e intentos de traversal (`..`, `%2e%2e`, `%2f`, `%5c`) y de leer archivos del build;
- páginas prerenderizadas con la meta CSRF de la sesión;
- orden del middleware;
- Socket: ruta, Origin, autenticación, límites de tamaño, validación y binario, orden de mensajes de un peer y broadcast entre dos conexiones de una sala.

La variante `workerd` añade sesiones en D1 (también leídas desde el Durable Object de un canal privado), la hibernación forzada de una sala (`evictDurableObject` con `webSockets: "hibernate"`) seguida de mensajes en ambos sentidos, el auto-response `ping`/`pong` y un broadcast desde la API, la publicación de una sala a otra por RPC sin fugas a terceras salas, una conexión con una cabecera `Cookie` mayor que el límite del attachment, una sala cuyo nombre supera 1.024 bytes y que la salida sea un único módulo `worker.js`. La prueba de streaming pide `accept-encoding: identity`: el runtime local de Wrangler (Miniflare) emula la compresión de Cloudflare para `text/html` sin respetar `no-transform`, y su codificador gzip sólo escribe al cerrar el cuerpo, de modo que con `wrangler dev` o `meeko preview --adapter cloudflare` un navegador que acepta gzip recibe las páginas `"stream"` completas al final. Es una limitación del entorno local: en producción, la compresión de Cloudflare respeta `no-transform`.

```sh
pnpm run conformance          # node, bun, deno y workerd
pnpm run conformance:bun      # o :node / :deno / :workerd
```

Node se ejecuta siempre. Bun y Deno se buscan en `MEEKO_BUN`/`MEEKO_DENO`, después en el `PATH` y por último en una versión instalada con `mise` (`mise where bun`). Si no se encuentran, la suite se omite con un mensaje explícito. workerd llega con la devDependency `wrangler`; sin ella, su suite también se omite. `MEEKO_CONFORMANCE_REQUIRE=bun,deno,workerd` convierte esa omisión en un fallo; la CI lo usa en sus jobs de Bun, Deno y workerd.

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1` instala un tarball local en un proyecto independiente, genera tipos, construye producción, retira las fuentes de la aplicación, arranca el build Node y prueba HTTP, assets, páginas prerenderizadas con CSRF, dos sesiones, RPC/CSRF, WebSocket real y Chrome. También crea `meeko init-framework` desde ese paquete e instala, comprueba tipos y construye el starter generado. El fixture contiene páginas `/`, `/users`, `/users/[id]`, `/dashboard`, `/chat` y `/layer-demo`; sus aserciones TypeScript comprueban entradas y salidas válidas e inválidas de API, RPC, Socket, rutas y `ComponentProps` importado desde una página `.meeko` del paquete instalado.

Antes de preparar una publicación, ejecute `pnpm install --frozen-lockfile`, `pnpm run verify`, `pnpm run e2e`, `pnpm run pilot:e2e`, `pnpm run package:smoke`, `pnpm run conformance` (con Bun y Deno instalados; workerd llega con `pnpm install`), la prueba Redis anterior, `pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1`, `pnpm pack` (en `packages/meeko`) y `git diff --check`. La CI ejecuta estas familias de comprobaciones, incluida la conformidad Node, en Windows; Redis y la conformidad de Bun, Deno y workerd se ejecutan en Ubuntu. La existencia del workflow no sustituye una ejecución verde de CI. El workflow de publicación repite los gates y sólo responde a una etiqueta de versión; la decisión de crearla corresponde al mantenedor.

### Resolución de problemas de pnpm y Redis

Si pnpm 12 muestra `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, compruebe el usuario efectivo y el ACL del archivo. En un sandbox Windows restringido, `codexsandboxonline` puede carecer de escritura sobre `all-stores.lock`; `--store-dir` y `LOCALAPPDATA` por sí solos no cambian esa ubicación. No elimine el almacén ni cambie ACL globales para superar este caso. En una terminal Windows normal con acceso al perfil, `pnpm install --frozen-lockfile` funciona sin ese ajuste.

Una instalación congelada con pnpm 12.14.0 pasó en una copia limpia al aislar el perfil sólo dentro del proceso PowerShell que lanzó pnpm, con el comando exacto `pnpm install --frozen-lockfile`, sin enlaces de dependencias:

```powershell
$isolatedProfile = Join-Path (Get-Location).Path '.meeko/pnpm-profile'
$env:USERPROFILE = $isolatedProfile
$env:LOCALAPPDATA = Join-Path $isolatedProfile 'AppData/Local'
$env:APPDATA = Join-Path $isolatedProfile 'AppData/Roaming'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:APPDATA -Force | Out-Null
pnpm install --frozen-lockfile
```

Ejecute el bloque sólo en un proceso PowerShell nuevo y restringido para que las variables recuperen sus valores al salir. Una versión anterior del sandbox también produjo `uv_os_get_passwd returned ENOMEM` en `node:os.userInfo()` antes de cargar `tsx`; ese error corresponde al entorno. La verificación en Windows normal no requiere preload ni cambios en Meeko.

La prueba Redis requiere que `MEEKO_REDIS_URL` apunte a un servidor de pruebas accesible. Un error de conexión o `WRONGTYPE` debe fallar; el adaptador no concede acceso a una sesión cuando Redis no está disponible. Use un prefijo distinto por proyecto y entorno; no ejecute `FLUSHALL` ni `FLUSHDB` en un Redis compartido.

`pnpm run pilot:e2e` registra cada motor y entorno y limita sus lanzamientos. Chromium, Firefox y WebKit pasaron en desarrollo y producción en Windows normal sin cambiar las protecciones del navegador. Un sandbox restringido puede impedir que Firefox cree una página; diagnostique ese entorno con `DEBUG=pw:browser*` antes de atribuir el fallo al framework.

## Rendimiento y baseline

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1 -Benchmark` reproduce el consumidor externo, construye la aplicación mínima y escribe `packages/meeko/.meeko/benchmarks/stability-baseline.json`. El baseline conservado está en `packages/meeko/benchmarks/baseline-2026-10-24.json`. Cada tiempo usa siete muestras y dos calentamientos; el JSON contiene mediana, percentiles 10/90 y extremos. La compilación fría usa un worker nuevo por muestra; HMR mide una edición visible en Chrome con un servidor Vite nuevo por muestra. SSR y dispatchers se miden en proceso con `app.fetch` sobre el build Node de producción, incluido el middleware de servidor; SSR usa `/?benchmark=ssr` para no medir la copia prerenderizada de `/`. Las mediciones de tamaño incluyen JS y CSS comprimidos con gzip. Son medidas de esta máquina, no umbrales de CI.

La entrada cliente generada registra `meeko-hydration` en el navegador. El benchmark actual mide navegación desde el clic de un enlace hasta que aparece la nueva ruta; el baseline histórico medía una llamada directa a `mountClientApp.navigate`. Por ese cambio de método, no compare las cifras de navegación entre ambas ejecuciones como si fueran una regresión del runtime. El JSON histórico permanece intacto.

| Métrica | Mediana o tamaño | p10–p90 |
| --- | ---: | ---: |
| Compilación fría | 9.40 ms | 9.08–9.45 ms |
| Compilación tras edición | 0.87 ms | 0.53–1.14 ms |
| HMR visible | 28.63 ms | 27.19–29.11 ms |
| SSR por petición | 0.040 ms | 0.032–0.060 ms |
| Hidratación | 11.10 ms | 10.70–11.20 ms |
| Navegación cliente | 1.90 ms | 1.80–2.10 ms |
| Dispatcher API | 0.019 ms | 0.017–0.019 ms |
| Dispatcher RPC | 0.049 ms | 0.044–0.054 ms |
| Bundle motor | 19,134 B; gzip 7,222 B | — |
| Bundle mínimo | 21,314 B; gzip 6,438 B | — |
| Bundle full-stack | 36,063 B; gzip 14,897 B | — |

Tras 500 renders SSR, el heap pasó de 87,276,056 a 87,012,304 bytes después de GC; RSS máximo observado: 224,952,320 bytes. Esta muestra no prueba ausencia de fugas y debe compararse sólo bajo condiciones equivalentes.

## Compatibilidad y versionado

Las entradas públicas soportadas de la versión actual son `@meekojs/meeko`, `/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare`, `/build`, `/vite`, `/devtools-ui`, desde `1.1`, `/prettier` y, desde `1.2`, `/password`. `/internal` existe para el código generado por Meeko y no es contrato de consumo directo. La compilación se ofrece mediante la CLI y Vite; la raíz pública expone la reactividad y el runtime de SSR e hidratación, pero no una función `compile`. `defineMeekoConfig`, routing, `definePage`, `useState`, `createApiClient`, `createRpcClient`, `defineSocketChannel`, `attachNodeWebSocketServer`, `RedisSessionStore` y `SqlSessionStore` conservan sus nombres actuales. Los autoimports generados `api`, `rpc`, `socket` y `useSocket` dependen del manifiesto de cada aplicación.

Meeko sigue SemVer desde `1.0`: el contrato público, lo que no es público y la política de deprecación están en [stability.md](stability.md). Una publicación requiere lockfile reproducible con el pnpm declarado, CI verde, consumidor externo y revisión del tarball. No se aumenta la versión automáticamente.

## Límites actuales

- Los adaptadores de servidor publicados son Node 24, Bun, Deno y Cloudflare Workers; la suite de conformidad se ejecuta con Bun 1.4.4, Deno 2.9.8 y workerd 1.20261019.1 (wrangler 4.152.0). En Workers, Socket requiere Durable Objects, las sesiones requieren D1 o Redis por la API REST de Upstash (KV no es válido) y D1 no notifica revocaciones a otros aislados.
- Redis tiene una prueba de integración con servidor real configurada en CI; su ejecución local depende de un servidor accesible. El adaptador SQL se probó con SQLite real. `RedisSocketPubSub` se prueba en la misma integración con dos procesos.
- Los canales Socket se descubren como archivos con nombre simple bajo `server/socket/`.
- Cambios en configuración o registro de autoimports fuerzan recarga completa en Vite.
- La producción requiere un store de sesiones persistente: `MEEKO_REDIS_URL` en Node, Bun y Deno, o `sessions` propias en `server/runtime.ts` (en Workers, D1 o Upstash).
- La revocación por familia invalida el ID activo ante rotaciones concurrentes, aborta `RequestContext.signal` de las peticiones en curso de esa familia y cierra sus sockets. En otras instancias, esto requiere un store con `subscribeRevocations`. El aborto es cooperativo: el código que no observa `context.signal` sigue ejecutándose hasta su siguiente comprobación, y el aviso entre instancias llega con la latencia del broker. Llame `context.session.verify()` antes de efectos irreversibles. Si la aplicación requiere orden estricto entre operaciones en curso, debe coordinarlas. Meeko evita que una respuesta anterior restaure un token CSRF ya cambiado.
- La navegación cliente es transaccional. Sin layouts compartidos, la vista nueva se hidrata junto a la actual entre marcadores privados y la anterior sólo se retira y libera después de una hidratación correcta. Con un layout conservado, el outlet restaura e hidrata de nuevo su página anterior si falla la nueva. En ambos casos la ruta visible, su URL y su estado siguen activos y `navigate()` rechaza con el error original. Sólo si también falla esa restauración, Meeko solicita una carga completa de la última URL confirmada. Durante la hidratación de la vista nueva, la anterior sigue en el documento: un `id` repetido entre ambas páginas puede resolver al elemento antiguo hasta el commit.
- Si la API de historial del navegador falla después de renderizar, Meeko solicita recargar la última URL confirmada y propaga el error original. Si también falla esa recuperación, conserva ambas causas en `AggregateError`.
