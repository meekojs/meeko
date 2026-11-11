# Meeko como framework full-stack

Una aplicación Meeko organiza páginas en `app/pages`, componentes en `app/components` y endpoints en `server/`. El framework descubre esas carpetas, renderiza la página en el servidor por defecto y genera las entradas y tipos necesarios. Si aún no tienes un proyecto, empieza por [Crear una aplicación](#crear-una-aplicación).

Por ejemplo, `app/pages/index.meeko` ya es la ruta `/`:

```meeko
<script lang="ts">
	const count = signal(0)
</script>

<template>
	<main>
		<h1>Hola, Meeko</h1>
		<button on:click="() => count.value++">Visitas locales: {count.value}</button>
	</main>
</template>
```

`signal` se autoimporta en los componentes de la aplicación. El servidor entrega el HTML inicial y el navegador hidrata el botón. Para una página con datos, sigue [Código de servidor de la página](#código-de-servidor-de-la-página) o [Datos en componentes](#datos-en-componentes-useapi-userpcquery-y-userpcmutation). Para llamadas HTTP o RPC, ve a [API y RPC](#api-y-rpc). La configuración, las migraciones y los adaptadores se explican después de este recorrido inicial.

## Crear una aplicación

Desde una carpeta limpia, con Node.js 24+ y npm, ejecuta:

```sh
npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init-framework my-app
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

## Guías por tarea

Para empezar con las rutas, sigue [Routing](routing.md) y sus guías de páginas, datos, layouts, navegación y middleware.

- [Configuración, layers, módulos, autoimports, aliases y migración](framework-configuration.md)
- [Routing, SSR, layouts, head, tema y middleware](framework-rendering.md)
- [Contratos HTTP y RPC, datos y formularios](framework-api.md)
- [Conexiones, contratos y broadcast](framework-websocket.md)
- [Runtime, servicios y tratamiento de errores](framework-server.md)
- [Autenticación, contraseñas, sesiones y seguridad](framework-auth.md)
- [Build, adaptadores, despliegue y rendimiento](framework-deployment.md)
- [Subrutas, destinos, compatibilidad y límites](framework-reference.md)

## Enlaces anteriores

Estos enlaces conservan las anclas publicadas y llevan al apartado correspondiente:

<a id="configuración"></a>[Configuración](framework-configuration.md#configuración)

<a id="logs-del-servidor-en-la-consola-del-navegador"></a>[Logs del servidor en la consola del navegador](framework-configuration.md#logs-del-servidor-en-la-consola-del-navegador)

<a id="routing-layouts-y-ssr"></a>[Routing, layouts y SSR](framework-rendering.md#routing-layouts-y-ssr)

<a id="meekooutlet--y-meekolink"></a>[<MeekoOutlet /> y <MeekoLink>](framework-rendering.md#meekooutlet--y-meekolink)

<a id="meekoteleport"></a>[<MeekoTeleport>](framework-rendering.md#meekoteleport)

<a id="layouts-con-nombre"></a>[Layouts con nombre](framework-rendering.md#layouts-con-nombre)

<a id="opciones-por-carpeta-groupts"></a>[Opciones por carpeta: +group.ts](framework-rendering.md#opciones-por-carpeta-groupts)

<a id="layouts-de-layers-y-módulos"></a>[Layouts de layers y módulos](framework-rendering.md#layouts-de-layers-y-módulos)

<a id="props-del-layout-desde-la-página"></a>[Props del layout desde la página](framework-rendering.md#props-del-layout-desde-la-página)

<a id="página-de-error-de-la-aplicación-apperrormeeko"></a>[Página de error de la aplicación (app/error.meeko)](framework-rendering.md#página-de-error-de-la-aplicación-apperrormeeko)

<a id="código-de-servidor-de-la-página"></a>[Código de servidor de la página](framework-rendering.md#código-de-servidor-de-la-página)

<a id="código-de-nivel-superior-y-datos-exportados"></a>[Código de nivel superior y datos exportados](framework-rendering.md#código-de-nivel-superior-y-datos-exportados)

<a id="opciones-de-ruta-con-definepage"></a>[Opciones de ruta con definePage](framework-rendering.md#opciones-de-ruta-con-definepage)

<a id="reglas-comunes"></a>[Reglas comunes](framework-rendering.md#reglas-comunes)

<a id="dónde-se-usa-cada-api"></a>[Dónde se usa cada API](framework-rendering.md#dónde-se-usa-cada-api)

<a id="modos-de-render"></a>[Modos de render](framework-rendering.md#modos-de-render)

<a id="streaming-ssr-render-stream"></a>[Streaming SSR (render: "stream")](framework-rendering.md#streaming-ssr-render-stream)

<a id="caché-de-páginas-ssr"></a>[Caché de páginas SSR](framework-rendering.md#caché-de-páginas-ssr)

<a id="enlaces-anclas-y-scroll"></a>[Enlaces, anclas y scroll](framework-rendering.md#enlaces-anclas-y-scroll)

<a id="view-transitions-nativas"></a>[View Transitions nativas](framework-rendering.md#view-transitions-nativas)

<a id="estado-de-navegación"></a>[Estado de navegación](framework-rendering.md#estado-de-navegación)

<a id="ruta-actual"></a>[Ruta actual](framework-rendering.md#ruta-actual)

<a id="head-del-documento-document-usehead-y-useseometa"></a>[Head del documento: document, useHead y useSeoMeta](framework-rendering.md#head-del-documento-document-usehead-y-useseometa)

<a id="canónica-y-open-graph-por-página"></a>[Canónica y Open Graph por página](framework-rendering.md#canónica-y-open-graph-por-página)

<a id="tema-clarooscuro-sin-parpadeo"></a>[Tema claro/oscuro sin parpadeo](framework-rendering.md#tema-clarooscuro-sin-parpadeo)

<a id="usetheme"></a>[useTheme()](framework-rendering.md#usetheme)

<a id="iconos-que-no-saltan"></a>[Iconos que no saltan](framework-rendering.md#iconos-que-no-saltan)

<a id="data-theme-choice"></a>[data-theme-choice](framework-rendering.md#data-theme-choice)

<a id="selector-de-tema-propio"></a>[Selector de tema propio](framework-rendering.md#selector-de-tema-propio)

<a id="meekothemetoggle"></a>[<MeekoThemeToggle>](framework-rendering.md#meekothemetoggle)

<a id="cómo-se-evita-el-parpadeo-en-cada-caso"></a>[Cómo se evita el parpadeo en cada caso](framework-rendering.md#cómo-se-evita-el-parpadeo-en-cada-caso)

<a id="csp"></a>[CSP](framework-rendering.md#csp)

<a id="caché"></a>[Caché](framework-rendering.md#caché)

<a id="layers"></a>[Layers](framework-configuration.md#layers)

<a id="carpetas-en-modules-deprecado"></a>[Carpetas en modules (deprecado)](framework-configuration.md#carpetas-en-modules-deprecado)

<a id="módulos"></a>[Módulos](framework-configuration.md#módulos)

<a id="tipos-de-las-opciones-sin-imports"></a>[Tipos de las opciones sin imports](framework-configuration.md#tipos-de-las-opciones-sin-imports)

<a id="escribir-un-módulo"></a>[Escribir un módulo](framework-configuration.md#escribir-un-módulo)

<a id="el-objeto-meeko"></a>[El objeto meeko](framework-configuration.md#el-objeto-meeko)

<a id="hooks"></a>[Hooks](framework-configuration.md#hooks)

<a id="plugins-de-aplicación"></a>[Plugins de aplicación](framework-configuration.md#plugins-de-aplicación)

<a id="límites-entre-servidor-y-cliente"></a>[Límites entre servidor y cliente](framework-configuration.md#límites-entre-servidor-y-cliente)

<a id="middleware-de-rutas-y-servidor"></a>[Middleware de rutas y servidor](framework-rendering.md#middleware-de-rutas-y-servidor)

<a id="middleware-con-nombre"></a>[Middleware con nombre](framework-rendering.md#middleware-con-nombre)

<a id="middleware-de-ruta-de-servidor"></a>[Middleware de ruta de servidor](framework-rendering.md#middleware-de-ruta-de-servidor)

<a id="middleware-de-servidor"></a>[Middleware de servidor](framework-rendering.md#middleware-de-servidor)

<a id="autoimports-y-typescript"></a>[Autoimports y TypeScript](framework-configuration.md#autoimports-y-typescript)

<a id="carpetas-de-autoimports"></a>[carpetas-de-autoimports](framework-configuration.md#carpetas-de-autoimports)

<a id="carpeta-con-index"></a>[carpeta-con-index](framework-configuration.md#carpeta-con-index)

<a id="tipos-de-cada-componente"></a>[tipos-de-cada-componente](framework-configuration.md#tipos-de-cada-componente)

<a id="aliases-de-ruta"></a>[Aliases de ruta](framework-configuration.md#aliases-de-ruta)

<a id="ámbitos-de-los-aliases"></a>[Ámbitos de los aliases](framework-configuration.md#ámbitos-de-los-aliases)

<a id="aliases-propios-alias"></a>[Aliases propios: alias](framework-configuration.md#aliases-propios-alias)

<a id="aliases-en-los-layers"></a>[Aliases en los layers](framework-configuration.md#aliases-en-los-layers)

<a id="prioridad-y-conflictos-de-los-aliases"></a>[Prioridad y conflictos de los aliases](framework-configuration.md#prioridad-y-conflictos-de-los-aliases)

<a id="api-y-rpc"></a>[API y RPC](framework-api.md#api-y-rpc)

<a id="schemas-públicos"></a>[Schemas públicos](framework-api.md#schemas-públicos)

<a id="segmentos-dinámicos-en-api"></a>[Segmentos dinámicos en api.*](framework-api.md#segmentos-dinámicos-en-api)

<a id="errores-de-validación-en-formularios"></a>[Errores de validación en formularios](framework-api.md#errores-de-validación-en-formularios)

<a id="errores-de-un-campo-apierror-con-issues"></a>[Errores de un campo: ApiError con issues](framework-api.md#errores-de-un-campo-apierror-con-issues)

<a id="valores-por-petición-locals"></a>[Valores por petición: locals](framework-api.md#valores-por-petición-locals)

<a id="estado-de-la-respuesta-status"></a>[Estado de la respuesta: status](framework-api.md#estado-de-la-respuesta-status)

<a id="formularios-sin-javascript-form"></a>[Formularios sin JavaScript: form](framework-api.md#formularios-sin-javascript-form)

<a id="datos-en-componentes-useapi-userpcquery-y-userpcmutation"></a>[Datos en componentes: useApi, useRpcQuery y useRpcMutation](framework-api.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation)

<a id="con-y-sin-await"></a>[Con y sin await](framework-api.md#con-y-sin-await)

<a id="ssr-e-hidratación"></a>[SSR e hidratación](framework-api.md#ssr-e-hidratación)

<a id="navegación-y-render-client"></a>[Navegación y render: "client"](framework-api.md#navegación-y-render-client)

<a id="componentes-que-se-montan-más-tarde"></a>[Componentes que se montan más tarde](framework-api.md#componentes-que-se-montan-más-tarde)

<a id="datos-anteriores-durante-una-recarga-keepprevious"></a>[Datos anteriores durante una recarga: keepPrevious](framework-api.md#datos-anteriores-durante-una-recarga-keepprevious)

<a id="búsqueda-mientras-se-escribe-debouncems-y-enabled"></a>[Búsqueda mientras se escribe: debounceMs y enabled](framework-api.md#búsqueda-mientras-se-escribe-debouncems-y-enabled)

<a id="meekoawait"></a>[<MeekoAwait>](framework-api.md#meekoawait)

<a id="reservar-la-altura-reserve"></a>[Reservar la altura: reserve](framework-api.md#reservar-la-altura-reserve)

<a id="una-transición-opcional"></a>[Una transición opcional](framework-api.md#una-transición-opcional)

<a id="evitar-saltos-de-altura-cls"></a>[Evitar saltos de altura (CLS)](framework-api.md#evitar-saltos-de-altura-cls)

<a id="mutaciones"></a>[Mutaciones](framework-api.md#mutaciones)

<a id="mutaciones-seguras-ante-reintentos"></a>[Mutaciones seguras ante reintentos](framework-api.md#mutaciones-seguras-ante-reintentos)

<a id="avisos-de-cada-intento-onsuccess-y-onerror"></a>[Avisos de cada intento: onSuccess y onError](framework-api.md#avisos-de-cada-intento-onsuccess-y-onerror)

<a id="una-clave-propia-en-api-y-rpc"></a>[Una clave propia en api.* y rpc.*](framework-api.md#una-clave-propia-en-api-y-rpc)

<a id="load-o-composables"></a>[load o composables](framework-api.md#load-o-composables)

<a id="estado-persistente-usestorage"></a>[Estado persistente: useStorage](framework-api.md#estado-persistente-usestorage)

<a id="formularios-useform"></a>[Formularios: useForm](framework-api.md#formularios-useform)

<a id="foco-en-el-primer-error"></a>[Foco en el primer error](framework-api.md#foco-en-el-primer-error)

<a id="componentes-de-campo-formfield"></a>[Componentes de campo: FormField](framework-api.md#componentes-de-campo-formfield)

<a id="websocket"></a>[WebSocket](framework-websocket.md#websocket)

<a id="clientes-con-url-y-contrato-explícitos"></a>[Clientes con URL y contrato explícitos](framework-websocket.md#clientes-con-url-y-contrato-explícitos)

<a id="broadcast-desde-el-servidor"></a>[Broadcast desde el servidor](framework-websocket.md#broadcast-desde-el-servidor)

<a id="broadcast-y-varias-instancias"></a>[Broadcast y varias instancias](framework-websocket.md#broadcast-y-varias-instancias)

<a id="runtime-de-servidor"></a>[Runtime de servidor](framework-server.md#runtime-de-servidor)

<a id="tipos-de-los-servicios"></a>[Tipos de los servicios](framework-server.md#tipos-de-los-servicios)

<a id="errores"></a>[Errores](framework-server.md#errores)

<a id="fallos-globales-del-navegador"></a>[Fallos globales del navegador](framework-server.md#fallos-globales-del-navegador)

<a id="fallos-fuera-de-una-petición"></a>[Fallos fuera de una petición](framework-server.md#fallos-fuera-de-una-petición)

<a id="autenticación"></a>[Autenticación](framework-auth.md#autenticación)

<a id="tipos-de-la-sesión-meekosession"></a>[Tipos de la sesión: MeekoSession](framework-auth.md#tipos-de-la-sesión-meekosession)

<a id="contraseñas"></a>[Contraseñas](framework-auth.md#contraseñas)

<a id="límite-de-peticiones-ratelimit"></a>[Límite de peticiones: rateLimit](framework-auth.md#límite-de-peticiones-ratelimit)

<a id="rate-limit-en-sql"></a>[Rate limit en SQL](framework-auth.md#rate-limit-en-sql)

<a id="ip-del-cliente-tras-un-proxy"></a>[IP del cliente tras un proxy](framework-auth.md#ip-del-cliente-tras-un-proxy)

<a id="cloudflare-tunnel-y-traefik"></a>[Cloudflare Tunnel y Traefik](framework-auth.md#cloudflare-tunnel-y-traefik)

<a id="sesiones-y-seguridad"></a>[Sesiones y seguridad](framework-auth.md#sesiones-y-seguridad)

<a id="sesiones-sin-configuración"></a>[Sesiones sin configuración](framework-auth.md#sesiones-sin-configuración)

<a id="duración-de-cada-sesión"></a>[Duración de cada sesión](framework-auth.md#duración-de-cada-sesión)

<a id="origin-en-mutaciones-anónimas"></a>[Origin en mutaciones anónimas](framework-auth.md#origin-en-mutaciones-anónimas)

<a id="revocación-durante-una-petición"></a>[Revocación durante una petición](framework-auth.md#revocación-durante-una-petición)

<a id="limpiar-el-proyecto"></a>[Limpiar el proyecto](framework-configuration.md#limpiar-el-proyecto)

<a id="build-despliegue-y-verificación"></a>[Build, despliegue y verificación](framework-deployment.md#build-despliegue-y-verificación)

<a id="sitio-estático"></a>[Sitio estático](framework-deployment.md#sitio-estático)

<a id="sitemapxml-y-robotstxt"></a>[sitemap.xml y robots.txt](framework-deployment.md#sitemapxml-y-robotstxt)

<a id="rutas-dinámicas-en-el-sitemap-sitemapentries"></a>[Rutas dinámicas en el sitemap: sitemapEntries](framework-deployment.md#rutas-dinámicas-en-el-sitemap-sitemapentries)

<a id="sitemap-servido-desde-una-base-de-datos"></a>[Sitemap servido desde una base de datos](framework-deployment.md#sitemap-servido-desde-una-base-de-datos)

<a id="csp-con-hashes"></a>[CSP con hashes](framework-deployment.md#csp-con-hashes)

<a id="csp-y-cabeceras-en-los-adaptadores-con-servidor"></a>[CSP y cabeceras en los adaptadores con servidor](framework-deployment.md#csp-y-cabeceras-en-los-adaptadores-con-servidor)

<a id="bun"></a>[Bun](framework-deployment.md#bun)

<a id="deno"></a>[Deno](framework-deployment.md#deno)

<a id="cloudflare-workers"></a>[Cloudflare Workers](framework-deployment.md#cloudflare-workers)

<a id="sesiones-en-d1"></a>[Sesiones en D1](framework-deployment.md#sesiones-en-d1)

<a id="redis-mediante-la-api-rest-de-upstash"></a>[Redis mediante la API REST de Upstash](framework-deployment.md#redis-mediante-la-api-rest-de-upstash)

<a id="socket-y-durable-objects"></a>[Socket y Durable Objects](framework-deployment.md#socket-y-durable-objects)

<a id="conformidad-entre-adaptadores"></a>[Conformidad entre adaptadores](framework-deployment.md#conformidad-entre-adaptadores)

<a id="resolución-de-problemas-de-pnpm-y-redis"></a>[Resolución de problemas de pnpm y Redis](framework-deployment.md#resolución-de-problemas-de-pnpm-y-redis)

<a id="rendimiento-y-baseline"></a>[Rendimiento y baseline](framework-deployment.md#rendimiento-y-baseline)

<a id="preparación-y-migración-de-proyectos"></a>[Preparación y migración de proyectos](framework-configuration.md#preparación-y-migración-de-proyectos)

<a id="migrar-un-starter-full-stack-anterior"></a>[Migrar un starter full-stack anterior](framework-configuration.md#migrar-un-starter-full-stack-anterior)

<a id="migrar-serversessionts-a-serverruntimets"></a>[Migrar server/session.ts a server/runtime.ts](framework-configuration.md#migrar-serversessionts-a-serverruntimets)

<a id="postcss-y-tailwind"></a>[postcss-y-tailwind](framework-configuration.md#postcss-y-tailwind)

<a id="utilidades-generadas-con-typescript"></a>[utilidades-generadas-con-typescript](framework-configuration.md#utilidades-generadas-con-typescript)

<a id="hoja-global-procesada-para-el-editor"></a>[hoja-global-procesada-para-el-editor](framework-configuration.md#hoja-global-procesada-para-el-editor)

<a id="variables-de-entorno-y-env"></a>[variables-de-entorno-y-env](framework-configuration.md#variables-de-entorno-y-env)

<a id="url-que-se-muestra"></a>[url-que-se-muestra](framework-configuration.md#url-que-se-muestra)

<a id="subrutas-del-paquete-y-destinos-de-ejecución"></a>[Subrutas del paquete y destinos de ejecución](framework-reference.md#subrutas-del-paquete-y-destinos-de-ejecución)

<a id="compatibilidad-y-versionado"></a>[Compatibilidad y versionado](framework-reference.md#compatibilidad-y-versionado)

<a id="límites-actuales"></a>[Límites actuales](framework-reference.md#límites-actuales)
