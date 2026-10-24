# Meeko como framework full-stack

Meeko conserva el motor independiente en `@meekojs/meeko`. El modo de aplicación usa `@meekojs/meeko/framework`, el servidor Node usa `@meekojs/meeko/server` y Vite usa `@meekojs/meeko/vite`. Las tres subrutas pertenecen al mismo paquete y versión. Node 24 es el destino de servidor publicado; SSR está activo por defecto.

La versión `0.0.4` está preparada para publicación y aún no está disponible en npm. La aplicación generada necesita Node 24 o posterior y TypeScript 7 para comprobar sus declaraciones; el compilador de `.meeko` utiliza internamente TypeScript 6. El paquete es ESM. `vite` es un peer opcional: una aplicación que sólo usa el motor puede importar `@meekojs/meeko` sin iniciar el framework, el servidor, sesiones o Socket. El adaptador Node carga `ws` al activar `attachNodeWebSocketServer`, no al importar el motor.

## Crear una aplicación

```sh
meeko init-framework my-app
cd my-app
npm install
npm run dev
```

El starter crea `meeko.config.ts`, `app/app.meeko`, `app/pages`, un layout con outlet, entradas Vite, `server/entry.ts`, `server/session.ts` y `server.mjs`. La aplicación puede organizarse así:

```text
app/{pages,components,composables,utils,stores}/
server/{api,rpc,socket,utils}/
shared/{types,schemas,utils,constants,enums}/
layers/base/app/pages/
modules/auth/app/pages/
public/
meeko.config.ts
.meeko/{types,manifests,generated,output}/
```

Meeko genera archivos sólo bajo `.meeko/`. El starter del motor aislado continúa disponible con `meeko init <directory>`.

