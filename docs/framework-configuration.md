# Configurar y ampliar la aplicación

Esta guía desarrolla [la visión general del framework](framework.md).

## Configuración

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	document: { lang: 'es' },
})
```

`meeko.config.ts` (o `.mts`, `.js`, `.mjs`) se carga con Node. El starter ya trae un archivo válido; sólo cambia lo que tu aplicación necesite. Entre las opciones avanzadas están:

- `layers` (desde `1.2`): carpetas que aportan páginas, componentes, autoimports y plugins; véase [Layers](#layers). `extends`, el nombre anterior, sigue funcionando como alias.
- `modules`: nombres de los módulos creados con `defineMeekoModule` (paquetes o rutas), que configuran el proyecto desde código; sus opciones van en la clave de cada uno, como `seo`. Véase [Módulos](#módulos).
- `imports`: carpetas de autoimports además de las de por defecto, con el ámbito de la carpeta que las contiene; véase [Autoimports y TypeScript](#carpetas-de-autoimports).
  - `imports.appDirs` (desde `1.3`): carpetas dentro de `app/` (`"app/services"`), con el ámbito de `app/`: navegador y SSR, no `shared/` ni `server/`.
  - `imports.sharedDirs` (desde `1.3`): carpetas dentro de `shared/` (`"shared/validators"`), con el ámbito de `shared/`: aplicación y servidor.
  - `imports.serverDirs`: carpetas dentro de `server/`, exclusivas del servidor.
- `server`: el adaptador de `meeko build`; véase [Build, despliegue y verificación](framework-deployment.md#build-despliegue-y-verificación).
- `document` (desde `1.2`): `lang` y las entradas de `<head>` de todos los documentos. Los módulos añaden las suyas con `meeko.addHead`; las de `document.head` se aplican después, así que el `title` del proyecto gana. Desde `1.3`, `document.seo` añade la URL canónica y Open Graph de cada página; véase [Canónica y Open Graph por página](framework-rendering.md#canónica-y-open-graph-por-página). Desde `1.5`, `document.idPrefix` es el prefijo de los IDs de [`useId`](api.md#ids-estables-useid) y de `form.field` (`m` por defecto).
- `dev` (desde `1.3`): opciones de `meeko dev`. `serverLogs: false` desactiva los [logs del servidor en la consola del navegador](#logs-del-servidor-en-la-consola-del-navegador).
- `devtools` (desde `1.8`): `true` hace que `meeko dev` monte el [panel de Meeko DevTools](devtools.md#panel-dentro-de-la-página) en la página, sin código de la aplicación; `{ position: "bottom-left" }` elige su esquina. Por defecto, `false`. Nunca llega a `meeko build` ni a `meeko start`.
- `site` (desde `1.3`): la URL pública del sitio (`"https://example.com"`, sólo el origen). Es el origen de las URL absolutas que escribe Meeko: `sitemap.xml`, `robots.txt` y `document.seo`. Sin `site`, el build usa `MEEKO_PUBLIC_ORIGIN`. No cambia las comprobaciones de `Origin`, que siguen leyendo `MEEKO_PUBLIC_ORIGIN` o `publicOrigin` de `server/runtime.ts` al ejecutarse.
- `sitemap` y `robots` (desde `1.3`): `sitemap.xml` y `robots.txt` generados en el build; véase [`sitemap.xml` y `robots.txt`](framework-deployment.md#sitemapxml-y-robotstxt).
- `theme` (desde `1.4`): el tema claro/oscuro, y temas propios, sin parpadeo, con `useTheme()`; véase [Tema claro/oscuro sin parpadeo](framework-rendering.md#tema-clarooscuro-sin-parpadeo).
- `alias` (desde `1.5`): aliases de ruta propios, o cambios de `~/`, `@/`, `#shared/` y `#server/`, los que Meeko define por defecto; véase [Aliases de ruta](#aliases-de-ruta).

