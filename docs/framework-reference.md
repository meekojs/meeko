# Runtimes, compatibilidad y límites

Esta guía desarrolla [la visión general del framework](framework.md).

## Subrutas del paquete y destinos de ejecución

Meeko conserva el motor independiente en `@meekojs/meeko`. El modo de aplicación usa `@meekojs/meeko/framework` y Vite usa `@meekojs/meeko/vite`. El servidor se reparte en estas subrutas:

- `@meekojs/meeko/server`: núcleo portable de la aplicación (`createServerApp`, `defineServerRuntime`, contratos API/RPC, sesiones, middleware, Socket, `createSocketUpgradeHandler`, OpenAPI y, desde `1.3`, `contentSecurityPolicy`). Sólo usa Web APIs y `node:async_hooks`; no carga TypeScript, Vite, `ws` ni el sistema de archivos.
- `@meekojs/meeko/node`: adaptador Node (`serveNode`, `toNodeListener`, `createNodeAssetReader`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler`).
- `@meekojs/meeko/password` (desde `1.2`): `hashPassword`, `verifyPassword` y `needsRehash` con scrypt; necesita `node:crypto`, así que sirve en Node, Bun y Deno, no en Workers (véase [Contraseñas](framework-auth.md#contraseñas)).
- `@meekojs/meeko/bun`: adaptador Bun (`createBunServer` y `createBunAssetReader`).
- `@meekojs/meeko/deno`: adaptador Deno (`serveDeno` y `createDenoAssetReader`).
- `@meekojs/meeko/cloudflare`: adaptador Cloudflare Workers (`createWorker`, `createSocketRoomClass`, `DurableObjectSocketPubSub`, `D1SessionDriver`, `createCloudflareAssetReader` y `createCloudflarePrerenderSource`).
- `@meekojs/meeko/build`: herramientas de build que leen el sistema de archivos y cargan TypeScript (`discoverRoutes`, `discoverErrorPage`, `discoverConfiguredRoutes`, `composeFrameworkRoutes`, `loadMeekoConfig`, `readMeekoConfigSync`, `resolveConfigSources`, `discoverServerManifest`, `prerenderRoutes`, `prerenderProject`, `buildProject` y, desde `1.3`, `inlineScriptHashes`). El servidor de producción no la importa.

Todas las subrutas pertenecen al mismo paquete y versión. Los destinos de servidor publicados son Node 24, Bun, Deno y Cloudflare Workers, y la misma suite de conformidad los comprueba (véase [Build, despliegue y verificación](framework-deployment.md#build-despliegue-y-verificación)). Desde `1.3`, el adaptador `static` genera además un sitio de archivos, sin servidor, para un hosting estático (véase [Sitio estático](framework-deployment.md#sitio-estático)). El build y las herramientas de desarrollo siguen ejecutándose con Node. SSR está activo por defecto.

La aplicación generada necesita Node 24 o posterior y TypeScript 7 para comprobar sus declaraciones; el compilador de `.meeko` utiliza internamente TypeScript 6 sólo durante el desarrollo y el build. El paquete es ESM. `vite` es un peer opcional: una aplicación que sólo usa el motor puede importar `@meekojs/meeko` sin iniciar el framework, el servidor, sesiones o Socket. El adaptador Node carga `ws` al activar `attachNodeWebSocketServer`, no al importar el motor.

## Compatibilidad y versionado

Las entradas públicas soportadas de la versión actual son `@meekojs/meeko`, `/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare`, `/build`, `/vite`, `/devtools-ui`, desde `1.1`, `/prettier` y, desde `1.2`, `/password` y `/postcss`. `/internal` existe para el código generado por Meeko y no es contrato de consumo directo. La compilación se ofrece mediante la CLI y Vite; la raíz pública expone la reactividad y el runtime de SSR e hidratación, pero no una función `compile`. `defineMeekoConfig`, routing, `definePage`, `useState`, `createApiClient`, `createRpcClient`, `defineSocketChannel`, `attachNodeWebSocketServer`, `RedisSessionStore` y `SqlSessionStore` conservan sus nombres actuales. Los autoimports generados `api`, `rpc`, `socket` y `useSocket` dependen del manifiesto de cada aplicación.

Meeko sigue SemVer desde `1.0`: el contrato público, lo que no es público y la política de deprecación están en [stability.md](stability.md). Una publicación requiere lockfile reproducible con el pnpm declarado, CI verde, consumidor externo y revisión del tarball. No se aumenta la versión automáticamente.

## Límites actuales

- Los adaptadores de servidor publicados son Node 24, Bun, Deno y Cloudflare Workers, y desde `1.3` el adaptador `static`, que sólo admite páginas prerenderizadas; la suite de conformidad se ejecuta con Bun 1.4.4, Deno 2.9.8 y workerd 1.20261019.1 (wrangler 4.152.0). En Workers, Socket requiere Durable Objects, las sesiones requieren D1 o Redis por la API REST de Upstash (KV no es válido) y D1 no notifica revocaciones a otros aislados.
- Redis tiene una prueba de integración con servidor real configurada en CI; su ejecución local depende de un servidor accesible. El adaptador SQL se probó con SQLite real. `RedisSocketPubSub` se prueba en la misma integración con dos procesos.
- Los canales Socket se descubren como archivos con nombre simple bajo `server/socket/`.
- Cambios en configuración o registro de autoimports fuerzan recarga completa en Vite.
- La producción requiere un store de sesiones persistente: `MEEKO_REDIS_URL` en Node, Bun y Deno, o `sessions` propias en `server/runtime.ts` (en Workers, D1 o Upstash).
- La revocación por familia invalida el ID activo ante rotaciones concurrentes, aborta `RequestContext.signal` de las peticiones en curso de esa familia y cierra sus sockets. En otras instancias, esto requiere un store con `subscribeRevocations`. El aborto es cooperativo: el código que no observa `context.signal` sigue ejecutándose hasta su siguiente comprobación, y el aviso entre instancias llega con la latencia del broker. Llame `context.session.verify()` antes de efectos irreversibles. Si la aplicación requiere orden estricto entre operaciones en curso, debe coordinarlas. Meeko evita que una respuesta anterior restaure un token CSRF ya cambiado.
- La navegación cliente es transaccional. Sin layouts compartidos, la vista nueva se hidrata junto a la actual entre marcadores privados y la anterior sólo se retira y libera después de una hidratación correcta. Con un layout conservado, el outlet restaura e hidrata de nuevo su página anterior si falla la nueva. En ambos casos la ruta visible, su URL y su estado siguen activos y `navigate()` rechaza con el error original. Sólo si también falla esa restauración, Meeko solicita una carga completa de la última URL confirmada. Durante la hidratación de la vista nueva, la anterior sigue en el documento: un `id` repetido entre ambas páginas puede resolver al elemento antiguo hasta el commit.
- Si la API de historial del navegador falla después de renderizar, Meeko solicita recargar la última URL confirmada y propaga el error original. Si también falla esa recuperación, conserva ambas causas en `AggregateError`.