## Configuración, módulos y layers

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  extends: ["./layers/base"],
  modules: ["./modules/auth"],
  imports: { serverDirs: ["server/services", "server/repositories"] },
});
```

Cada fuente declarada aporta su propio `app/pages`, componentes y autoimports. El orden es app, `extends` y `modules`, en el orden escrito. El manifiesto rechaza colisiones de URL; el registro rechaza nombres de autoimport repetidos. El diagnóstico incluye los archivos en conflicto. Las rutas configuradas deben vivir dentro del proyecto. La configuración de rutas se carga con Node; las listas de directorios que usa el editor deben ser arrays estáticos de cadenas para poder analizarse sin ejecutar código.

`meeko routes .` descubre todas las fuentes, emite `.meeko/manifests/routes.json` y declaraciones de rutas, contratos y autoimports. Vite genera módulos virtuales a partir del mismo descubrimiento para SSR, hidratación y navegación. Cambiar rutas, configuración o exports del registro dispara una recarga completa en desarrollo. Los componentes conservan el HMR del motor para cambios que no alteren ese registro.

## Routing, layouts y SSR

`app/pages` admite `index.meeko`, `[id].meeko`, `[...slug].meeko`, grupos `(group)`, `+layout.meeko`, `+error.meeko` y sidecars `*.route.ts`. Un layer o módulo usa las mismas convenciones. `+layout.meeko` recibe `props.outlet`; el navegador conserva layouts comunes y libera las regiones salientes. `href` comprueba IDs y parámetros a partir del manifiesto generado.

```ts
// app/pages/users/[id].route.ts: código exclusivo del servidor
import { definePage } from "@meekojs/meeko/framework";
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.string() }),
  load: async ({ params, signal }) => ({ id: params.id, signalAborted: signal.aborted }),
  head: ({ data }) => ({ title: data.id }),
});
```

Los sidecars validan params y search antes del loader. El loader puede devolver un `Response` para redirigir. El handler SSR crea el estado de `useState` y el contexto de sesión por petición; transfiere sólo props, estado público y datos de ruta serializables. El navegador hidrata ese payload y pide datos al servidor durante la navegación, por lo que un sidecar privado no entra al bundle cliente. `mountClientApp` gestiona historial, cancelación y limpieza. Se puede usar `render: "prerender"` con `prerenderEntries` para rutas dinámicas; `meeko prerender .` escribe HTML bajo `.meeko/output/prerender/` después del build.

## Autoimports y TypeScript

Meeko analiza exports AST de `app/{components,composables,utils,stores}`, `shared/{types,schemas,utils,constants,enums}` y `server/utils`. `imports.serverDirs` añade directorios privados exclusivos del servidor. Los símbolos del framework `api`, `rpc`, `socket`, `useSocket`, `useState` y `href` también figuran en el registro. Los imports explícitos prevalecen. Una colisión produce error; nunca se elige por orden de archivos.

El compilador `.meeko` y la transformación `.ts` insertan imports ESM reales. Las declaraciones por ámbito se regeneran bajo `.meeko/types/autoimports/` sólo cuando cambia el contenido, para autocompletado y navegación a definición. El editor VS Code usa el mismo registro y las posiciones AST del compilador. `shared/` no puede depender de símbolos app o servidor; el bundle cliente rechaza módulos `server/`, incluidos imports transitivos. Los `*.route.ts` pertenecen al ámbito servidor.

## API y RPC

Los archivos `server/api/users/index.get.ts`, `index.post.ts` y `[id].get.ts` crean `/api/users` y `/api/users/:id`. Los procedimientos bajo `server/rpc/users/get.ts` crean `/_meeko/rpc/users/get`. Los schemas públicos residen en `shared/`; Valibot implementa Standard Schema. Los handlers usan `defineApiRoute` y `defineRpc`, y el servidor valida entrada, salida, sesión, autorización y CSRF.

```sh
npm install valibot
```

```ts
// shared/schemas/user.ts
import * as v from "valibot";
export const userParams = v.object({ id: v.string() });
export const userSchema = v.object({ id: v.string(), name: v.string() });
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
// app/pages/users/index.meeko, sin imports manuales
const loadUsers = async () => {
  const users = await api.users.get();
  const user = await api.users.byId.get({ params: { id: "123" } });
  const result = await rpc.users.get({ id: "123" });
  return { users, user, result };
};
```

Esos símbolos también funcionan en `.ts` según el ámbito. `meeko routes .` genera `.meeko/generated/clients.client.ts` y `clients.server.ts` con descriptores públicos y tipos inferidos; no importan handlers privados. En SSR, los clientes consultan el contexto actual en cada llamada y despachan localmente por el mismo pipeline HTTP si el host suministra `createLocalServerFetch`. El starter ya lo conecta. Credenciales, sesión, servicios, estado y `requestId` quedan ligados a la petición original. Fuera de un contexto SSR, una llamada al cliente servidor falla con un error claro. En navegador se usa `fetch` same-origin y se lee el token CSRF de la meta `meeko-csrf-token`, que se actualiza tras respuestas y navegación. `createApiClient` y `createRpcClient` siguen disponibles para clientes explícitos o externos. Los errores exponen `code`, `status` y `requestId`, sin detalles privados. Las respuestas no JSON requieren `contentType: "response"`.

## WebSocket

`server/socket/chat.ts` exporta un `defineSocketChannel` con schemas separados para cada dirección. Los schemas expuestos al cliente deben venir de `shared/`. El generador emite un contrato público sin importar handlers privados.

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

`socket.chat.on(...)` y `socket.chat.emit(...)` ofrecen un registro tipado alternativo. El registro abre conexiones sólo al acceder al canal en navegador; `useSocket` requiere una raíz de componente y libera la conexión al desmontar. Durante SSR no se abre ninguna conexión. El cliente usa WebSocket nativo, reconexión con retroceso configurable y entrega a lo sumo una vez: `emit` rechaza si está desconectado, sin cola ni reenvío.
El registro `socket` es de alcance de aplicación: cancele listeners con la función que devuelve `on` y cierre el canal cuando ya no se necesite.

El starter conecta `attachNodeWebSocketServer` al mismo servidor HTTP. El adaptador oficial usa `ws` para framing y upgrades, y el hub existente valida Origin, sesión, canal, sala, evento y payload; aplica límites de mensaje/buffer, heartbeat y cierre ordenado. El host puede suministrar `publicOrigin` cuando opera tras un proxy. `LocalSocketPubSub` cubre una instancia; `SocketPubSub` permite un adaptador distribuido futuro, pero Redis Pub/Sub aún no está implementado.

## Sesiones y seguridad

Las sesiones usan IDs opacos aleatorios en cookies `HttpOnly`, host-only, `Secure` por defecto y `SameSite=Lax` por defecto. `SessionHandle` permite crear, rotar y revocar; la rotación requiere reemplazo atómico. Las mutaciones autenticadas con cookie verifican Origin y `x-meeko-csrf`. Las respuestas SSR y API entregan el token CSRF por meta o cabecera same-origin. La aplicación debe definir verificación de identidad y reglas de autorización; Meeko no guarda secretos de autenticación en el navegador.

`MemorySessionStore` sirve sólo en desarrollo. `SessionManager({ production: true, store })` exige `persistent: true` y `replace` atómico; el starter falla al arrancar en producción hasta que se configure un store persistente en `server/session.ts`. `RedisSessionStore` acepta un cliente compatible con `get`, `set` con `PX`, `del` y `eval`; use un prefijo propio por aplicación y entorno. `SqlSessionStore` acepta un `SqlSessionDriver` con `read`, `write`, `remove`, `replace` transaccional y `close`. El ejemplo ejecutable en `tests/fixtures/fullstack-consumer/server/session.ts` usa SQLite real; el framework no depende de una librería SQL ni de un motor de base de datos concreto. `SessionManager.close()` libera el store cuando el host es propietario del recurso.

Para Redis, instale `redis` en la aplicación, cree el cliente con `createClient({ url: process.env.REDIS_URL })`, llame `connect()` antes de servir tráfico y páselo a `RedisSessionStore` con un prefijo propio. El host debe cerrar su cliente con `quit()` al detenerse; `SessionManager.close()` cierra el store, pero no se apropia de clientes externos. La prueba de integración `tests/redis.integration.ts` usa un namespace aleatorio y sólo borra sus propias claves. Se ejecuta contra un Redis real con `MEEKO_REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx --test tests/redis.integration.ts`; CI dispone de un servicio Redis dedicado. La prueba local requiere un Redis accesible y no usa bases ajenas.

Un almacenamiento caído propaga error y no concede acceso. No se debe usar un store en memoria en producción. `Secure` requiere HTTPS en despliegue; configure el proxy y `PUBLIC_ORIGIN` acorde al origen público.

## Build, despliegue y verificación

```sh
npm run check   # manifiestos, tipos, componentes y proyectos TypeScript separados
npm run build   # cliente, servidor y prerender bajo .meeko/output/
npm start       # Node 24, con store persistente configurado
```

El starter sirve assets compilados y HTML SSR desde un proceso Node. Para un servicio público, sitúelo tras un proxy HTTPS, configure `PUBLIC_ORIGIN`, sesiones persistentes y cierre ordenado. La exportación OpenAPI es opcional mediante `generateOpenApi`; un schema que no pueda representarse produce error explícito.

`pwsh -NoProfile -File tests/fullstack-consumer.ps1` instala un tarball local en un proyecto independiente, genera tipos, construye producción, arranca Node y prueba HTTP, dos sesiones, RPC/CSRF, WebSocket real y Chrome. El fixture contiene páginas `/`, `/users`, `/dashboard`, `/chat` y `/layer-demo`.

Antes de preparar una publicación, ejecute `pnpm install --frozen-lockfile`, `pnpm run verify`, `pnpm run e2e`, `pnpm run pilot:e2e`, `pnpm run package:smoke`, la prueba Redis anterior, `pwsh -NoProfile -File tests/fullstack-consumer.ps1`, `pnpm pack` y `git diff --check`. La CI ejecuta estas familias de comprobaciones en Windows y Redis en Ubuntu. La existencia del workflow no sustituye una ejecución verde de CI. El workflow de publicación repite los gates y sólo responde a una etiqueta de versión; la decisión de crearla corresponde al mantenedor.

### Resolución de problemas de pnpm y Redis

Si pnpm 12 muestra `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, compruebe el usuario efectivo y el ACL del archivo. En este sandbox Windows, `codexsandboxonline` sólo puede leer el lock global propiedad de otro usuario; una apertura de escritura de `all-stores.lock` falla con `Acceso denegado (os error 5)`. `--store-dir` y `LOCALAPPDATA` por sí solos no cambian esa ubicación. No elimine el almacén ni cambie ACL globales para superar este caso.