Desde `1.2`, `css: { scopeAttribute: "matched" }` limita el atributo de `<style scoped>` a los elementos que algún selector con ámbito puede seleccionar; con `"all"`, el valor por defecto en `1.x`, va en todos los elementos de la plantilla. `"matched"` pasará a ser el valor por defecto en `2.0`. Véase [Estilos con ámbito](api.md#qué-elementos-reciben-el-atributo), con el caso de las clases que el script añade con la API del DOM.

La configuración se ejecuta en `meeko dev`, `meeko build` y `meeko check`. En un workspace de confianza el servidor de lenguaje también la ejecuta, con sus módulos, por lo que las listas pueden construirse dinámicamente; en un workspace no confiable (o con `trusted: false`, ver [editores](editors.md)) el editor no ejecuta código del proyecto: lee `layers`, `extends`, `imports.appDirs`, `imports.sharedDirs` e `imports.serverDirs` como arrays literales de cadenas y, de `modules`, sólo las cadenas literales que son carpetas de layer. Desde `1.5` lee también `alias` cuando es un objeto literal de cadenas y `false`. Los autoimports y componentes de los módulos no existen para ese editor hasta que se confía en el workspace.

El descubrimiento de servidor también rechaza árboles de cliente imposibles. Por ejemplo, no permite que `api.users.get()` sea a la vez una función y el padre de `api.users.get.post()`, ni que un procedimiento `rpc.users()` sea el padre de `rpc.users.get()`. El error se produce al generar el manifiesto e identifica ambos archivos, antes de inicializar el cliente o emitir tipos contradictorios.

`meeko routes .` descubre todas las fuentes, emite `.meeko/manifests/routes.json` y declaraciones de rutas, contratos y autoimports; desde `1.7` prepara `.meeko/` igual que `meeko check` (también las entradas de Vite, `services.d.ts` y los `tsconfig.*.json`), sin ejecutar TypeScript. Vite genera módulos virtuales a partir del mismo descubrimiento para SSR, hidratación y navegación. En desarrollo, editar una página o layout existente actualiza el módulo SSR y recarga el navegador; el servidor conserva el almacén de sesiones. Los sidecars y handlers API/RPC existentes se cargan desde Vite al llamarlos.

Al crear o eliminar una página, un layout, `app/app.meeko`, `app/error.meeko`, un middleware de `app/middleware` o `server/middleware`, un plugin de `app/plugins`, o un módulo de `server/api`, `server/rpc` o `server/socket`, en el proyecto o en sus layers, `meeko dev` vuelve a descubrir las rutas y crea de nuevo la aplicación sin reiniciar el proceso:

- Las peticiones que llegan mientras tanto esperan a la aplicación nueva, y el navegador se recarga.
- El servidor Socket se vuelve a enganchar a la aplicación nueva; las conexiones abiertas se cierran.
- La aplicación nueva llama otra vez a `server/runtime.ts`, así que un almacén de sesiones en memoria empieza vacío y las sesiones abiertas se pierden.
- Si la aplicación nueva no se puede crear (por ejemplo, con dos layouts raíz), Meeko registra el error y sigue sirviendo la anterior hasta que se corrija.

Cuando Vite se reinicia (al cambiar un `.env` o una dependencia de su configuración), `meeko dev` también crea de nuevo la aplicación, con las mismas consecuencias, una vez que el servidor de Vite nuevo está listo. Si coincide con la creación o eliminación de una ruta, crea una sola aplicación.

Crear, editar o eliminar un `.ts` de una carpeta de autoimports (las de por defecto y, desde `1.3`, las de `imports.appDirs`, `sharedDirs` y `serverDirs`) vuelve a leer el registro de autoimports e invalida los módulos, y el navegador se recarga; no hace falta reiniciar. Editar un canal Socket existente, cambiar `meeko.config.ts` (también las listas de `imports`) o editar el código de `setup` de un módulo sigue exigiendo reiniciar `npm run dev` (los archivos de runtime de un módulo, como sus plugins o componentes, se recargan como los del proyecto). Los tipos y manifiestos de `.meeko/` no se regeneran en `meeko dev`: ejecute `npm run check` para actualizarlos.

El observador de archivos de Vite ignora todo `.meeko/` salvo `.meeko/generated`, las entradas que sirve. Así, `meeko check`, el servidor de lenguaje o un build que escriben en `.meeko/check`, `routes`, `types`, `manifests`, `output`, `build` o en los `tsconfig.*` generados mientras corre `meeko dev` no recargan el navegador, y el escaneo de dependencias de Vite tampoco entra en `.meeko/`.

### Logs del servidor en la consola del navegador

Desde `1.3`, en `meeko dev`, lo que el código de servidor escribe con `console.log`, `info`, `warn`, `error` o `debug` mientras atiende una petición aparece también en la consola del navegador, como `features.devLogs` de Nuxt. La terminal lo sigue mostrando igual: los logs se copian, no se desvían.

- **Qué se reenvía.** Cada llamada se asocia a su petición por el contexto asíncrono de esa petición, así que dos peticiones simultáneas no mezclan sus logs. Cuenta todo lo que se ejecuta para ella: middleware de servidor y de ruta, loaders, `<script server>`, plugins `*.server.ts`, el render, los clientes `api.*` y `rpc.*` del SSR, handlers de API y RPC y el trabajo asíncrono que inician, también el de `waitUntil`. Lo que se escribe fuera de una petición (el arranque, la fábrica de `server/runtime.ts`, Vite, los callbacks de Socket) sólo va a la terminal.
- **Cómo llega.**
  - El documento HTML lleva los logs de su render en `<head>`, y el navegador los imprime al cargar, antes de hidratar en la práctica. Los dos scripts que Meeko añade allí llevan el nonce del documento (el `'nonce-…'` de su cabecera `Content-Security-Policy` o, sin él, el atributo `nonce` de sus scripts, que escribe `DocumentOptions.nonce`), así que funcionan con una CSP con nonce o con `'strict-dynamic'`.
  - Con `render: "stream"`, los que se escriben mientras llegan los valores diferidos van en el stream, detrás del bloque al que pertenecen y siempre fuera de `#app`, que el navegador hidrata.
  - Una navegación cliente recibe los logs de su petición de datos en el payload.
  - Las peticiones de API y RPC, y lo que se escribe después de completar una respuesta, llegan por el WebSocket de HMR de Vite. Como no se sabe qué pestaña hizo la petición, se imprimen en todas las pestañas abiertas de la aplicación, con el método, la ruta y el `requestId`.
- **Cómo se ve.** Cada petición es un grupo de la consola con la insignia `server`, el método, la ruta y el principio del `requestId` (el de la cabecera `x-request-id`), y cada log lleva la misma insignia y su nivel (`console.warn` es un aviso, `console.error` un error). Los objetos se pueden desplegar como en el servidor: `Map`, `Set`, fechas, `bigint`, referencias circulares y nombres de clase. Un `Error` muestra la traza del servidor, con sus archivos y líneas, y su `cause`. Las funciones, los símbolos y los datos binarios se muestran por su nombre o su descripción. Los getters no se ejecutan y los proxies no se atraviesan. Un valor más profundo de 8 niveles, una colección de más de 100 elementos o un texto de más de 10 000 caracteres se recortan; una petición con más de 500 logs, o con más de 1 MB de ellos, avisa de cuántos quedaron sólo en la terminal.
- **Sin duplicados.** Cada log llega una sola vez al navegador, por un único camino. El informe de un error de petición que Meeko ya escribe (`[meeko] request error <id>` y el error con su traza) llega también por este camino y una sola vez. Con `server.forwardConsole` de Vite, que copia la consola del navegador en la terminal, los logs del servidor no vuelven a la terminal.
- **Sólo en desarrollo.** Ni la captura de `console` ni el código del navegador existen en `meeko build`, `meeko start` o `meeko preview`: el HTML, los payloads y los bundles de producción no los incluyen.
- **Sólo para el navegador del desarrollador.** Las respuestas sólo llevan los logs si la petición llega desde loopback (`127.0.0.0/8` o `::1`), con una cabecera `Host` de loopback (`localhost`, un subdominio de `.localhost`, `127.x.x.x` o `[::1]`) y sin cabeceras de proxy (`Forwarded`, `Via`, `X-Forwarded-*`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP` y similares). El host de `MEEKO_PUBLIC_ORIGIN` no cuenta como propio: un túnel o un proxy local (ngrok, cloudflared, los _dev tunnels_ de VS Code, Tailscale) conecta desde loopback y publica justamente ese nombre, así que sus visitantes no reciben los logs aunque el túnel reescriba `Host` a `localhost`, porque añade cabeceras de reenvío. Con `MEEKO_HOST=0.0.0.0` (para probar desde un móvil, por ejemplo), o tras un túnel, un navegador de otra máquina no recibe logs en sus respuestas: los de sus peticiones se imprimen en las pestañas del propio equipo, porque el WebSocket de HMR de Meeko sólo escucha en `127.0.0.1`. Ese puerto (`MEEKO_HMR_PORT`) no debe publicarse por un túnel: quien se conecte a él recibe los logs de todas las peticiones, como una pestaña local.

Para desactivarlo:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({ dev: { serverLogs: false } })
```

El `href` tipado no admite `params` en rutas sin parámetros. Para rutas dinámicas exige las claves declaradas en el manifiesto; el runtime comprueba además sus valores y rechaza claves extra.

`href` tiene dos formas con los mismos tipos. `href(id, options)` usa el manifiesto de la aplicación en ejecución: en el servidor, el de la petición en curso (SSR, loaders, `head`, prerender, API, RPC y middleware de servidor); en el navegador, el que recibió `mountClientApp`, desde la hidratación hasta `dispose()`. Es la forma habitual en páginas y layouts:

```ts
const link = href('/users/[id]', { params: { id: user.id }, search: { tab: 'profile' } })
```

Fuera de una aplicación (por ejemplo, en una prueba unitaria sin app) la forma corta lanza un error; ahí se pasa el manifiesto con `href(routes, id, options)`, que se mantiene igual.

## Layers

Un layer es una carpeta del proyecto con la misma estructura que la aplicación: su `app/pages`, sus componentes y autoimports (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`, `shared/` y `server/utils`) y, desde `1.2`, sus plugins de `app/plugins`. Las carpetas de `imports.appDirs`, `sharedDirs` y `serverDirs` del proyecto se buscan también dentro de cada layer, con la misma ruta relativa (`app/services` es `layers/base/app/services` en el layer `./layers/base`). Use layers para una base compartida (diseño, páginas comunes) o para dividir una aplicación grande por áreas.

```ts
export default defineMeekoConfig({
	layers: ['./layers/base', './layers/admin'],
})
```

El orden de las fuentes es: la aplicación, `extends`, `layers`, las carpetas de layer que quedan en `modules` (véase más abajo) y los layers que añaden los módulos con `meeko.addLayer`. Cada layer necesita su carpeta `app/pages` y un nombre de carpeta en minúsculas, dígitos y guiones que no se repita; aparece con ese nombre en los diagnósticos. Las rutas de `layers` y `extends` deben vivir dentro del proyecto, también después de resolver los enlaces.

Las páginas de un layer se muestran dentro del shell del proyecto: `app/app.meeko` y el layout raíz de la aplicación (`app/layouts/default.meeko` o `app/pages/+layout.meeko`) envuelven también a las páginas de los layers, y los `+layout.meeko` propios del layer se anidan dentro. Desde `1.5`, los [layouts con nombre](framework-rendering.md#layouts-con-nombre) de un layer (`layers/base/app/layouts/docs.meeko`) también sirven a las páginas del proyecto y de los demás layers; véase [Layouts de layers y módulos](framework-rendering.md#layouts-de-layers-y-módulos). Si el proyecto tiene `app.meeko` o layout raíz, sustituyen a los equivalentes del layer; si no, se usan los del layer. Una página de layer que falla usa el `+error.meeko` más cercano de su propio árbol, después el `app/error.meeko` del layer y, por último, la página de error raíz del proyecto. La `404` de una URL sin ruta siempre usa la del proyecto. Los módulos de rutas programáticos (`RouteModule.routes()` de `composeFrameworkRoutes`) siguen declarando sus propios layouts. El manifiesto rechaza colisiones de URL y el registro rechaza nombres de autoimport repetidos; el diagnóstico incluye los archivos en conflicto.

`extends` es el nombre que tenía `layers` hasta `1.1` y sigue funcionando en `1.x`, sin aviso; sus carpetas van antes que las de `layers`.

Desde `1.5`, los [aliases de ruta](#aliases-de-ruta) `~/`, `@/`, `#shared/` y `#server/` se buscan en el proyecto y después en cada layer, en este mismo orden; véase [Aliases en los layers](#aliases-en-los-layers).

### Carpetas en `modules` (deprecado)

Hasta `1.1`, `modules` también listaba carpetas con `app/pages`, que se comportaban como layers. Desde `1.2`, `modules` es para [módulos](#módulos). Una cadena de `modules` que apunta a una carpeta con `app/pages` y sin módulo (sin `package.json` ni `index.ts`) sigue funcionando como layer durante toda la serie `1.x`, en la misma posición que antes. `meeko dev`, `meeko build` y `meeko check` escriben una vez por proceso:

```text
[meeko] Aviso: "./modules/auth" en modules de meeko.config.ts es una carpeta de layer (tiene app/pages y no es un módulo). Muévela a layers: ["./modules/auth"]; las carpetas en modules dejarán de funcionar en Meeko 2.0.
```

Para migrar, mueva la cadena de `modules` a `layers`. Una carpeta de layer no admite opciones: `["./modules/auth", { … }]` es un error.

## Módulos

Un módulo configura el proyecto desde código, como los módulos de Nuxt: añade componentes, autoimports, plugins, middleware y handlers de servidor, entradas de `<head>`, archivos públicos y plugins de Vite, y reacciona a los hooks del build. Se crea con `defineMeekoModule`, se registra en `modules` con su nombre y recibe sus opciones en su propia clave de `meeko.config.ts`, la que declara su `meta.configKey`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/i18n', '@meekojs/ui', './modules/accent'],
	i18n: { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } },
	ui: { defaults: { button: { shape: 'pill' } } },
	accent: { initial: 'teal' },
})
```

No se importa nada: `meeko.config.ts` sólo nombra los módulos. Una cadena es un nombre de paquete instalado o una ruta relativa al proyecto:

- **Un paquete** (`'@meekojs/i18n'`, con o sin subruta) se resuelve desde el proyecto. Si el paquete exporta el subpath `./module` (como `@meekojs/i18n`, cuya raíz es su runtime), el módulo es el export por defecto de `<paquete>/module`; si no, el export por defecto de la raíz (como `@meekojs/ui`).
- **Una ruta** (`'./modules/accent'`) es un archivo o una carpeta con `package.json` (su export `import`/`default`) o con `index.ts`, `index.mts`, `index.js` o `index.mjs`.

El export por defecto debe ser el resultado de `defineMeekoModule`. Las opciones se combinan así: `defaults` del módulo y después `config[meta.configKey]`; los objetos planos se combinan en profundidad y los arrays se sustituyen. Los módulos se ejecutan en el orden de `modules`, uno tras otro (Meeko espera cada `setup`), y después el hook `ready`; ese orden decide el de sus plugins, middleware, entradas de `<head>` y hojas de estilos. Dos módulos con el mismo `meta.name` o la misma `meta.configKey` son un error. Con `meta.compatibility.meeko` (un rango de npm, como `">=1.2"` o `"^1.2.0"`), la carga falla si la versión de Meeko queda fuera.

Los errores dicen qué falta:

- Una cadena que no resuelve: `No se encuentra el módulo de Meeko @meekojs/i18m: no es un paquete instalado ni una ruta del proyecto. ¿Quisiste decir "@meekojs/i18n"?` (o, sin parecido, cómo instalarlo).
- Un paquete sin módulo: `El paquete x no es un módulo de Meeko: … debe exportar por defecto defineMeekoModule(...), en su subpath ./module o en su raíz`.
- La clave de un módulo instalado que no está en `modules`, como `i18n: { … }` sin `'@meekojs/i18n'`, es el aviso `MEEK127`, que indica la entrada que falta: `[meeko] Aviso MEEK127: meeko.config.ts tiene la clave "i18n", que es la configKey del módulo @meekojs/i18n, pero @meekojs/i18n no está en modules, así que Meeko ignora sus opciones. Añádalo: modules: ["@meekojs/i18n"].` Es un aviso y no un error durante `1.x`, porque esa configuración cargaba (ignorando la clave) hasta `1.7`. Cualquier otra clave desconocida da el aviso de siempre, con la clave conocida más parecida.

#### Tipos de las opciones sin imports

La clave de cada módulo está tipada aunque `meeko.config.ts` no importe nada, como hace Nuxt con `.nuxt/nuxt.d.ts`. El módulo amplía `MeekoConfig` con su clave (`declare module '@meekojs/meeko/framework' { interface MeekoConfig { readonly i18n?: I18nModuleOptions } }`) y Meeko escribe `.meeko/types/config.d.ts`, que importa los tipos de cada módulo de `modules`, así que esa ampliación se carga sola. Lo generan `meeko dev`, `meeko check`, `meeko build` y `meeko routes`, y también el servidor de lenguaje de un workspace de confianza al abrir el proyecto, antes de la primera generación (sólo lee las cadenas de `modules`, sin ejecutar nada).

- **`meeko check`** comprueba `meeko.config.ts` con esos tipos (desde `1.8`; antes sólo cuando la carga fallaba): `i18n: { defaultLocale: 1 }` es `TS2322` con su línea y columna. También `meeko build`, que ejecuta las mismas comprobaciones.
- **El editor** tipa el archivo con `.meeko/tsconfig.config.json`, al que apunta el `tsconfig.json` que crea `meeko init`. En un proyecto anterior a `1.8`, añada `{ "path": "./.meeko/tsconfig.config.json" }` a `references`. Con él, el editor completa y documenta la clave (`i18n`, `ui`) y marca una opción mal tipada.
- **Completado de nombres.** Dentro de `modules: ['…']`, el editor ofrece los paquetes instalados que son módulos: las dependencias del `package.json` del proyecto con la palabra clave `meeko-module` en el suyo (`"keywords": ["meeko-module"]`), además de los ya listados. Un módulo publicado debe declararla. Cualquier otra cadena sigue siendo válida.

- **Tipos que genera el módulo.** Las declaraciones que un módulo escribe con `meeko.addTypeTemplate` (en `.meeko/types/modules/`, enlazadas por `.meeko/types/modules.d.ts`) también tipan `meeko.config.ts`, en `meeko check` y en el editor. Así un módulo puede tipar sus opciones con lo que descubre al ejecutarse: `@meekojs/icon` genera la unión de los nombres de icono disponibles y `icon: { include: ['lucide:chek'] }` es `TS2820` con la sugerencia `"lucide:check"`. `meeko check` ejecuta los módulos antes de comprobar la configuración, así que la unión está al día.

Los módulos oficiales `@meekojs/ui`, `@meekojs/i18n` y `@meekojs/icon` (iconos de Iconify resueltos al compilar, con `<UIIcon>`; véase [su guía](https://ui.meekojs.com/icons)) se registran de esta forma.

Las formas de registro anteriores a `1.8` siguen funcionando durante `1.x` con el aviso `MEEK126`, que indica la cadena y la clave que las sustituyen; véase [Actualizar de 1.7 a 1.8](migration-1.8.md#módulos-por-su-nombre).

### Escribir un módulo

El `setup` se ejecuta en Node, una vez por configuración y proceso, al cargar la configuración: en `meeko dev`, `meeko build`, `meeko check` y en el servidor de lenguaje de un workspace de confianza. Nunca llega al navegador. Recibe las opciones combinadas y el objeto `meeko`. Las rutas que recibe `meeko` pueden ser absolutas, URL `file:` (`new URL("./x", import.meta.url)`, lo habitual en un paquete) o relativas a la raíz del proyecto.

Un módulo de color de acento, que el usuario elige y que se aplica antes de pintar (para el tema claro/oscuro no hace falta un módulo: Meeko lo trae desde `1.4`, véase [Tema claro/oscuro sin parpadeo](framework-rendering.md#tema-clarooscuro-sin-parpadeo)):

```ts
// modules/accent/index.ts
import { defineMeekoModule } from '@meekojs/meeko/framework'

export type Accent = 'teal' | 'violet' | 'amber'

export interface AccentOptions {
	initial: Accent
	storageKey: string
}

// Tipa la clave `accent` de meeko.config.ts.
declare module '@meekojs/meeko/framework' {
	interface MeekoConfig {
		readonly accent?: Partial<AccentOptions>
	}
}

export default defineMeekoModule<AccentOptions>({
	meta: { name: '@acme/meeko-accent', configKey: 'accent', compatibility: { meeko: '>=1.2' } },
	defaults: { initial: 'teal', storageKey: 'accent' },
	setup(options, meeko) {
		const here = (path: string) => new URL(path, import.meta.url)
		// <AccentPicker /> en cualquier componente, sin import.
		meeko.addComponentsDir(here('./components'), { prefix: 'Accent' })
		// useAccent() sin import, en componentes y en app/.
		meeko.addAutoImports({ name: 'useAccent', from: here('./runtime/use-accent.ts') })
		// Publica la señal del acento antes de hidratar; las opciones llegan al plugin.
		meeko.addPlugin({ src: here('./runtime/accent.plugin.ts'), options: { initial: options.initial, storageKey: options.storageKey } })
		// Aplica el acento guardado antes de pintar, sin parpadeo.
		meeko.addHead({
			script: [{ key: 'accent', children: `document.documentElement.dataset.accent = localStorage.getItem(${JSON.stringify(options.storageKey)}) ?? ${JSON.stringify(options.initial)};` }],
		})
	},
})
```

```ts
// modules/accent/runtime/use-accent.ts
import { createContext, inject } from '@meekojs/meeko'
import type { Signal } from '@meekojs/meeko'
import type { Accent } from '../index.ts'

export const accentKey = createContext<Signal<Accent>>('accent')

export function useAccent(): Signal<Accent> {
	return inject(accentKey)
}
```

```ts
// modules/accent/runtime/accent.plugin.ts
import { effect, signal } from '@meekojs/meeko'
import { definePlugin } from '@meekojs/meeko/framework'
import type { Accent } from '../index.ts'
import { accentKey } from './use-accent.ts'

export default definePlugin<{ initial: Accent; storageKey: string }>((app, options) => {
	// El mismo valor inicial en el servidor y en el navegador, para que la hidratación coincida.
	const accent = signal(options.initial)
	app.provide(accentKey, accent)
	if (app.side === 'client') {
		let first = true
		effect(() => {
			const value = accent.value
			// El script de <head> ya aplicó el acento guardado; después, cada cambio se aplica y se guarda.
			if (first) {
				first = false
				return
			}
			document.documentElement.dataset.accent = value
			localStorage.setItem(options.storageKey, value)
		})
	}
})
```

Un módulo de SEO genera `sitemap.xml` a partir de las rutas y `robots.txt`:

```ts
import { defineMeekoModule } from '@meekojs/meeko/framework'

export default defineMeekoModule<{ siteUrl: string }>({
	meta: { name: '@acme/meeko-seo', configKey: 'seo' },
	setup(options, meeko) {
		let routes: readonly { id: string }[] = []
		meeko.hooks.hook('routes:resolved', (context) => {
			routes = context.routes
		})
		meeko.addPublicFile('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${options.siteUrl}/sitemap.xml\n`)
		// Una función se evalúa al escribir el build (y en cada petición en dev), con las rutas ya descubiertas.
		meeko.addPublicFile('sitemap.xml', () =>
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
				...routes.filter((route) => !route.id.includes('[')).map((route) => `<url><loc>${options.siteUrl}${route.id}</loc></url>`),
				'</urlset>',
			].join('\n'),
		)
	},
})
```

Los archivos de runtime de un módulo (plugins, componentes, autoimports, middleware y handlers) los procesa Vite como los del proyecto, pero fuera de las carpetas de la aplicación no reciben autoimports: impórtelos de forma explícita. Los componentes `.meeko` de `addComponentsDir` sí reciben los autoimports del proyecto.

### El objeto `meeko`

| Miembro                                        | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`, `dev`, `config`                     | Carpeta del proyecto, `true` en `meeko dev` y la configuración cargada.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `addLayer(dir)`                                | Añade un layer, después de los de `layers`. Debe tener `app/pages` y estar dentro del proyecto; un paquete instalado en `node_modules` lo está, también con pnpm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `addComponentsDir(dir, { prefix?, exclude? })` | Autoimporta los `.meeko` de la carpeta y sus subcarpetas, con el nombre en PascalCase tras el prefijo (`components/picker.meeko` con `prefix: "Accent"` es `AccentPicker`). `exclude` admite globs relativos a esa carpeta, como `['internal/**', '**/*.private.meeko']`: los archivos excluidos no entran en `ComponentName`, los loaders ni los tipos globales generados, pero siguen disponibles mediante imports explícitos.                                                                                                                                                                                                                                            |
| `addLayout(name, file)`                        | Desde `1.5`, añade un [layout con nombre](framework-rendering.md#layouts-con-nombre), como un archivo de `app/layouts`: `meeko.addLayout("docs", here("./docs-layout.meeko"))`. El archivo debe estar dentro del proyecto. Un layout del proyecto o de un layer con el mismo nombre gana; dos módulos con el mismo nombre son un error.                                                                                                                                                                                                                                                                                                                                                           |
| `extendRoutes(fn)`                             | Desde `1.8`, transforma el manifiesto de rutas descubierto (aplicación, layers y módulos) antes de que lo usen el servidor, el navegador, el prerender, el sitemap y los tipos. `fn(routes)` devuelve la lista completa: puede añadir rutas que reutilizan el archivo de una página (`{ ...route, id: "/en" + route.id }`, como hace `@meekojs/i18n`), cambiarlas o quitarlas. Se aplican en el orden de los módulos y el resultado se valida como un manifiesto: una colisión de URL es un error con el nombre del módulo.                                                                                                                                                 |
| `addAutoImports(entries)`                      | Autoimporta exports de un paquete o archivo: `{ name, as, from, type?, scope?, componentOnly? }`; `scope` es `"app"` por defecto (componentes y `app/`, en el navegador y en SSR), `"client"`, `"server"` o `"shared"`. Con `componentOnly: true` y `scope: "app"`, el nombre se ofrece en componentes y módulos de `app/` que pueden ejecutarse en el navegador, pero no en `<script server>` ni en `server/`.                                                                                                                                                                                                                                                             |
| `addAutoImportsDir(dir, { scope })`            | Autoimporta los exports de los `.ts` de una carpeta, con ámbito `"app"`, `"server"` o `"shared"`; los sufijos `.client.ts`, `.server.ts` y `.shared.ts` mandan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `addPlugin({ src, mode?, options? })`          | Añade un [plugin de aplicación](#plugins-de-aplicación). `mode` sale del sufijo del archivo o es `"universal"`. `options` debe ser JSON y llega al navegador si el plugin se ejecuta allí.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `addServerMiddleware(file)`                    | Añade un middleware como los de `server/middleware`; los de los módulos van antes que los del proyecto.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `addServerHandler({ route, handler })`         | Atiende una ruta exacta con el export por defecto de `handler`, `(request) => Response`, después del middleware de servidor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `addPublicFile(path, contents, options?)`      | Añade un archivo público. `meeko build` lo escribe en la salida del cliente, antes de calcular el manifiesto de assets; `meeko dev` lo sirve. Choca con un archivo de `public/` del mismo nombre. Desde `1.8`, `options.headers` añade cabeceras a su respuesta en `meeko dev` y en los adaptadores con servidor; por ejemplo, `Access-Control-Allow-Origin` en una fuente que usa un `<iframe sandbox srcdoc>`. En producción actúan como `server.headers` para esa ruta, que gana si fija la misma. En `meeko dev`, los archivos públicos no pasan por la aplicación: llevan sólo estas cabeceras y `server.headers` no les afecta. El adaptador `static` no las escribe. |
| `addStylesheet(file)`                          | Registra un archivo `.css` procesado por Vite y el PostCSS del proyecto. Acepta una ruta relativa a `rootDir` o una URL de archivo del módulo. Las hojas se deduplican por archivo real y conservan el orden de registro; `app/styles/main.css` se carga al final. Incluye HMR, resolución de imports y assets, CSS en el HTML de SSR y assets con hash en producción.                                                                                                                                                                                                                                                                                                      |
| `addHead(input)`                               | Añade entradas a `document.head`: `meta`, `link`, `script` y `style` se concatenan en el orden de los módulos; `title`, `titleTemplate`, `htmlAttrs` y `bodyAttrs` se quedan con el último valor; `document.head` del proyecto se aplica al final. Recibe un `DocumentHead`: `titleTemplate` es una cadena y `title` es el título del sitio, sin plantilla.                                                                                                                                                                                                                                                                                                                 |
| `addVitePlugin(plugin)`                        | Añade un plugin de Vite a `meeko dev` y a cada build de `meeko build`, después del de Meeko.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `extendViteConfig(fn)`                         | Modifica la configuración inline de Vite de cada paso; `fn(config, { command, ssr })` cambia el objeto o devuelve otro.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `hooks.hook(name, fn)`                         | Registra un [hook](#hooks).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `warn(message)`                                | Escribe un aviso con el nombre del módulo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Un host de Vite propio que sólo usa el plugin `meeko()` recibe los autoimports, componentes, layers y plugins de aplicación de los módulos, pero no sus `addVitePlugin`, `extendViteConfig`, archivos públicos ni hooks: esos los aplican `meeko dev` y `meeko build`.

Meeko no tiene un `runtimeConfig` aparte: un módulo pasa valores a su runtime con las `options` de `addPlugin` (públicas si el plugin llega al navegador), y los secretos se leen en el servidor de las variables de entorno o de `server/runtime.ts`.

### Hooks

| Hook               | Cuándo                                                                                               | Contexto                                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`            | Todos los módulos terminaron su `setup`.                                                             | —                                                                                                                                                                                                                                             |
| `routes:resolved`  | Antes del build del cliente en `meeko build`; al arrancar y en cada redescubrimiento en `meeko dev`. | `{ routes }`, el manifiesto con rutas de archivo absolutas.                                                                                                                                                                                   |
| `build:before`     | Al empezar `meeko build`.                                                                            | `{ adapter, output }`, la carpeta absoluta del adaptador.                                                                                                                                                                                     |
| `prerender:routes` | Antes de prerenderizar, en `meeko build` y `meeko prerender`.                                        | `{ urls }`: los `pathname` que se van a prerenderizar; el hook puede añadir o quitar entradas, que deben corresponder a una ruta.                                                                                                             |
| `sitemap:resolved` | Desde `1.8`, en `meeko build` con `sitemap`, antes de escribir `sitemap.xml`.                        | `{ urls }`: las URL ordenadas (`{ pathname, lastmod?, changefreq?, priority?, alternates? }`); el hook puede sustituirlas, añadirlas o quitarlas. Cada `alternates: [{ hreflang, pathname }]` se escribe como `<xhtml:link rel="alternate">`. |
| `build:done`       | Al terminar `meeko build`, prerender incluido.                                                       | `{ adapter, output }`; el módulo puede escribir más archivos en `output`.                                                                                                                                                                     |

Los hooks se ejecutan en el orden en que se registraron y Meeko espera a cada uno. `hook()` devuelve una función que lo quita.

### Plugins de aplicación

Los archivos de `app/plugins` (de la aplicación y de sus layers) y los que añaden los módulos se ejecutan al arrancar la aplicación. Cada uno exporta por defecto `definePlugin`:

```ts
// app/plugins/analytics.client.ts
import { definePlugin } from '@meekojs/meeko/framework'

export default definePlugin((app) => {
	effect(() => navigator.sendBeacon('/api/visits', app.route.path.value))
	app.onError((error, info) => console.error('[app]', info.side, error))
})
```

- **Dónde.** `*.client.ts` sólo en el navegador, una vez, antes de la hidratación. `*.server.ts` sólo en el servidor, una vez por petición de página, antes del render (también al prerenderizar; no en las páginas ya prerenderizadas, ni en API, RPC o handlers). Un `.ts` sin sufijo, en los dos. Sólo cuentan los archivos que están directamente en `app/plugins`; las subcarpetas pueden guardar sus auxiliares. Se excluyen `*.test.ts`, `*.spec.ts` y `*.d.ts`.
- **Orden.** Los de los módulos, en el orden en que los añaden; después los de cada layer y los de la aplicación, por nombre de archivo. Meeko espera a cada `setup`, que puede ser asíncrono.
- **`app.provide(key, value)`.** Publica un valor para todos los componentes de la aplicación, que lo leen con `inject(key)` (y el composable que lo envuelva): las páginas, layouts, `app.meeko`, la página de error y las páginas a las que se navega en el navegador. En el servidor el valor es de esa petición: no comparta estado mutable entre peticiones. Un componente que se hidrata debe recibir el mismo valor en el servidor y en el navegador; por eso los valores que se renderizan suelen venir de un plugin universal.
- **`app.onError(handler)`.** En el navegador, el observador recibe lo mismo que `mountClientApp({ onError })` (navegación, Socket y eventos, efectos y limpiezas sin un `provideErrorHandler` más cercano y, desde `1.3`, las excepciones y los rechazos globales de la página; véase [Errores](framework-server.md#errores)), con `{ side: "client", source }`. En el servidor recibe los fallos del render de esa petición, con `{ side: "server", requestId }`, además del `onError` de `server/runtime.ts`.
- **`app.resolveLink(resolver)`.** Desde `1.8`, recibe cada `<MeekoLink>` de la aplicación (`{ to, href, hreflang }`: el ID de la ruta, el `href` que construyó `href()` y el `hreflang` del enlace) y devuelve su `href` final; `aria-current` se calcula con ese `href`. Varios resolvedores se encadenan en el orden de los plugins. Se ejecuta al renderizar el enlace en el servidor, en la hidratación y en la navegación del cliente, así que debe ser puro: el mismo enlace da el mismo `href` en los dos lados. `@meekojs/i18n` lo usa para el prefijo de idioma; véase [`<MeekoLink>`](framework-rendering.md#meekooutlet--y-meekolink).
- **`app.route`.** La ruta, como `useRoute()`. En el servidor es la de la petición; en el navegador sigue a la ruta confirmada, así que un `effect` que la lee se repite al navegar. `app.request` es la petición en el servidor y `undefined` en el navegador; `app.side` dice dónde se ejecuta.
- **Fallos.** Un plugin que lanza en el servidor hace fallar la petición, que muestra la página de error sin los valores de los plugins. En el navegador, la hidratación no llega a empezar y la página se queda con el HTML del servidor.

Un host propio pasa los plugins a `mountClientApp({ plugins })` y a `createServerApp({ plugins })` o `createFrameworkHandler({ plugins })`, como `PluginRegistration`s (`{ plugin, options?, name? }`).

### Límites entre servidor y cliente

El `setup` de un módulo y su entrada nunca llegan al bundle del navegador, y tampoco sus plugins `"server"`, su middleware, sus handlers, sus carpetas de autoimports con `scope: "server"` ni los `*.server.ts` de las carpetas del módulo. El plugin de Vite de Meeko rechaza el build si el grafo del cliente los alcanza (`Server-only module reached the client bundle`), y si un archivo que el navegador carga importa `defineMeekoModule` (`Meeko module setup reached the client bundle`): sólo `meeko.config.ts` debe importar los módulos. Las opciones de un plugin que se ejecuta en el navegador sí viajan en el bundle del cliente.

## Autoimports y TypeScript

Los componentes `.meeko` de directorios configurados también forman un [registro tipado por nombre](reference/components/componentregistry.md): `ComponentName`, `ComponentOf<Name>` y `ComponentProps<Name>` describen los módulos descubiertos, y `resolveComponent(name)` los carga de forma asíncrona. `resolveComponent(name, props)` también permite asociar sus props y devuelve un `ResolvedComponent<Name>` que se renderiza directamente con `<component is>`. La guía incluye configuración, layers, módulos y límites de SSR de la carga diferida.

**Imports sin extensión.** Desde `1.2`, Meeko comprueba los tipos con `"module": "ESNext"` y `"moduleResolution": "Bundler"`, como Vite y Nuxt: un import relativo no necesita extensión (`import { format } from "../utils/format"`), porque Vite resuelve y empaqueta todo el código en `meeko dev` y en `meeko build`, y Node nunca ejecuta un `.ts` directamente. Los imports con `.js` siguen funcionando. `meeko init-framework` genera el `tsconfig.json` con esos valores; un proyecto anterior puede cambiar sus dos líneas `"module": "NodeNext"` y `"moduleResolution": "NodeNext"` para que el editor también acepte los imports sin extensión en sus `.ts`.

Meeko analiza exports AST de `app/{components,composables,utils,stores,types}` (`app/types` desde `1.2`), `shared/{types,schemas,utils,constants,enums}` y `server/utils`: sus exports nombrados, nunca un `export default` (`export default function formatPrice()` no se autoimporta; escriba `export function formatPrice()`). Los tipos que sólo usa la aplicación van en `app/types`; los que comparten la aplicación y el servidor, en `shared/types`. Un `type` o una `interface` autoimportados llegan con `import type`. Los símbolos de `app/` están disponibles en cliente y SSR, pero no desde `shared/`; los sufijos `.client.ts` y `.server.ts` restringen un módulo a su entorno. `imports.serverDirs` añade directorios privados exclusivos del servidor y, desde `1.3`, `imports.appDirs` e `imports.sharedDirs` añaden carpetas de `app/` y de `shared/` (véase [Carpetas de autoimports](#carpetas-de-autoimports)). Los símbolos del framework `api`, `rpc`, `socket`, `useSocket`, `useApi`, `useRpcQuery`, `useRpcMutation`, `useState`, `href` y `useRoute`, desde `1.2` `useForm`, `useStorage`, `useApiMutation`, `useHead`, `useSeoMeta`, `definePage`, `defineRouteMiddleware` y `definePlugin`, desde `1.4` `useTheme` (`definePage` sólo tiene efecto en `<script server>` y en los sidecars: en el `<script>` de un componente da el aviso `MEEK109`), y en el código de servidor (`server/` y `<script server>`) `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime` y `ApiError` (y, desde `1.6`, `defineServerRouteMiddleware`, que también se autoimporta en los `*.server.ts`; desde `1.7`, `defer`, también en los sidecars `*.route.ts` y dentro de las opciones de ruta), y de la raíz `signal`, `computed`, `effect`, `batch`, `untrack` (desde `1.2`), `onCleanup`, `onMounted`, `provide`, `inject`, `createContext` y `provideErrorHandler`, también figuran en el registro, con `useNavigation` y `createRoot` desde `1.7`; un export propio llamado `useRoute`, `useForm`, `useStorage`, `useApiMutation`, `useHead`, `useSeoMeta`, `useTheme` o, desde `1.6`, `defineServerRouteMiddleware` y, desde `1.7`, `useNavigation`, `createRoot` o `defer` tiene prioridad sobre el del framework. `redirect` y `notFound` no se autoimportan fuera de `<script server>`, tampoco en `app/middleware/*.server.ts`: sus tipos serían globales en todo el proyecto `server`, incluidas las API, donde fallarían en ejecución con `MEEK073`. Los imports explícitos prevalecen. Una colisión produce error; nunca se elige por orden de archivos. Un `enum` o una clase autoimportados sirven también como tipo, con sus miembros (`Scope.App`); si un archivo sólo los usa como tipo, Meeko inserta `import type`. Los schemas de `shared/schemas` pueden llegar por autoimport a los contratos de API, RPC y Socket. `meeko check` comprueba los `.ts` que importa un `.meeko` con los autoimports de su ámbito y con las rutas generadas, igual que los proyectos `tsconfig.*`.

<a id="carpetas-de-autoimports"></a>**Carpetas de autoimports.** Cada carpeta se lee de forma recursiva, en el proyecto y en cada layer; sus `.ts` y `.mts` aportan exports (sin `*.test.ts`, `*.spec.ts` ni `*.d.ts`), y los `.meeko` sólo son componentes en `app/components` y en las carpetas de componentes de los módulos. Los nombres de los exports son planos: la subcarpeta no se añade al nombre, a diferencia de los componentes (`App/Card.meeko` es `AppCard`). `export function total()` en `app/utils/cart/total.ts` es `total`, no `CartTotal`, y dos archivos que exportan `total` en un ámbito son el error de nombre repetido, aunque estén en carpetas distintas. Un `.mts` aporta sus exports como un `.ts`. Un `.cts` sólo sirve para tipos: `export type` funciona, pero un valor con `export` da `TS1287` en `meeko check` y `meeko build` y hace responder `500` a la página en `meeko dev`, y `export =` no aporta ningún nombre. Un archivo sin sufijo toma el ámbito de la carpeta raíz que lo contiene; `.client.ts`, `.server.ts` y `.shared.ts` mandan sobre él:

| Carpeta                                                                              | Ámbito    | Disponible en                                                                                                      |
| ------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`          | `app/`    | Componentes y `.ts` de `app/`, en el navegador y en SSR; también en `server/` y `<script server>`. No en `shared/` |
| `imports.appDirs` (desde `1.3`), p. ej. `"app/services"`                             | `app/`    | Igual que las carpetas de `app/` anteriores                                                                        |
| `shared/types`, `shared/schemas`, `shared/utils`, `shared/constants`, `shared/enums` | `shared/` | Todo el proyecto                                                                                                   |
| `imports.sharedDirs` (desde `1.3`), p. ej. `"shared/validators"`                     | `shared/` | Todo el proyecto                                                                                                   |
| `server/utils` e `imports.serverDirs`, p. ej. `"server/services"`                    | `server/` | `server/`, `<script server>` y sidecars; en un componente, `MEEK108`                                               |

Cada opción sólo admite rutas relativas dentro de su carpeta (`appDirs` dentro de `app/`, `sharedDirs` dentro de `shared/`, `serverDirs` dentro de `server/`), con `/` o `\` y sin `.` ni `..`: otra ruta detiene `meeko dev`, `meeko build` y `meeko check` con un error de `meeko.config.ts` que nombra la entrada (`imports.appDirs[1] debe ser una ruta relativa dentro de app/: …`) y que el editor, en un workspace de confianza, marca en ella (`MEEK_CONFIG`). Una carpeta que ya es de autoimports (`"app/composables"`) o que está dentro de otra de la lista no se lee dos veces. Los exports de estas carpetas siguen las mismas reglas que los de las carpetas por defecto: `import type` para `type` e `interface`, prioridad sobre los autoimports del framework y error si dos archivos exportan el mismo nombre en un ámbito. Un `*.server.ts` de una carpeta de `appDirs` es de servidor, y un componente que lo usa da `MEEK108`.

<a id="carpeta-con-index"></a>**Una carpeta con `Index.meeko`.** Desde `1.8`, `Button/Index.meeko` (o `index.meeko`) se llama como su carpeta: `<Button>`, y también en `resolveComponent("Button")`, en `is` con nombres y en sus tipos. Vale en `app/components`, en los layers y en las carpetas de los módulos con su prefijo (`UIButton`). `Index.meeko` en la raíz de la carpeta no tiene de dónde tomar el nombre y sigue siendo `<Index>`. El nombre anterior, `<ButtonIndex>` con sus tipos, sigue funcionando en `1.x` con el aviso `MEEK134` y se retira en `2.0`; el editor ya no lo ofrece, y un componente que se llame así de verdad lo conserva. Ese aviso sale al compilar un `.meeko`: fuera de él, `meeko check` no avisa, así que `ButtonIndexProps` en un `.ts` compila sin más, con la marca `@deprecated` de su declaración.

Si `Button.meeko` y `Button/Index.meeko` existen a la vez, también en fuentes distintas, nada cambia de archivo: `Button.meeko` conserva `<Button>` y `Button/Index.meeko` conserva `<ButtonIndex>`, sin marcarlo como obsoleto porque es su único nombre, con sus tipos y en `resolveComponent` e `is`. El aviso `MEEK135`, en ese `Index.meeko`, explica el conflicto y sugiere renombrar o mover uno de los dos.

Un nombre que ya existía tampoco cambia de archivo con un `Index` anidado. Con `Button/Index.meeko` y `Button/Index/Index.meeko`, el primero es `<Button>` y conserva `<ButtonIndex>` con `MEEK134`, y el segundo sigue siendo `<ButtonIndexIndex>`, sin marcarlo como obsoleto, porque `<ButtonIndex>` era del primero. El aviso `MEEK135`, en el archivo interior, dice qué archivo conserva cada nombre y sugiere renombrar o mover uno de los dos.

<a id="tipos-de-cada-componente"></a>**Tipos de cada componente.** Desde `1.4`, cada componente autoimportado (los `.meeko` de `app/components` del proyecto y de sus layers, y los de las carpetas de componentes de los módulos) aporta además varios tipos con el nombre de su etiqueta, sin import: el nombre del componente, con la misma regla que la etiqueta y el prefijo del módulo incluido, seguido de `Props` (desde `1.8`, sin los callbacks de `defineEmits`), `Emits` (desde `1.8`), `Snippets`, `Models` o `Exposed`. Un componente de un paquete publicado antes de `1.8` da los que exporta su `.d.meeko.ts`: su `Props` es su `ComponentProps`, con los callbacks, y no tiene `Emits`.

| Componente                                                    | Etiqueta         | Tipos                                                                                |
| ------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `app/components/App/Card.meeko`                               | `<AppCard>`      | `AppCardProps`, `AppCardEmits`, `AppCardSnippets`, `AppCardModels`, `AppCardExposed` |
| `app/components/Button/Index.meeko`                           | `<Button>`       | `ButtonProps`, `ButtonEmits`, `ButtonSnippets`, `ButtonModels`, `ButtonExposed`      |
| `app/components/user-menu.meeko`                              | `<UserMenu>`     | `UserMenuProps`, `UserMenuSnippets`, `UserMenuModels`, `UserMenuExposed`             |
| `components/picker.meeko` de un módulo con `prefix: "Accent"` | `<AccentPicker>` | `AccentPickerProps`, `AccentPickerSnippets`, …                                       |

- **Qué son.** Exactamente el `ComponentProps`, `ComponentSnippets`, `ComponentModels` y `ComponentExposed` del módulo del componente (véase [Módulo generado](api.md#módulo-generado)), con sus parámetros de tipo en un componente genérico (`DataTableProps<User>`). Un componente sin `defineSnippets`, `defineModel` o `defineExpose` da `null` en el tipo correspondiente, como su módulo: el alias no se convierte en `{}` para que el nombre con etiqueta y el genérico nunca difieran y `null` siga distinguiendo un componente que no declara el canal. Con `null`, `Omit<PlainSnippets, "x">` es `{}`, pero `PlainSnippets & { … }` es `never`: reutilice los snippets de un componente que los declara.
- **Dónde.** Con el mismo ámbito que el componente: en el `<script>` y la plantilla de los `.meeko` y en los `.ts` de `app/` (y, como los componentes, en `server/` y `<script server>`), nunca en `shared/`, donde son `TS2304` como cualquier símbolo de `app/`. Llegan como `import type` desde el `.meeko`, así que no añaden código al bundle.
- **Prioridad.** Un autoimport del proyecto con el mismo nombre gana sin aviso, como un export propio llamado `useRoute` frente al del framework: si `app/types` exporta `AppCardProps`, ése es el `AppCardProps` de todo el proyecto. Un import o una declaración del archivo prevalecen, como siempre.
- **Etiquetas propias.** Las etiquetas de Meeko aportan igual el tipo de sus props, con el mismo ámbito y la misma prioridad, desde los exports públicos de `@meekojs/meeko/framework`: `MeekoLinkProps` para `<MeekoLink>`, `MeekoOutletProps` para `<MeekoOutlet />` y `MeekoThemeToggleProps` para `<MeekoThemeToggle>` (véase [`<MeekoOutlet />` y `<MeekoLink>`](framework-rendering.md#meekooutlet--y-meekolink)). Llegan como `import type { MeekoLinkProps } from "@meekojs/meeko/framework"`. Un componente del proyecto que sustituye la etiqueta (`app/components/MeekoLink.meeko`, con el aviso `MEEK106`) aporta sus propios tipos con ese nombre, como cualquier componente: su `MeekoLinkProps` son sus props, no las de la etiqueta de Meeko.
- **Editor y `meeko check`.** Usan el mismo registro: se declaran en `.meeko/types/autoimports/client.d.ts` (y `server.d.ts`) junto al componente; el servidor de lenguaje los completa donde se escribe un tipo, y el hover y la navegación a definición llevan al componente, a la macro que declara cada tipo (`defineSnippets` para `AppCardSnippets`).

Con ellos, un componente reutiliza los snippets de otro sin import: `defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>()` (véase [Snippets con `defineSnippets`](api.md#snippets-con-definesnippets)).

Los `.ts` normales de `app/` (composables, utils, stores) se ejecutan en SSR y en el navegador, como los `.meeko` que los usan, y sus autoimports del framework (`api`, `rpc`, `socket`, `useSocket`, `useApi`…) se resuelven por entorno: el cliente de servidor en SSR y el del navegador en el navegador. Antes de `1.1` usaban siempre el del navegador, y `meeko dev` o `meeko build` fallaban con «Client-only module reached the server bundle». Un `.client.ts` sigue siendo sólo de navegador.

**Módulos `.client.ts` en `app/`.** Un `.meeko` se compila dos veces, para SSR y para el navegador, así que no puede usar un símbolo de un `.client.ts` ni importarlo de forma estática: `meeko check` y el build lo rechazan («unavailable in server scope», «Client-only module reached the server bundle»). Cárguelo con `import()` dentro de un código que sólo se ejecute en el navegador (un manejador de evento o un `effect`) y protéjalo con `import.meta.env.SSR`, que el build de servidor sustituye por `true` y con el que elimina ese import:

```ts
async function exportCsv(): Promise<void> {
	if (import.meta.env.SSR) return
	const { downloadCsv } = await import('../utils/download.client.js')
	downloadCsv(rows.value)
}
```

Un `.client.ts` sí puede importarse normalmente desde otros `.client.ts`.

**Stores (`app/stores`).** Es una carpeta de autoimports como `app/composables`; Meeko no define una API de store. Un `signal` creado a nivel de módulo vive mientras vive el proceso, así que en el servidor lo comparten todas las peticiones y usuarios. Para estado de la aplicación use `useState(key, init)` dentro de la función del store: es por petición en SSR, se transfiere al navegador en el payload y en el navegador se comparte entre componentes:

```ts
// app/stores/cart.ts
export function useCart() {
	const items = useState('cart:items', (): string[] => [])
	const add = (id: string): void => {
		items.value = [...items.value, id]
	}
	return { items, add }
}
```

El compilador `.meeko` y la transformación `.ts` insertan imports ESM reales. Las declaraciones por ámbito se regeneran bajo `.meeko/types/autoimports/` sólo cuando cambia el contenido, para autocompletado y navegación a definición. Los tipos genéricos reexportados conservan parámetros, restricciones y defaults; las firmas overload del mismo símbolo se registran una sola vez, mientras una colisión entre orígenes distintos sigue fallando. El servidor de lenguaje usa el mismo registro y las posiciones AST del compilador. Los proyectos app, server y shared generados por `meeko check` aplican también `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` y `verbatimModuleSyntax`. `shared/` no puede depender de símbolos app o servidor; el bundle cliente rechaza módulos `server/`, incluidos imports transitivos. Los `*.route.ts` pertenecen al ámbito servidor.

Al migrar código que no usaba esas opciones estrictas, cambie imports usados sólo como tipos a `import type`, compruebe el resultado de accesos por índice antes de usarlo y añada `| undefined` únicamente cuando la ausencia sea parte real del contrato. No silencie los diagnósticos ensanchando props o contratos públicos a `any`: Meeko usa esos tipos para generar el cliente, validar el servidor y mantener iguales CLI y editor.

## Aliases de ruta

Desde `1.5`, Meeko define cuatro aliases de ruta, sin configuración. Funcionan igual en Vite (`meeko dev` y `meeko build`, en el navegador y en SSR, con todos los adaptadores: `node`, `bun`, `deno`, `cloudflare` y `static`), en los `tsconfig` que genera Meeko (`.meeko/tsconfig.app.json`, `server` y `shared`, que usan `meeko check` y el editor) y en los módulos de [`@utilities`](#utilidades-generadas-con-typescript) y lo que importan (salvo con `meekoUtilities({ autoImports: false })`, que no lee la configuración):

| Alias      | Apunta a             | Dónde se puede usar                                                                                                      |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `~/`       | La raíz del proyecto | Todo el proyecto                                                                                                         |
| `@/`       | `app/`               | `app/` (componentes, páginas y `.ts`, que se ejecutan en el navegador y en SSR) y el código de servidor; no en `shared/` |
| `#shared/` | `shared/`            | Todo el proyecto                                                                                                         |
| `#server/` | `server/`            | Sólo el código de servidor: `server/`, los `*.server.ts`, los sidecars `*.route.ts` y `<script server>`                  |

`~/` es la raíz y `@/` es `app/`: al revés que en Nuxt, a propósito. `~/app/utils/price` y `@/utils/price` son el mismo módulo.

```ts
// app/pages/products/[id].route.ts
import { findProduct } from '#server/products'
import { productSchema } from '#shared/schemas/product'

export const route = definePage({ load: ({ params }) => productSchema.parse(findProduct(params.id)) })
```

```html
<!-- app/pages/products/[id].meeko -->
<script lang="ts">
	import { formatPrice } from '@/utils/price'
	import * as ProductCard from '@/components/catalog/ProductCard.meeko'
</script>
```

Un componente también se puede importar con un alias (`@/components/Card.meeko`); `MEEK033` sigue señalando un import de `.meeko` que no es relativo ni un alias.

Los schemas de los contratos de [API y RPC](framework-api.md#api-y-rpc) y de [WebSocket](framework-websocket.md#websocket) también se importan con un alias: `import { loginInput } from "#shared/schemas/auth"` en `server/api/auth/login.post.ts`, o con un alias propio que apunte a una carpeta de `shared/`. El generador de contratos resuelve el alias como `meeko check` y Vite, y los clientes generados (`api`, `rpc`, `socket`) nombran el archivo de `shared/` por su ruta, sin el alias. La regla es la misma que con una ruta relativa: el archivo debe estar en el `shared/` del proyecto, así que un alias que apunta a otra carpeta sigue dando `body debe venir de shared/`.

### Ámbitos de los aliases

Cada alias tiene el ámbito de la carpeta a la que apunta, como los [autoimports](#carpetas-de-autoimports): `#server/` sólo existe en el `tsconfig.server.json` generado, `@/` no existe en `tsconfig.shared.json` (porque `shared/` no ve `app/`) y `~/` y `#shared/` existen en los tres. Usar uno fuera de su ámbito es un error claro, antes de que TypeScript diga que el módulo no existe:

- `#server/` en un componente (su `<script>` o su plantilla), en un `.ts` de `app/` o en `shared/` da `MEEK108` en `meeko check`, en el editor y en el build del navegador, también con `import type`. Para leer un tipo del servidor use `~/server/…`, que existe en todos los ámbitos; un import de valores de `server/` con `~/` (o con una ruta relativa) sigue dando `MEEK108`, como desde `1.3`.
- `@/` en `shared/` (o en un `*.shared.ts`) da el nuevo error `MEEK118` en `meeko check`, en `meeko dev` y en el build. Mueva ese código a `shared/` o use el alias desde `app/` o el servidor.

En el grafo de SSR, `meeko dev` y `meeko build` siguen cargando un `#server/` de `app/` que sólo usa el servidor (una plantilla de correo de `app/emails/` que renderiza una ruta de API), igual que un import relativo de `server/`; `meeko check` lo marca igualmente.

En el editor, los aliases completan las carpetas y archivos tras `~/`, `@/`, `#shared/` y `#server/` (este último en `<script server>`), e «Ir a la definición» lleva al módulo. En los `.ts`, el servidor de TypeScript del editor usa los `tsconfig` generados: un `#server/` en `app/` aparece allí como un módulo que no existe, y `meeko check` le da su `MEEK108`.

### Aliases propios: `alias`

`alias` en `meeko.config.ts` añade aliases o cambia los de Meeko. Cada clave es un prefijo que termina en `/` y cada valor, una carpeta del proyecto relativa a su raíz (también la de un layer) o `false` para quitar el alias:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	alias: {
		'ui/': 'app/components/ui/',
		'db/': 'server/db/',
		'#server/': false,
	},
})
```

- **Ámbito.** El de la carpeta a la que apunta, con la misma regla que los aliases de Meeko: dentro de `server/`, sólo en el código de servidor (`db/` en un componente da `MEEK108`); dentro de `app/`, en `app/` y en el servidor, no en `shared/` (`MEEK118`); en cualquier otra carpeta (`shared/`, la raíz, `lib/`), en todo el proyecto.
- **Una sola carpeta.** Un alias propio apunta exactamente a su carpeta; no se busca en los layers como los de Meeko. Cambiar uno de Meeko (`"@/": "src/"`) lo convierte en un alias propio, con el ámbito de su carpeta nueva.
- **Validación.** Una clave sin `/` final, con espacios, `*` o `\`, o que empieza por `.` o `/`, y un valor que no es una ruta relativa dentro del proyecto ni `false`, detienen `meeko dev`, `meeko build` y `meeko check` con un error de `meeko.config.ts` (`alias "lib" debe ser un prefijo que termine en / …`), que el editor, en un workspace de confianza, marca en `alias` (`MEEK_CONFIG`). Una carpeta que no existe no es un error: el import falla al resolverse.
- **Dónde se aplica.** En Vite, en los `tsconfig` generados, en el editor y en `@utilities`, igual que los de Meeko. En un workspace no confiable, el editor lee `alias` sin ejecutar la configuración sólo si es un objeto literal de cadenas y `false`; si no lo es, usa los aliases por defecto.

Node carga `meeko.config.ts` directamente, sin Vite: la configuración y los módulos que importa no pueden usar los aliases.

### Aliases en los layers

Los aliases de Meeko se buscan en el proyecto y después en cada layer, en el orden de las fuentes (véase [Layers](#layers)); gana el primer archivo que existe. Así, en un archivo de `layers/base`, `@/lib/format` es `layers/base/app/lib/format.ts` mientras el proyecto no tenga `app/lib/format.ts`; si lo tiene, gana el del proyecto, como sus `app.meeko` y layout raíz sustituyen a los del layer. Para fijar el archivo del propio layer, use una ruta relativa.

No se resuelven contra el `app/` del layer que importa porque los `paths` de TypeScript valen para todo un proyecto, no para cada archivo: con esta regla, Vite, `meeko check`, el editor y `@utilities` eligen siempre el mismo archivo. Los `tsconfig` generados lo declaran con una lista de carpetas por alias (`"@/*": ["../app/*", "./types/app/*", "../layers/base/app/*", …]`, donde `./types/…` son las declaraciones de los componentes).

### Prioridad y conflictos de los aliases

- **`paths` del `tsconfig.json` del proyecto.** Un patrón propio con el prefijo de un alias de Meeko que apunta a otra carpeta (`"@/*": ["./src/*"]`) gana y desactiva ese alias de Meeko en todo el proyecto: en el editor, en `meeko check`, en los `tsconfig` generados (que desde `1.5` copian también los `paths` del proyecto), en `meeko dev` y `meeko build` y en las comprobaciones de ámbito (`MEEK108` y `MEEK118`), así que importar `@/utils` desde `shared/` ya no es un error. `meeko dev`, `meeko build` y `meeko check` lo avisan una vez por proceso. Un patrón con las mismas carpetas que el de Meeko no lo desactiva. Vite no lee esos `paths`: para que el build resuelva ese prefijo, defínalo también con `alias` (`alias: { "@/": "src/" }`, que con la misma carpeta no cuenta como redefinición) o con un `resolve.alias`.
- **`resolve.alias` de Vite.** El `resolve.alias` de un módulo de Meeko (`meeko.extendViteConfig`) o de un host de Vite propio se aplica antes que los aliases de Meeko. Si cubre todo un prefijo de Meeko (`{ find: "@", replacement: … }` o una expresión regular como `/^@\//`), desactiva también el alias de Meeko de ese prefijo y sus comprobaciones de ámbito, con el mismo aviso; uno que sólo cubre algunos especificadores (`/^@\/lib\/label$/`) gana para ellos y deja el de Meeko para los demás. El editor, que no ejecuta los módulos, no ve el `resolve.alias` de un módulo: para que coincida, desactive el alias con `alias: { "@/": false }`.
- **`imports` de `package.json`.** Los aliases de Meeko que empiezan por `#` no chocan con los [_subpath imports_](https://nodejs.org/api/packages.html#subpath-imports) de Node mientras el proyecto no los declare. Si su `package.json` tiene en `"imports"` una entrada que empieza por `#shared/` o `#server/` (o un patrón como `"#*"`), gana la suya: Meeko no define ese alias en ninguna parte (ni en Vite ni en los `tsconfig`) y avisa una vez por proceso. Para quitar el aviso, desactive el alias con `alias: { "#shared/": false }`.
- **Paquetes.** Los módulos de `node_modules` nunca reciben los aliases del proyecto: un `#…` de un paquete es suyo.

## Limpiar el proyecto

`meeko clean [directorio]` borra todo lo que genera Meeko para dejar el proyecto limpio:

| Comando                 | Borra                                                                                                            | Conserva                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `meeko clean`           | `.meeko/` (tipos, entradas, manifiestos, builds, `tsconfig.*` generados) y la caché de Vite `node_modules/.vite` | El resto de `node_modules` y todos los archivos de la aplicación |
| `meeko clean --all`     | Lo anterior y `node_modules`                                                                                     | Lockfiles, `.env`, `package.json` y el código                    |
| `meeko clean --dry-run` | Nada: muestra qué borraría, con el número de archivos y el tamaño                                                | Todo                                                             |

El comando sólo actúa sobre un proyecto Meeko (con `meeko.config.*` o con `@meekojs/meeko` en `dependencies`/`devDependencies`) y rechaza la raíz de una unidad y el directorio del usuario. Borra únicamente esa lista fija de rutas dentro del proyecto y **nunca sigue enlaces**: un symlink o una junction se elimina como enlace sin entrar en su destino, así que es seguro con `link:` de pnpm, donde `node_modules/@meekojs/meeko` apunta a otro repositorio. Si `node_modules` es un enlace, la caché de Vite se omite con un aviso. Un archivo bloqueado se reintenta; si el error persiste, se informa, se sigue con el resto y el comando termina con código 1. Para reinstalar desde cero: `meeko clean --all` y después `pnpm install`.

## Preparación y migración de proyectos

### Migrar un starter full-stack anterior

Una aplicación generada con `0.0.4` puede adoptar el host de proyecto actual sin mantener entradas manuales. Cambie sus scripts a `meeko dev`, `meeko check`, `meeko build` y `meeko start`; ejecute primero el nuevo build y compare cualquier personalización propia. Después puede retirar `server.mjs`, las entradas cliente/servidor, las configuraciones Vite y los `tsconfig.*` por ámbito que Meeko genera ahora bajo `.meeko/`. El `tsconfig.json` raíz sí permanece como enlace para el editor.

Si desea la convención actual de layouts, mueva el layout raíz a `app/layouts/default.meeko`. No conserve simultáneamente ese archivo y `app/pages/+layout.meeko`, porque ambos representarían el mismo nivel del árbol. Traslade las personalizaciones representables a middleware, handlers y convenciones públicas soportadas. Si una personalización del host o de Vite no tiene todavía una API pública equivalente, conserve el host manual; la migración no debe borrar ni atribuir a `meeko.config.ts` capacidades que no ofrece.

### Migrar `server/session.ts` a `server/runtime.ts`

Meeko ya no carga `server/session.ts`. Si el archivo existe, `meeko check`, `meeko dev` y `meeko build` se detienen con las instrucciones de migración en lugar de ignorarlo. Traslade el `SessionManager` que devolvía `createSessionManager(production)` al export por defecto de `server/runtime.ts` y elimine `server/session.ts`:

```ts
// Antes: server/session.ts
export function createSessionManager(production: boolean) {
	return new SessionManager({ store: createStore(production), production })
}

// Después: server/runtime.ts
import { defineServerRuntime, SessionManager } from '@meekojs/meeko/server'

export default defineServerRuntime(({ production, prerendering }) => ({
	sessions: new SessionManager({ store: createStore(production && !prerendering), production: production && !prerendering }),
	services: (request) => ({/* servicios por petición */}),
}))
```

`meeko build` crea el runtime con `prerendering: true` para renderizar las rutas `render: "prerender"`; durante esa fase no se sirve tráfico de clientes, por lo que la aplicación puede usar un store en memoria en lugar de abrir la base de producción. Las aplicaciones que importaban herramientas de build desde `@meekojs/meeko/server` deben importarlas desde `@meekojs/meeko/build` (`discoverRoutes`, `discoverServerManifest`, `loadMeekoConfig`, `prerenderProject`…), y `toNodeListener`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler` desde `@meekojs/meeko/node`. `createServerDispatcher`, `createLocalCalls`, `generateOpenApi` y `loadSocketChannels` exigen ahora un cargador explícito, por ejemplo `(file) => import(pathToFileURL(file).href)` en Node.