Una instalación congelada con pnpm 12.14.0 pasó en una copia limpia al aislar el perfil sólo dentro del proceso PowerShell que lanzó pnpm, con el comando exacto `pnpm install --frozen-lockfile`, sin enlaces de dependencias:

```powershell
$isolatedProfile = Join-Path (Get-Location).Path '.meeko/pnpm-profile'
$env:USERPROFILE = $isolatedProfile
$env:LOCALAPPDATA = Join-Path $isolatedProfile 'AppData/Local'
$env:APPDATA = Join-Path $isolatedProfile 'AppData/Roaming'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:APPDATA -Force | Out-Null
pnpm install --frozen-lockfile
```

Ejecute el bloque en un proceso PowerShell nuevo para que las variables recuperen sus valores al salir. En una terminal con acceso de escritura al perfil habitual, use el comando de instalación directamente. Este sandbox también hace fallar `node:os.userInfo()` con `uv_os_get_passwd returned ENOMEM`; `tsx` lo llama al iniciar pruebas en Windows. Es un bloqueo separado: la instalación pnpm 12 pasó, pero `pnpm run verify` sin preload falló antes de cargar los tests. No se ha modificado el comportamiento normal de Meeko para ocultarlo.

La prueba Redis requiere que `MEEKO_REDIS_URL` apunte a un servidor de pruebas accesible. Un error de conexión o `WRONGTYPE` debe fallar; el adaptador no concede acceso a una sesión cuando Redis no está disponible. Use un prefijo distinto por proyecto y entorno; no ejecute `FLUSHALL` ni `FLUSHDB` en un Redis compartido.

`pnpm run pilot:e2e` registra cada motor y entorno y limita sus lanzamientos. En el sandbox Windows de esta auditoría, Firefox pudo iniciar el ejecutable pero `browser.newPage()` terminó con `Target crashed`. La suite pasó con `MOZ_DISABLE_CONTENT_SANDBOX=1` aplicado sólo al proceso de prueba; esto desactiva una protección del navegador y no es configuración predeterminada del proyecto ni de CI. En una máquina normal, ejecute primero sin esa variable. Si falla un lanzamiento, `DEBUG=pw:browser*` muestra el proceso y la conexión de Playwright.

## Rendimiento y baseline

`pwsh -NoProfile -File tests/fullstack-consumer.ps1 -Benchmark` reproduce el consumidor externo, construye la aplicación mínima y escribe `.meeko/benchmarks/stability-baseline.json`. El baseline conservado está en `benchmarks/baseline-2026-10-24.json`. Cada tiempo usa siete muestras y dos calentamientos; el JSON contiene mediana, percentiles 10/90 y extremos. La compilación fría usa un worker nuevo por muestra; HMR mide una edición visible en Chrome con un servidor Vite nuevo por muestra. SSR y dispatchers se miden en proceso sobre el bundle de producción. Las mediciones de tamaño incluyen JS y CSS comprimidos con gzip. Son medidas de esta máquina, no umbrales de CI.

| Métrica | Mediana o tamaño | p10â€“p90 |
| --- | ---: | ---: |
| Compilación fría | 9.40 ms | 9.08â€“9.45 ms |
| Compilación tras edición | 0.87 ms | 0.53â€“1.14 ms |
| HMR visible | 28.63 ms | 27.19â€“29.11 ms |
| SSR por petición | 0.040 ms | 0.032â€“0.060 ms |
| Hidratación | 11.10 ms | 10.70â€“11.20 ms |
| Navegación cliente | 1.90 ms | 1.80â€“2.10 ms |
| Dispatcher API | 0.019 ms | 0.017â€“0.019 ms |
| Dispatcher RPC | 0.049 ms | 0.044â€“0.054 ms |
| Bundle motor | 19,134 B; gzip 7,222 B | â€” |
| Bundle mínimo | 21,314 B; gzip 6,438 B | â€” |
| Bundle full-stack | 36,063 B; gzip 14,897 B | â€” |

Tras 500 renders SSR, el heap pasó de 87,276,056 a 87,012,304 bytes después de GC; RSS máximo observado: 224,952,320 bytes. Esta muestra no prueba ausencia de fugas y debe compararse sólo bajo condiciones equivalentes.

## Compatibilidad y versionado

Las entradas públicas soportadas de la versión actual son `@meekojs/meeko`, `/framework`, `/server`, `/vite` y `/devtools-ui`. `/internal` existe para el código generado por Meeko y no es contrato de consumo directo. El motor (`compile`, reactividad, SSR e hidratación), `defineMeekoConfig`, routing, `definePage`, `useState`, `createApiClient`, `createRpcClient`, `defineSocketChannel`, `attachNodeWebSocketServer`, `RedisSessionStore` y `SqlSessionStore` conservan sus nombres actuales. Los autoimports generados `api`, `rpc`, `socket` y `useSocket` dependen del manifiesto de cada aplicación.

Mientras la versión sea `0.x`, documente cada cambio incompatible y añada una entrada a `CHANGELOG.md` antes de aumentar minor; use patch para correcciones compatibles. En `1.x`, los cambios incompatibles requieren major. Una publicación requiere lockfile reproducible con el pnpm declarado, CI verde, consumidor externo y revisión del tarball. No se aumenta la versión automáticamente. Socket distribuido, adaptador edge y uso dinámico de configuración en el editor siguen siendo experimentales o no implementados.

## Límites actuales

- El adaptador de servidor publicado es Node 24; no hay adaptador edge.
- Redis tiene una prueba de integración con servidor real configurada en CI; su ejecución local depende de un servidor accesible. El adaptador SQL se probó con SQLite real. Redis Pub/Sub para Socket queda pendiente.
- Los canales Socket se descubren como archivos con nombre simple bajo `server/socket/`.
- Cambios en configuración o registro de autoimports fuerzan recarga completa en Vite. Las listas de configuración del editor deben ser estáticas.
- `server/session.ts` del starter requiere una implementación persistente antes de servir producción.