`app/styles/main.css` es opcional y se carga automáticamente como hoja global en desarrollo y en el build. Vite la incluye en el asset CSS de producción; Meeko enlaza ese asset en el HTML SSR y prerenderizado. Los bloques `<style>` de `.meeko` siguen disponibles para estilos locales.

<a id="postcss-y-tailwind"></a>**PostCSS y Tailwind.** Vite procesa con PostCSS tanto `app/styles/main.css` como los `<style>` de los componentes, con el `postcss.config.*` de la raíz del proyecto. Para Tailwind 4, instale `tailwindcss` y `@tailwindcss/postcss`, declare el plugin y cargue Tailwind en la hoja global; Tailwind lee las clases de los `.meeko`:

```js
// postcss.config.mjs
export default { plugins: { '@tailwindcss/postcss': {} } }
```

```css
/* app/styles/main.css */
@import 'tailwindcss';
```

En un `<style scoped>`, `@apply` necesita `@reference "tailwindcss";` (o la ruta de la hoja con su tema) al principio del bloque. Desde `1.2`, el CSS de cada componente es el módulo `Componente.meeko?meeko-style=…&lang.css`, junto a su archivo, así que los plugins de PostCSS resuelven `@reference` y los `@import` relativos desde la carpeta del componente. El selector ya lleva el atributo de ámbito cuando Tailwind expande `@apply`, así que las declaraciones heredan el scope:

```html
<!-- app/components/Card.meeko -->
<style scoped>
	@reference '../styles/main.css'; /* con el @theme del proyecto */

	.card {
		@apply rounded-lg bg-brand p-4;
	}
</style>
```

Tailwind genera también las clases que sólo aparecen en literales de `bind:class` (`bind:class="open.value ? 'ring-4' : undefined"`), porque lee el texto de los `.meeko`. `meekoUtilities()` convive con Tailwind si va antes en la lista de plugins (`plugins: [meekoUtilities(), tailwindcss()]`, con `import tailwindcss from '@tailwindcss/postcss'`): Tailwind recibe ya las reglas generadas en lugar de `@utilities`.

`@tailwindcss/postcss` detecta las fuentes desde el directorio de trabajo (`process.cwd()`), no desde la raíz del proyecto. Los comandos de la CLI que reciben el proyecto (`dev`, `build`, `start`, `preview`, `check`, `routes`, `prerender` y `check-app`) cambian el directorio de trabajo a esa raíz antes de cargar la configuración y PostCSS, así que `meeko dev ../app` funciona desde cualquier carpeta; las rutas relativas del argumento se resuelven antes, contra la carpeta de lanzamiento. Las APIs programáticas (`buildProject`, `startProject`…) no tocan el cwd del proceso: llámelas con el cwd en la raíz o fije el origen con `@import 'tailwindcss' source('../..');` (relativo a la hoja) o con la opción `base` del plugin. Desde una carpeta mayor, Tailwind recorre todo su contenido; desde la raíz de un disco puede agotar la memoria.

Durante el SSR y el prerender, Meeko incrusta en el documento el CSS de los `<style>` de los componentes ya procesado por PostCSS y los plugins CSS de Vite (desde `1.8`; antes llegaba sin procesar), así que un `@apply` con ámbito o un `@utilities` dentro de un componente se aplican desde el primer pintado, sin esperar al JavaScript. Es el mismo CSS que el asset del componente; los `<style>` en línea conservan el nonce o los hashes de la CSP, la deduplicación y el orden del árbol (layouts, página e hijos). Van al final del `<head>`, después de `app/styles/main.css`, de las hojas de los módulos y del `head` de `document`, que es donde el cliente añade después el CSS de los componentes: una regla con ámbito y una global de igual especificidad se resuelven igual en el primer pintado que tras hidratar (desde `1.8`; antes la global ganaba sólo hasta que cargaba el JavaScript). En `meeko dev`, el cliente de Vite adopta esos `<style>` en lugar de añadir una copia, y la HMR los sustituye: una regla que se borra del `<style>` deja de aplicarse sin recargar. La página de error de un fallo del servidor, que no se hidrata, también incrusta su CSS.

**`@tailwindcss/vite`.** Meeko no lee `vite.config.*`, pero un [módulo](#módulos) puede registrar el plugin de Vite de Tailwind con `addVitePlugin`. Sustituye a `@tailwindcss/postcss` (no declare los dos); `meeko dev` y `meeko build` lo aplican a `app/styles/main.css` y a los `<style>` de los componentes, con `@theme`, `@apply` con ámbito y las clases de `bind:class`. A diferencia del plugin de PostCSS, detecta las fuentes desde la raíz de Vite, que es la del proyecto:

```js
// modules/tailwind.mjs
import { defineMeekoModule } from '@meekojs/meeko/framework'
import tailwindcss from '@tailwindcss/vite'

export default defineMeekoModule({
	meta: { name: 'tailwind' },
	setup(_options, meeko) {
		meeko.addVitePlugin(tailwindcss())
	},
})
```

```js
// meeko.config.mjs
export default { modules: ['./modules/tailwind.mjs'] }
```

Un host de Vite propio que sólo usa el plugin `meeko()` no recibe los `addVitePlugin`; ahí se añade `tailwindcss()` a su `plugins`. Con `@tailwindcss/vite`, `meekoSortClasses: "stylesheet"` no ve las utilidades (procesa la hoja sin los plugins de Vite de los módulos); use `"tailwind"`.

**Orden de las clases con Prettier.** Con `meekoSortClasses: "tailwind"` (desde `1.8`), el plugin de Prettier (`@meekojs/prettier-plugin` o `@meekojs/meeko/prettier`) ordena las clases de cada `class="…"` estático con el orden oficial de Tailwind CSS 4, el de `prettier-plugin-tailwindcss` (que no reconoce el parser `meeko`). Carga el design system de `app/styles/main.css`, o de la hoja que indique `meekoTailwindStylesheet` (relativa a la raíz del proyecto), con sus `@import`, `@theme`, `@plugin` y `@utility`, usando el `tailwindcss` instalado en el proyecto; funciona igual con `@tailwindcss/postcss` que con `@tailwindcss/vite`. Las clases que Tailwind no conoce, como las de `meekoUtilities()` o las del `<style>` del componente, van primero y en su orden. No toca `bind:class` ni el `class` de una etiqueta de componente.

```json
{ "plugins": ["@meekojs/prettier-plugin"], "meekoSortClasses": "tailwind", "meekoTailwindStylesheet": "app/styles/main.css" }
```

```html
<!-- antes -->
<div class="text-white custom p-4 bg-brand flex hover:bg-brand/80"></div>
<!-- después -->
<div class="custom flex bg-brand p-4 text-white hover:bg-brand/80"></div>
```

Si `tailwindcss` 4 no está instalado, la hoja no existe o Tailwind la rechaza, las clases no se ordenan (sólo se normalizan) y se avisa una vez. El design system se reutiliza mientras no cambien la hoja ni lo que importa. En un workspace no confiable del editor, `"tailwind"` se comporta como `"off"`, igual que `"stylesheet"`, porque ejecutaría los `@plugin` del proyecto.

<a id="utilidades-generadas-con-typescript"></a>**Utilidades generadas con TypeScript.** Desde `1.2`, el plugin de PostCSS `meekoUtilities()` de `@meekojs/meeko/postcss` genera reglas con una función de TypeScript en lugar de repetirlas a mano. La at-rule `@utilities "<ruta>" [layer(<nombre>)];` se sustituye por las reglas que devuelve el export por defecto del módulo:

```ts
// postcss.config.ts
import { meekoUtilities } from '@meekojs/meeko/postcss'

export default { plugins: [meekoUtilities()] }
// O, con la forma de objeto: { plugins: { "@meekojs/meeko/postcss": {} } }
```

```css
/* app/styles/main.css */
@layer tokens, utilities;
@import './tokens/colors.css' layer(tokens);
@utilities "./utilities/color.ts" layer(utilities);
```

```ts
// app/styles/utilities/palette.ts
export const colors = ['gray', 'blue', 'red'] as const
export const steps = Array.from({ length: 12 }, (_, i) => i + 1)
```

```ts
// app/styles/utilities/color.ts
import { defineUtilities } from '@meekojs/meeko/postcss'
import { colors, steps } from './palette'

export default defineUtilities(({ rule, atRule }) => [
	colors.map((name) => rule(`.color[data-color='${name}']`, Object.fromEntries(steps.map((step) => [`--color-${step}`, `var(--${name}-${step})`])))),
	rule('.color', { color: 'var(--color-11)' }, rule('&:hover', { backgroundColor: 'var(--color-3)' }), atRule('media', '(prefers-contrast: more)', { color: 'var(--color-12)' })),
])
```

Genera `@layer utilities { .color[data-color='gray'] { --color-1: var(--gray-1); … } … .color { color: var(--color-11); &:hover { … } @media (prefers-contrast: more) { … } } }`. Un bucle de preprocesador, como `@each $size in sm, md, lg` de `postcss-each` (que no forma parte de PostCSS: sin ese plugin, la regla llega al navegador tal cual y no hace nada), se escribe como un `map` de TypeScript:

```ts
// app/styles/utilities/button-sizes.ts
import { defineUtilities } from '@meekojs/meeko/postcss'

const sizes = { sm: '0.25rem 0.5rem', md: '0.5rem 1rem', lg: '0.75rem 1.5rem' }

export default defineUtilities(({ rule }) => Object.entries(sizes).map(([size, padding]) => rule(`.button[data-size='${size}']`, { padding })))
```

La at-rule:

- **Ruta.** Entre comillas y relativa a la hoja que contiene la at-rule: la hoja global, un archivo que esta importa con `@import` o el `<style>` de un `.meeko`, que resuelve desde la carpeta del componente. Admite `.ts`, `.mts`, `.js` y `.mjs`. Sin archivo de origen (CSS procesado sin la opción `from` de PostCSS), la ruta es relativa a `meekoUtilities({ root })`, por defecto `process.cwd()`.
- **`layer(x)`** envuelve el resultado en `@layer x { … }`; `layer` sin nombre crea una capa anónima. Sin `layer`, las reglas quedan en el lugar de la at-rule.
- **No lleva bloque** `{ … }`. Puede aparecer varias veces y dentro de otras reglas o at-rules.
- **Va después de los `@import`.** Para CSS es una regla más, y los `@import` deben preceder a cualquier regla: Vite avisa (`@import statements must precede all other statements`) y no incluye un `@import` que sigue a un `@utilities`.
- **No colisiona con Tailwind.** El nombre es `@utilities`; `@utility`, de Tailwind 4, no se toca.

El módulo exporta por defecto `defineUtilities(fn)` o una función sin envolver. `fn` recibe los helpers, puede ser `async` y devuelve un nodo, un array de salidas (anidado a cualquier profundidad, se aplana en orden) o `null`, `false` y `undefined`, que se omiten, para escribir `condición && rule(…)`.

| Helper                                             | Genera                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rule(selector, declaraciones?, ...hijas)`         | Una regla. Las hijas (otras `rule` con `&`, `atRule`, `css` o arrays) se anidan dentro con anidamiento CSS nativo, como si las escribiera a mano. Si el segundo argumento no es un objeto de declaraciones, es la primera hija.                                                                                           |
| `atRule(nombre, params, declaraciones?, ...hijas)` | Una at-rule, sin `@` en el nombre: `atRule("media", "(min-width: 48rem)", …)`, `atRule("supports", "(display: grid)", …)`, `atRule("property", "--angle", { syntax: "'<angle>'", inherits: "false", initialValue: "0deg" })`. Con sólo `nombre` y `params` es una sentencia: `atRule("layer", "a, b")` da `@layer a, b;`. |
| `` css`…` `` o `css("…")`                          | CSS literal, que se analiza con PostCSS, para lo que no cabe en los helpers (`@keyframes`, varias reglas copiadas). Conserva las barras invertidas (`content: "\201C"`).                                                                                                                                                  |

Las declaraciones son un objeto: las claves en camelCase pasan a kebab-case (`borderRadius` → `border-radius`, `WebkitAppearance` → `-webkit-appearance`, `msFlex` → `-ms-flex`); las claves en kebab-case (`"border-radius"`) y las propiedades personalizadas `--*` se escriben tal cual. Un valor es una cadena, que puede terminar en `!important`, o un número, que se escribe sin unidades (`opacity: 0.5`, `zIndex: 10`). `undefined` omite la declaración y un array escribe una declaración por valor, para los valores de respaldo (`display: ["-webkit-box", "flex"]`, también un array `as const`).

Desde `1.3`, las declaraciones están tipadas con [csstype](https://github.com/frenic/csstype): el editor autocompleta las propiedades estándar y con prefijo de proveedor, y las palabras clave de su valor (`position: "sticky"`), y una propiedad mal escrita (`backgroundColr`) o una palabra clave que no existe es un error de tipos en el editor y al comprobar el módulo con TypeScript. Las longitudes y los tiempos son cadenas con unidad (`padding: "4px"`, `transitionDuration: "200ms"`), salvo el `0`: `padding: 4` es un error, porque se escribiría `padding: 4`, que el navegador descarta. Los números valen donde CSS los admite sin unidad (`opacity`, `zIndex`, `flexGrow`, `lineHeight`, `fontWeight`…). En `atRule`, el objeto admite además los descriptores de `@font-face` (`src`, `fontDisplay`, `unicodeRange`…), `@property` (`syntax`, `inherits`, `initialValue`), `@page`, `@counter-style`, `@font-palette-values` y `@view-transition` (tipo `UtilityAtRuleDeclarations`). Un objeto que se construye fuera de la llamada pierde las palabras clave (`const base = { position: "absolute" }` es `{ position: string }`): anótelo con `UtilityDeclarations` o use `as const`. Un objeto con claves dinámicas, como el `{ [k: string]: string }` de `Object.fromEntries` en el ejemplo de la paleta o un `Record<string, string>`, se acepta sin comprobar sus claves. A la inversa, `UtilityDeclarations` ya no tiene firma de índice: leerlo con una clave `string` (`decls[key]`) es el error `TS7053` con `noImplicitAny`; use `Object.entries(decls)` o una clave `keyof UtilityDeclarations`. Para una propiedad o una at-rule que csstype todavía no conoce, escriba el CSS con `` css`…` ``.

Los tipos `UtilityHelpers`, `UtilityDeclarations`, `UtilityAtRuleDeclarations` (desde `1.3`), `UtilityValue`, `UtilityOutput`, `UtilityNode`, `UtilityRule`, `UtilityAtRule`, `UtilityCss`, `UtilityFunction` y `MeekoUtilitiesOptions` se exportan desde el mismo subpath.

Los errores detienen la hoja con el archivo CSS y la línea del `@utilities`, que Vite muestra en su overlay: un módulo que no existe o con otra extensión, un módulo que no compila, un export por defecto que no es una función, una excepción de la función (con su mensaje), un selector, un nombre de propiedad, un valor o unos parámetros de at-rule no válidos (un `;` o una llave en un valor, un número `NaN`) y un valor de la salida que no es un nodo de los helpers, por ejemplo una cadena de CSS sin `css`. Tras corregir el módulo, la siguiente edición regenera la hoja.

**Carga del módulo y actualización en caliente.** `import()` nativo guarda en caché cada módulo del grafo durante toda la vida del proceso: una query en el módulo de entrada lo recarga a él, pero no a los archivos locales que importa. Por eso el plugin empaqueta el módulo con rolldown, el bundler que Vite 8 ya incluye (no añade dependencias): los archivos locales, también los que llegan por un alias de `tsconfig` o por `#imports` del mismo paquete, forman un único módulo ES que se importa desde una URL `data:`, y los paquetes de `node_modules` quedan externos y se cargan una vez con Node, como en cualquier programa. Así se admite todo TypeScript, imports sin extensión incluidos, e `import.meta.url`, `import.meta.dirname` e `import.meta.filename` siguen describiendo el archivo original. El resultado se reutiliza mientras ningún archivo del grafo cambie de fecha de modificación o de tamaño, de modo que una hoja que se transforma muchas veces no vuelve a empaquetar nada. El plugin publica cada archivo del grafo como dependencia de la hoja (mensajes `dependency` de PostCSS), así que en `meeko dev` editar `color.ts` o `palette.ts` regenera la hoja y Vite actualiza el CSS en caliente, sin recargar la página ni reiniciar el servidor. Guarde estos módulos fuera de las carpetas que Meeko vigila por sus autoimports y sus rutas (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/pages`, `app/layouts`, `shared/…`, `server/utils`, las de `imports`…): un cambio en ellas recarga la página entera, como cualquier otro archivo de esas carpetas; `app/styles/` es el lugar natural. Fuera de Vite 8 (por ejemplo, `postcss-cli`), si no encuentra rolldown, el plugin importa el módulo con la eliminación de tipos nativa de Node, que exige imports con extensión y sintaxis de TypeScript borrable, recarga sólo el módulo de entrada y lo advierte una vez.

**Autoimports.** Desde `1.4`, el módulo de `@utilities` y los módulos locales en TypeScript que importa reciben los mismos autoimports de valores que el resto del proyecto: el plugin aplica, dentro del bundle de rolldown, el registro y la transformación del plugin de Vite, así que un `app/styles/utilities/color.ts` puede usar sin import la constante `THEME_COLORS` de `app/theme/constants.ts` si `meeko.config.ts` declara `imports: { appDirs: ["app/theme"] }`, igual que un componente. Como en el editor y en `meeko check`, cada módulo recibe los de su ámbito según su carpeta (`app/`, `shared/` o `server/` de la aplicación o de un layer); un módulo fuera de esas carpetas no recibe ninguno. Los módulos de `@utilities` se ejecutan en Node mientras se genera el CSS, así que el registro se limita a lo que tiene sentido ahí:

| Llegan                                                                                                                                                                                                                                                                                                                       | No llegan                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Los exports de valores de `app/composables`, `app/utils`, `app/stores`, `app/types` e `imports.appDirs`; los de `shared/*` e `imports.sharedDirs` (también los `.shared.ts`); los de las mismas carpetas de los layers, y los que añaden los módulos con `addAutoImportsDir` y `addAutoImports` con ámbito `app` o `shared`. | Los de `server/utils`, `imports.serverDirs` y los `.server.ts`; los `.client.ts`; los componentes `.meeko`; los clientes generados (`api`, `rpc`, `socket`, `useApi`…), y las API del framework para componentes y la aplicación en marcha (`signal`, `computed`, `useState`, `href`, `useRoute`, `defineApiRoute`…). |

Usar uno de la segunda columna no da un `ReferenceError` opaco: el nombre se sustituye por un valor que, al usarse (leerlo, llamarlo, convertirlo en texto), lanza un error con el autoimport, su origen y el motivo, que el plugin muestra en la línea del `@utilities`: `"./utilities/color.ts" lanzó un error al generar las utilidades: app/styles/utilities/color.ts usa el autoimport SECRET, que no está disponible al generar el CSS de @utilities: viene de server/utils/secret.ts, que sólo existe en el servidor. …`. Como el error sólo aparece si el valor se usa, un archivo de autoimports que el módulo importa y que además exporta, por ejemplo, un composable con `signal` sigue sirviendo para leer sus constantes. `defineUtilities` no es un autoimport: impórtelo de `@meekojs/meeko/postcss`, porque declararlo global lo ofrecería también a los componentes y llevaría PostCSS al bundle del navegador. Los tipos son los de `app/` (`.meeko/tsconfig.app.json`), así que `meeko check` y el editor dan `TS2304` al usar en `app/styles/` un export de `server/utils`, como en el resto de `app/`; en cambio aceptan los nombres del navegador y del framework de la tabla, que fallan al generar la hoja con el error anterior.

El proyecto es la carpeta más cercana al módulo con un `meeko.config.*`, sin pasar de su `package.json`, o la de ese `package.json` si depende de `@meekojs/meeko`; su configuración se ejecuta como en `meeko dev`, con los `setup` de sus módulos, una vez por hoja y sólo si el módulo se va a empaquetar con rolldown. Si leerla falla (una configuración o un `setup` que lanza), la hoja se genera igual, sin autoimports, con un aviso de PostCSS que da el motivo. Los archivos de autoimports que el módulo usa forman parte de su grafo: son dependencias de la hoja, y cambiarlos la regenera. Añadir o quitar un export en una carpeta de autoimports también vuelve a empaquetar el módulo en la siguiente transformación, aunque ningún archivo de su grafo haya cambiado; en `meeko dev`, esos cambios recargan la página entera, como en cualquier otra carpeta de autoimports. `meekoUtilities({ autoImports: false })` desactiva los autoimports y empaqueta los módulos como en `1.3`. Fuera de un proyecto Meeko (un `postcss-cli` o un bundler en otro proyecto) no hay registro y nada cambia. Sin rolldown, con el `import()` nativo, Node no permite añadir imports: el módulo no recibe autoimports, la configuración no se ejecuta y el aviso de carga nativa lo indica; escriba los imports.

Las reglas generadas en un `<style scoped>` no reciben el atributo de ámbito: Meeko aplica el ámbito al compilar el bloque y PostCSS genera las reglas después, así que son globales, como las de `app/styles/main.css`. El plugin sólo se ejecuta en Node, durante `meeko dev` y el build; `@meekojs/meeko/postcss` no forma parte del runtime del navegador ni del servidor.

**Con Tailwind.** Declare `meekoUtilities()` antes de `@tailwindcss/postcss`:

```ts
// postcss.config.ts
import tailwindcss from '@tailwindcss/postcss'
import { meekoUtilities } from '@meekojs/meeko/postcss'

export default { plugins: [meekoUtilities(), tailwindcss()] }
```

En ese orden, Tailwind recibe las reglas generadas como el resto de la hoja y procesa, por ejemplo, el `@apply` de un `` css`…` ``; con `layer(utilities)` quedan en la misma capa `utilities` que las de Tailwind. En el orden inverso, Tailwind compila primero cada hoja que importa `tailwindcss` y elimina las at-rules que no conoce, `@utilities` incluida, sin error; el plugin lo advierte una vez por proceso. En una hoja sin `@import "tailwindcss"`, como el `<style>` de un componente, el orden no importa.

<a id="hoja-global-procesada-para-el-editor"></a>**Hoja global procesada para el editor.** Las clases que generan las `@utilities`, y las de los archivos que la hoja importa, no están escritas en ningún archivo CSS del proyecto. Por eso `meeko dev` escribe `app/styles/main.css` ya procesada en `.meeko/styles/main.css`: la misma hoja que sirve en `/app/styles/main.css?direct`, con los `@import` resueltos, las `@utilities` expandidas y el resto de plugins de PostCSS aplicados, sin minificar y con un comentario inicial que indica que es generada. La escribe en segundo plano en cuanto el servidor escucha, sin retrasar el arranque, y la reescribe cada vez que cambian la hoja o algo de lo que depende: un archivo importado, un módulo de `@utilities` o un archivo que ese módulo importa. También tras un reinicio de Vite (por ejemplo, al cambiar `.env`).

- Sólo sustituye el archivo cuando cambia su contenido, y de forma atómica (escribe un temporal y lo renombra), así que un lector nunca ve media hoja. Vite no vigila `.meeko/`: escribirla no recarga la página ni provoca otra regeneración.
- Si la hoja no compila (un error de PostCSS o de un módulo de `@utilities`), el archivo conserva la última versión buena, el servidor sigue funcionando y la consola lo indica una vez: `[meeko] .meeko/styles/main.css conserva la versión anterior: app/styles/main.css no compila (…)`. El siguiente cambio que la arregla la regenera.
- Sin `app/styles/main.css` no hay archivo; si la hoja se borra con `meeko dev` en marcha, también se borra el archivo.
- `meeko build` no lo escribe: el CSS del build está minificado y mezcla la hoja global con los `<style>` de los componentes. El archivo se conserva al detener `meeko dev`, así que basta con haberlo ejecutado una vez; `meeko clean` lo elimina con el resto de `.meeko/`.
- Nada lo carga en ejecución y no debe editarse a mano. Las `url()` aparecen como las reescribe Vite en desarrollo.

Sirve a las extensiones del editor que completan clases a partir de hojas CSS en disco. Con [HTML CSS Support](https://marketplace.visualstudio.com/items?itemName=ecmel.vscode-html-css) (`ecmel.vscode-html-css`) en VS Code:

```json
// .vscode/settings.json
{ "css.styleSheets": [".meeko/styles/main.css"] }
```

La ruta es relativa a la carpeta del workspace. La extensión busca los archivos locales con la búsqueda de VS Code, que aplica `files.exclude` pero no `.gitignore` ni `search.exclude`: encuentra el archivo aunque `.meeko/` esté en `.gitignore`, como en el starter. Si su `files.exclude` oculta `.meeko`, la extensión tampoco lo verá; oculte en su lugar sólo las carpetas que no quiera ver, por ejemplo `".meeko/output": true`. La extensión guarda cada hoja local en caché y sólo la vuelve a leer cuando se guarda desde el propio editor: tras un cambio que regenera el archivo, ejecute **CSS: Clear style sheets cache** desde la paleta de comandos para ver las clases nuevas. Por defecto sólo completa en HTML; para los `.meeko`, añada `"css.enabledLanguages": ["html", "meeko"]` en la configuración de usuario (la extensión no lo admite por workspace) y reinicie VS Code.

En desarrollo, Vite abre un WebSocket HMR en un puerto derivado del puerto HTTP para que dos aplicaciones Meeko no compitan por el puerto predeterminado de Vite. `MEEKO_HMR_PORT` permite fijarlo explícitamente cuando el entorno lo exige; el navegador debe poder acceder a ese puerto además del HTTP de la aplicación.

<a id="variables-de-entorno-y-env"></a>**Variables de entorno y `.env`.** Desde `1.2`, `meeko dev`, `build`, `start`, `preview` y `check` cargan el `.env` de la raíz del proyecto en `process.env`, como Vite y Nuxt en desarrollo. Una variable que el entorno ya define tiene prioridad, así que el entorno real de un despliegue nunca se sustituye. La salida de `meeko build` ejecutada directamente (`node .meeko/output/node/index.mjs`, un contenedor) no lee `.env`: en producción las variables llegan del entorno. Cambiar `.env` exige reiniciar `meeko dev`. Meeko lee estas variables:

| Variable                                      | Comandos                                                                                         | Efecto                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEEKO_PORT`, `MEEKO_HOST`                    | `dev`, `start`, `preview` y la salida de Node, Bun y Deno                                        | Puerto y dirección; sustituyen a `server.port` y `server.host`. Por defecto, `127.0.0.1:4173`. Sin `MEEKO_PORT` se lee `PORT`, que inyectan plataformas como Coolify, Railway o Cloud Run.                                                                                                                                                                                                        |
| `MEEKO_PUBLIC_ORIGIN`                         | `dev`, `start`, `preview` y la salida de Node, Bun, Deno y Workers; desde `1.3`, también `build` | Origen público tras un proxy HTTPS, para las comprobaciones de `Origin` de HTTP y Socket. En `build`, y sólo si falta `site` en `meeko.config.ts`, el origen de las URL absolutas de `sitemap.xml`, `robots.txt` y `document.seo`; el build sólo la lee cuando escribe alguna. Como en el servidor, cuenta sólo el origen de la URL: `https://example.com/app` vale `https://example.com`.        |
| `MEEKO_REDIS_URL`                             | La salida de Node, Bun y Deno                                                                    | Redis de las sesiones en producción cuando `server/runtime.ts` no declara `sessions`; véase [Sesiones sin configuración](framework-auth.md#sesiones-sin-configuración).                                                                                                                                                                                                                                            |
| `MEEKO_REDIS_PREFIX`                          | Ídem                                                                                             | Prefijo de sus claves; por defecto, `meeko:<name de package.json>:prod:`.                                                                                                                                                                                                                                                                                                                         |
| `MEEKO_ROOT`                                  | La salida de Node, Bun y Deno (desde `1.8`)                                                      | Raíz del proyecto que recibe `server/runtime.ts` como `root`, absoluta o relativa al directorio de trabajo, cuando la salida se despliega fuera de su sitio; véase [Runtime de servidor](framework-server.md#runtime-de-servidor).                                                                                                                                                                                   |
| `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` | `dev` y producción                                                                               | Duración (`12h`, `7d`…; 7 días por defecto) y `SameSite` (`Lax` por defecto, o `Strict`) de esas sesiones.                                                                                                                                                                                                                                                                                        |
| `MEEKO_TRUST_PROXY`                           | `dev` y producción                                                                               | Proxies de confianza delante del servidor (un número, o `true` para todos), cuyas entradas de `X-Forwarded-For` dan la IP del cliente de `context.clientAddress`, `clientAddress(request)` y `rateLimit`; desde `1.8`, `cloudflare` lee `CF-Connecting-IP` tras Cloudflare Tunnel. Véase [IP del cliente tras un proxy](framework-auth.md#ip-del-cliente-tras-un-proxy). Sin ella, `X-Forwarded-For` nunca se lee. |
| `MEEKO_TRUSTED_PROXIES`                       | `dev` y producción                                                                               | Desde `1.8`, con `MEEKO_TRUST_PROXY=cloudflare`: redes (CIDR o IP) de `cloudflared` y los proxies; por defecto, loopback y redes privadas. Véase [Cloudflare Tunnel y Traefik](framework-auth.md#cloudflare-tunnel-y-traefik).                                                                                                                                                                                     |
| `MEEKO_HMR_PORT`                              | `dev`                                                                                            | Puerto del WebSocket de HMR; sin él, se deriva del puerto HTTP.                                                                                                                                                                                                                                                                                                                                   |
| `MEEKO_EDITOR_BRIDGE=0`                       | `dev`                                                                                            | Desactiva el puente con el editor (valores en vivo).                                                                                                                                                                                                                                                                                                                                              |
| `MEEKO_LINK_WATCH=0`                          | `dev`                                                                                            | No reinicia `meeko dev` al reconstruir un `@meekojs/meeko` enlazado; avisa en la terminal de que hay que reiniciarlo.                                                                                                                                                                                                                                                                             |

Desde `1.2`, todas las variables que lee Meeko empiezan por `MEEKO_`; el prefijo queda reservado para Meeko, así que las variables propias de la aplicación deben usar otro nombre. `HOST` y `PUBLIC_ORIGIN`, los nombres anteriores, siguen funcionando durante 1.x cuando falta la variable nueva, con un aviso por proceso que nombra su reemplazo, y dejarán de leerse en `2.0`. `PORT` no está obsoleta: es el respaldo permanente de `MEEKO_PORT`.

Si ni `MEEKO_PORT` (o `PORT`) ni `server.port` fijan el puerto, `meeko dev` usa el primero libre a partir de `4173` (hasta `4192`), como Vite: con otro `meeko dev` ya en `4173`, el segundo escribe `[meeko] El puerto 4173 está en uso; meeko dev usa el 4174` y la URL real, y deriva de ese puerto el del WebSocket HMR y el descriptor del puente con el editor (`.meeko/dev/editor-bridge-4174.json`). Un puerto fijado con `MEEKO_PORT`, `PORT` o `server.port` no cambia: si está ocupado, `meeko dev` termina con `El puerto 4173 de 127.0.0.1 ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev`.

<a id="url-que-se-muestra"></a>**URL que se muestra.** Desde `1.7.1`, `meeko dev`, `meeko start`, `meeko preview` y las salidas de Node, Bun y Deno escriben `http://localhost:4173` cuando escuchan en loopback (`127.0.0.1` o `::1`) o en todas las interfaces (`0.0.0.0` o `::`). Sólo cambia el texto: el servidor sigue escuchando en la dirección configurada, `serveNode(...).url` y `serveDeno(...).url` conservan esa dirección (`http://127.0.0.1:4173`) y, sin `MEEKO_PUBLIC_ORIGIN`, Socket sigue tomándola como origen y acepta los otros nombres de loopback, así que una página abierta en `localhost` conecta igual. Con `MEEKO_HOST=0.0.0.0` (o `::`, o `server.host` equivalente) se añade una línea `Red:` por cada dirección de las interfaces de red, al estilo de Vite: IPv4 con `0.0.0.0`, e IPv4 e IPv6 global con `::`, sin las de loopback ni las IPv6 de enlace local. La salida de Deno sólo las lista si tiene `--allow-sys=networkInterfaces` (`meeko preview` concede `-A`); sin ese permiso escribe sólo la URL local y nunca pregunta. Con un host concreto, como `192.168.1.20`, se muestra ese host. La primera línea es siempre la URL local, sola, para los scripts que la leen:

```text
http://localhost:4173
Red: http://192.168.1.20:4173
```

El SSR de desarrollo carga `@meekojs/meeko` desde Node, fuera del module runner de Vite, como el build; así una aplicación que consume Meeko con `link:` mantiene una sola instancia del runtime aunque Vite recargue sus módulos. Por eso, cuando `@meekojs/meeko` está enlazado (`link:` de pnpm, `npm link` o un workspace: el paquete se resuelve fuera de todo `node_modules`), `meeko dev` ejecuta el servidor en un proceso hijo y vigila `dist/` y `package.json` del paquete enlazado. Al reconstruirlo, espera a que la compilación termine (400 ms sin cambios), escribe `[meeko] Meeko enlazado cambió; reiniciando meeko dev…`, cierra el servidor anterior (Socket, HTTP, Vite y el descriptor del puente con el editor) y arranca otro proceso en el mismo puerto, con el mismo entorno. Si el nuevo proceso no arranca, por ejemplo porque la compilación quedó a medias, lo informa y vuelve a intentarlo con el siguiente cambio. Sólo cuentan las escrituras: leer el build no lo reinicia, aunque Windows notifique como cambio la actualización de la fecha de último acceso. `Ctrl+C` detiene ambos procesos. Con una instalación normal desde el registro no se vigila nada más.

`MEEKO_LINK_WATCH=0` (también desde el `.env` del proyecto) desactiva el reinicio con un paquete enlazado: un solo proceso sirve hasta que se detiene. Ese proceso conserva el código de servidor de Meeko que cargó, mientras Vite sirve al navegador los archivos nuevos de `dist/`, así que tras una reconstrucción el HTML del servidor (cabeceras, `<head>`, SSR) sale del build anterior y la hidratación usa el nuevo. Por eso, en cada reconstrucción, cuando termina, escribe `[meeko] Meeko enlazado cambió (…/dist), pero este meeko dev no se reinicia solo (MEEKO_LINK_WATCH=0): el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.` Reinícielo antes de comprobar el resultado.
