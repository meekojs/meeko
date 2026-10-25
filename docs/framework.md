# Meeko como framework full-stack

Meeko conserva el motor independiente en `@meekojs/meeko`. El modo de aplicación usa `@meekojs/meeko/framework`, el servidor Node usa `@meekojs/meeko/server` y Vite usa `@meekojs/meeko/vite`. Las tres subrutas pertenecen al mismo paquete y versión. Node 24 es el destino de servidor publicado; SSR está activo por defecto.

La aplicación generada necesita Node 24 o posterior y TypeScript 7 para comprobar sus declaraciones; el compilador de `.meeko` utiliza internamente TypeScript 6. El paquete es ESM. `vite` es un peer opcional: una aplicación que sólo usa el motor puede importar `@meekojs/meeko` sin iniciar el framework, el servidor, sesiones o Socket. El adaptador Node carga `ws` al activar `attachNodeWebSocketServer`, no al importar el motor. Los comandos simplificados de proyecto descritos a continuación forman parte de `0.1.0` en preparación; todavía no están disponibles en `0.0.4` publicada.

## Crear una aplicación

```sh
meeko init-framework my-app
cd my-app
npm install
npm run dev
```

El starter crea `meeko.config.ts`, `app/app.meeko`, `app/pages`, `app/styles/main.css`, un layout con outlet y `server/session.ts`. Meeko genera las entradas cliente/servidor y sus configuraciones de build bajo `.meeko/`; el consumidor ejecuta `meeko dev`, `meeko check`, `meeko build` y `meeko start` mediante los scripts de `package.json`. La aplicación puede organizarse así:

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

Meeko genera entradas Vite y configuraciones TypeScript por ámbito sólo bajo `.meeko/`. El único `tsconfig.json` raíz conecta VS Code con esos proyectos generados para conservar diagnósticos y autocompletado en archivos `.ts`. `server/session.ts` sigue siendo código de la aplicación: debe definir un store persistente para producción. El starter del motor aislado continúa disponible con `meeko init <directory>`.

### Migrar un starter full-stack anterior

Una aplicación generada con `0.0.4` puede adoptar el host de proyecto actual sin mantener entradas manuales. Cambie sus scripts a `meeko dev`, `meeko check`, `meeko build` y `meeko start`; ejecute primero el nuevo build y compare cualquier personalización propia. Después puede retirar `server.mjs`, las entradas cliente/servidor, las configuraciones Vite y los `tsconfig.*` por ámbito que Meeko genera ahora bajo `.meeko/`. El `tsconfig.json` raíz sí permanece como enlace para el editor.

Si desea la convención actual de layouts, mueva el layout raíz a `app/layouts/default.meeko`. No conserve simultáneamente ese archivo y `app/pages/+layout.meeko`, porque ambos representarían el mismo nivel del árbol. Traslade las personalizaciones representables a middleware, handlers y convenciones públicas soportadas. Si una personalización del host o de Vite no tiene todavía una API pública equivalente, conserve el host manual; la migración no debe borrar ni atribuir a `meeko.config.ts` capacidades que no ofrece.

`app/styles/main.css` es opcional y se carga automáticamente como hoja global en desarrollo y en el build. Vite la incluye en el asset CSS de producción; Meeko enlaza ese asset en el HTML SSR y prerenderizado. Los bloques `<style>` de `.meeko` siguen disponibles para estilos locales.

En desarrollo, Vite abre un WebSocket HMR en un puerto derivado de `PORT` para que dos aplicaciones Meeko no compitan por el puerto predeterminado de Vite. `MEEKO_HMR_PORT` permite fijarlo explícitamente cuando el entorno lo exige; el navegador debe poder acceder a ese puerto además del HTTP de la aplicación.

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

El descubrimiento de servidor también rechaza árboles de cliente imposibles. Por ejemplo, no permite que `api.users.get()` sea a la vez una función y el padre de `api.users.get.post()`, ni que un procedimiento `rpc.users()` sea el padre de `rpc.users.get()`. El error se produce al generar el manifiesto e identifica ambos archivos, antes de inicializar el cliente o emitir tipos contradictorios.

`meeko routes .` descubre todas las fuentes, emite `.meeko/manifests/routes.json` y declaraciones de rutas, contratos y autoimports. Vite genera módulos virtuales a partir del mismo descubrimiento para SSR, hidratación y navegación. En desarrollo, editar una página o layout existente actualiza el módulo SSR y recarga el navegador; el servidor conserva el almacén de sesiones. Los sidecars y handlers API/RPC existentes se cargan desde Vite al llamarlos. Al crear o eliminar rutas, endpoints o canales, editar un canal Socket o cambiar `meeko.config.ts`, reinicie `npm run dev` y ejecute `npm run check` para actualizar los manifiestos y tipos.

El `href` tipado no admite `params` en rutas sin parámetros. Para rutas dinámicas exige las claves declaradas en el manifiesto; el runtime comprueba además sus valores y rechaza claves extra.

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

Para interceptar HTTP en Node antes del handler de página o API/RPC, coloque middleware en `server/middleware/*.ts` y use `defineServerMiddleware` desde `@meekojs/meeko/server`. Recibe `Request` y `next(request?)`; debe devolver un `Response`. Puede continuar, modificar una respuesta o cortocircuitar. Meeko ejecuta los archivos por nombre, de fuera hacia dentro; `next()` sólo se puede llamar una vez. El middleware se ejecuta antes de crear el contexto de sesión de la petición. Los controles integrados de autenticación, autorización, contratos y CSRF de API/RPC siguen ejecutándose dentro del handler.

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

Este pipeline envuelve páginas SSR y `/api` y `/_meeko/rpc`; los assets estáticos, el servidor de desarrollo Vite y los upgrades WebSocket tienen sus propios handlers. Los archivos `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts` se excluyen. El descubrimiento automático de middleware se limita por ahora al proyecto raíz: `extends` y `modules` aportan rutas y autoimports, pero sus carpetas `app/middleware` y `server/middleware` no participan. Editar un archivo de middleware existente invalida módulos y recarga el navegador en desarrollo; al añadir o quitar un archivo, reinicie `npm run dev` para actualizar los globs de entradas generadas. `npm run check` comprueba los tipos en sus ámbitos respectivos.

Los callbacks `onNavigationError` pueden devolver una promesa: si el observador falla, Meeko registra tanto el fallo del observador como el error de navegación original sin generar un rechazo sin manejar. Los observadores `onError` del servidor tampoco modifican la respuesta cuando lanzan o rechazan; el registro de respaldo incluye el `requestId` disponible y categorías de error, sin mensajes privados.

Los eventos de componentes pueden observarse por raíz con `provideErrorHandler` en el `<script>` de `app/app.meeko` o de un layout; se autoimporta y el callback recibe `unknown`. Los hijos heredan el observador más cercano, también después de un reemplazo HMR. En una aplicación montada, navegación y Socket consultan el primer proveedor activo de esa aplicación cuando no existe un `onNavigationError` u `onError` explícito. Ese proveedor se desregistra al liberar su raíz; un fallo del observador se registra con el error original. Las llamadas directas a `app.navigate()` y `socket.emit()` mantienen sus rechazos para el código que las espera. En SSR no hay eventos de navegador ni conexiones Socket.

Si un middleware servidor llama a `next()`, Meeko espera también ese trabajo aunque el middleware olvide esperar la promesa. Un fallo del tramo siguiente se propaga al handler HTTP; si fallan ambos, se conserva cada error en un `AggregateError`. El middleware debe devolver una respuesta del pipeline o una respuesta propia.

## Routing, layouts y SSR

`app/pages` admite `index.meeko`, `[id].meeko`, `[...slug].meeko`, grupos `(group)`, `+error.meeko` y sidecars `*.route.ts`. El layout compartido vive en `app/layouts/default.meeko` y recibe `props.outlet`; el navegador lo conserva entre rutas y libera las páginas salientes. Los `+layout.meeko` junto a páginas siguen admitidos para proyectos anteriores y layouts anidados; no se puede combinar uno en la raíz de `app/pages` con `app/layouts/default.meeko`. Un layer o módulo usa las mismas convenciones. `href` comprueba IDs y parámetros a partir del manifiesto generado.

El tipo del outlet en `app/app.meeko` y en cada layout es `Component<Record<string, unknown>>` importado desde `@meekojs/meeko`. Incluye `renderWithState`, requerido por `<component is="props.outlet">` para transferir el estado SSR; el starter generado usa este contrato.

Si una página falla y existe `+error.meeko`, Meeko la carga y renderiza con el mismo contexto de petición y estado SSR. El observador del servidor recibe el fallo original con su `requestId`; el HTML muestra un mensaje público y no incluye detalles privados. Si también falla la página de error, el servidor registra ese segundo fallo y entrega una respuesta segura.

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

Los sidecars validan params y search antes del loader. El loader puede devolver un `Response` para redirigir. `meeko check .` compara el `ComponentProps` de cada página con los `params`, `search` y datos que entrega su sidecar; un error de contrato identifica ambos archivos. También comprueba que `app/app.meeko` y los layouts acepten el `outlet` suministrado por Meeko, y que `+error.meeko` acepte `status` y `message`. Estos contratos rechazan props declaradas como `any`, `never` o `unknown`. Los datos del loader son obligatorios para la página cuando el sidecar declara `load`; una query repetida sin schema puede producir `string[]`, además de `string`. El handler SSR crea el estado de `useState` y el contexto de sesión por petición; transfiere sólo props, estado público y datos de ruta serializables. El navegador hidrata ese payload y pide datos al servidor durante la navegación, por lo que un sidecar privado no entra al bundle cliente. `mountClientApp` gestiona historial, cancelación y limpieza. Si un host usa `loadRoute` directamente en cliente, su loader recibe un estado provisional: Meeko aplica sus cambios al confirmar la ruta y los descarta al cancelar o fallar. Las señales de ese estado deben usarse durante `load`, sin conservar referencias después de retornar. Se puede usar `render: "prerender"` con `prerenderEntries` para rutas dinámicas; `meeko prerender .` escribe HTML bajo `.meeko/output/prerender/` después del build.
La comprobación del loader cubre tanto `definePage({ load() { /* ... */ } })` como `definePage(options)` cuando el tipo de `options` conserva un `load` obligatorio.

Los componentes recibidos como props mantienen la dirección del contrato: un componente que exige `label` no satisface un outlet que puede renderizarlo sin `label`. `meeko check` diagnostica la expresión que pasa el componente. Al guardar un módulo TypeScript importado por un `.meeko` abierto, la extensión de VS Code vuelve a comprobar sus diagnósticos y tokens semánticos.

## Autoimports y TypeScript

Meeko analiza exports AST de `app/{components,composables,utils,stores}`, `shared/{types,schemas,utils,constants,enums}` y `server/utils`. Los símbolos de `app/` están disponibles en cliente y SSR, pero no desde `shared/`; los sufijos `.client.ts` y `.server.ts` restringen un módulo a su entorno. `imports.serverDirs` añade directorios privados exclusivos del servidor. Los símbolos del framework `api`, `rpc`, `socket`, `useSocket`, `useState` y `href` también figuran en el registro. Los imports explícitos prevalecen. Una colisión produce error; nunca se elige por orden de archivos.

El compilador `.meeko` y la transformación `.ts` insertan imports ESM reales. Las declaraciones por ámbito se regeneran bajo `.meeko/types/autoimports/` sólo cuando cambia el contenido, para autocompletado y navegación a definición. Los tipos genéricos reexportados conservan parámetros, restricciones y defaults; las firmas overload del mismo símbolo se registran una sola vez, mientras una colisión entre orígenes distintos sigue fallando. El editor VS Code usa el mismo registro y las posiciones AST del compilador. Los proyectos app, server y shared generados por `meeko check` aplican también `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` y `verbatimModuleSyntax`. `shared/` no puede depender de símbolos app o servidor; el bundle cliente rechaza módulos `server/`, incluidos imports transitivos. Los `*.route.ts` pertenecen al ámbito servidor.

Al migrar código que no usaba esas opciones estrictas, cambie imports usados sólo como tipos a `import type`, compruebe el resultado de accesos por índice antes de usarlo y añada `| undefined` únicamente cuando la ausencia sea parte real del contrato. No silencie los diagnósticos ensanchando props o contratos públicos a `any`: Meeko usa esos tipos para generar el cliente, validar el servidor y mantener iguales CLI y editor.

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
  const user = await api.users.byId.get({ params: { id: "123" } });
  const result = await rpc.users.get({ id: "123" });
  return { users, user, result };
};
```

Esos símbolos también funcionan en `.ts` según el ámbito. `meeko routes .` genera `.meeko/generated/clients.client.ts` y `clients.server.ts` con descriptores públicos y tipos inferidos; no importan handlers privados. En SSR, los clientes consultan el contexto actual en cada llamada y despachan localmente por el mismo pipeline HTTP si el host suministra `createLocalServerFetch`. El starter ya lo conecta. Credenciales, sesión, servicios, estado y `requestId` quedan ligados a la petición original. Fuera de un contexto SSR, una llamada al cliente servidor falla con un error claro. En navegador se usa `fetch` same-origin y se lee el token CSRF de la meta `meeko-csrf-token`, que se actualiza tras respuestas y navegación. `createApiClient` y `createRpcClient` siguen disponibles para clientes explícitos o externos. Las respuestas no JSON requieren `contentType: "response"`.

Una respuesta API/RPC iniciada antes de un cambio de token no puede restaurar un token CSRF ya eliminado por logout ni sobrescribir el token aplicado por navegación. El cliente compara el documento y el token actuales con los que tenía al iniciar la petición antes de aplicar la cabecera de respuesta.

Los schemas `params` de API deben describir exactamente los segmentos dinámicos de la ruta como cadenas obligatorias. Una ruta estática no declara `params`. Los inputs de `query` deben aceptar cadenas o listas de cadenas, con campos opcionales si la clave puede faltar. Si se necesitan números, conviértalos dentro del schema desde texto; el generador rechaza un contrato que exige directamente un número que la URL no puede entregar.

Los schemas públicos de API, RPC y Socket deben exponer tipos Standard Schema concretos: la generación rechaza `any`, `unknown` y `never` tanto en la entrada como en la salida, incluso cuando aparecen anidados, y también parámetros genéricos que no quedan resueltos en el contrato exportado. Concrete esos parámetros y modele explícitamente el tipo público antes de generar clientes. El manifiesto también rechaza nombres que no puedan representarse sin ambigüedad en el cliente. Por ejemplo, `server/api/users/index.get.ts` (`api.users.get()`) no puede coexistir con `server/api/users/get.post.ts` (`api.users.get.post()`), ni `server/rpc/users.ts` con `server/rpc/users/get.ts`. `server/api/index.<method>.ts` se rechaza porque produciría una clave cliente vacía. Cada diagnóstico incluye las rutas en conflicto; no hay sobrescrituras silenciosas.

`meeko check .` genera proyectos TypeScript separados para cliente, servidor y shared. Incluye las fuentes de los layers y módulos declarados en `meeko.config.ts`, aunque sus rutas no usen los nombres convencionales `layers/` o `modules/`. Un archivo `*.server.ts` de `app/` se comprueba en el proyecto servidor y uno `*.shared.ts` en el proyecto shared; los archivos con sufijo de ámbito conservan esa selección también dentro de `shared/` y `server/`.

Los errores de API y RPC se normalizan en el servidor: un `ApiError` conserva `code` y `status`, la respuesta añade `requestId` y `x-request-id`, y un fallo desconocido se devuelve como `INTERNAL_ERROR` sin exponer su mensaje. La misma normalización se aplica al despacho local SSR y al transporte Node, incluso cuando Vite carga módulos en grafos distintos. La navegación que solicita `application/meeko+json` recibe el mismo formato; una página HTML de error conserva el estado HTTP y `x-request-id` sin incluir detalles privados. El servidor generado observa los fallos 5xx: en producción registra tipo e ID, y en desarrollo muestra también el error original. Las respuestas 4xx esperadas no se registran como fallos internos.

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

`socket.chat.on(...)` y `socket.chat.emit(...)` ofrecen un registro tipado alternativo. El registro abre conexiones sólo al acceder al canal en navegador. Dentro de `mountClientApp`, cada aplicación conserva su propia conexión por canal y la cierra al desmontarse; los listeners registrados durante el setup se desuscriben al liberar su raíz. Fuera de una aplicación montada, el registro conserva su cliente compartido y el llamador debe liberar sus listeners. `useSocket` requiere una raíz de componente y libera su conexión al desmontar. Durante SSR no se abre ninguna conexión. El cliente usa WebSocket nativo, reconexión con retroceso configurable y entrega a lo sumo una vez: `emit` rechaza si está desconectado, sin cola ni reenvío. Los mensajes entrantes inválidos cierran el canal; un error del transporte se informa una vez por conexión activa y los errores de conexiones reemplazadas se ignoran. Un listener u observador de `state` que falle se informa sin impedir la ejecución de los demás listeners ni salir del callback del transporte. El cliente de bajo nivel acepta `onError(error)` para observar estos fallos; sin callback de aplicación o componente, los registra en la consola.
El registro `socket` es de alcance de aplicación: cancele listeners con la función que devuelve `on` y cierre el canal cuando ya no se necesite.

El starter conecta `attachNodeWebSocketServer` al mismo servidor HTTP. El adaptador oficial usa `ws` para framing y upgrades, y el hub existente valida Origin, sesión, canal, sala, evento y payload; aplica límites de mensaje/buffer, heartbeat y cierre ordenado. Un peer que falla durante un broadcast se cierra y se desuscribe; el hub intenta entregar a los demás y comunica el fallo al emisor. El host puede suministrar `publicOrigin` cuando opera tras un proxy. `LocalSocketPubSub` cubre una instancia; `SocketPubSub` permite un adaptador distribuido futuro, pero Redis Pub/Sub aún no está implementado.

## Sesiones y seguridad

Las sesiones usan IDs opacos aleatorios en cookies `HttpOnly`, host-only, `Secure` por defecto y `SameSite=Lax` por defecto. Cada sesión nueva recibe también un `familyId` opaco que permanece al rotar su ID. `SessionHandle` permite crear, rotar y revocar; la rotación y la revocación de toda la familia requieren operaciones atómicas en el store. Así, un logout iniciado con un handle anterior invalida el ID activo aunque otra petición ya lo haya rotado. Las mutaciones autenticadas con cookie verifican Origin y `x-meeko-csrf`. Las respuestas SSR y API entregan el token CSRF por meta o cabecera same-origin. La aplicación debe definir verificación de identidad y reglas de autorización; Meeko no guarda secretos de autenticación en el navegador.

`MemorySessionStore` sirve sólo en desarrollo. `SessionManager({ production: true, store })` exige `persistent: true`, `replace` atómico y `revokeFamily`; el starter falla al arrancar en producción hasta que se configure un store persistente en `server/session.ts`. `RedisSessionStore` acepta un cliente compatible con `get`, `set` con `PX`, `del` y `eval`; usa un índice de familia con el TTL de la sesión activa. Use un prefijo propio por aplicación y entorno. Los registros Redis anteriores sin `familyId` siguen siendo legibles y adquieren una familia en la primera rotación. `SqlSessionStore` acepta un `SqlSessionDriver` con `read`, `write`, `remove`, `replace` transaccional, `revokeFamily` y `close` opcional. El ejemplo ejecutable en `tests/fixtures/fullstack-consumer/server/session.ts` usa SQLite real; el framework no depende de una librería SQL ni de un motor de base de datos concreto. `SessionManager.close()` libera el store cuando el host es propietario del recurso.

Todo `SessionStore` persistente personalizado debe almacenar `familyId` y garantizar que `replace` y `revokeFamily` sean atómicos frente a peticiones concurrentes. Antes de actualizar, migre los registros existentes y los índices necesarios para localizar la sesión activa por familia. No despliegue el nuevo runtime sobre un store antiguo: en producción la construcción falla de forma deliberada cuando no puede garantizar rotación y revocación familiar seguras.

**Migración de drivers SQL existentes:** añada una columna de familia a la tabla (por ejemplo, `family_id`), rellene las filas existentes con `family_id = id` y cree un índice único sobre ella. `read` y `write` deben transferir `SqlSessionRow.familyId`; `replace` debe comprobar la misma familia y sustituir la fila en una transacción; `revokeFamily(familyId)` debe borrar la fila activa por familia. Migre el esquema antes de iniciar la nueva versión. Un driver antiguo sin `revokeFamily` falla al construir `SqlSessionStore`; no se admite silenciosamente en producción.

Para Redis, instale `redis` en la aplicación, cree el cliente con `createClient({ url: process.env.REDIS_URL })`, llame `connect()` antes de servir tráfico y páselo a `RedisSessionStore` con un prefijo propio. El host debe cerrar su cliente con `quit()` al detenerse; `SessionManager.close()` cierra el store, pero no se apropia de clientes externos. La prueba de integración `tests/redis.integration.ts` usa un namespace aleatorio y sólo borra sus propias claves. Se ejecuta contra un Redis real con `MEEKO_REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx --test tests/redis.integration.ts`; CI dispone de un servicio Redis dedicado. La prueba local requiere un Redis accesible y no usa bases ajenas.

Un almacenamiento caído propaga error y no concede acceso. No se debe usar un store en memoria en producción. `Secure` requiere HTTPS en despliegue; configure el proxy y `PUBLIC_ORIGIN` acorde al origen público.

## Build, despliegue y verificación

```sh
npm run check   # manifiestos, tipos, componentes y proyectos TypeScript separados
npm run build   # cliente, servidor y prerender bajo .meeko/output/
npm start       # Node 24, con store persistente configurado
```

El starter sirve assets compilados y HTML SSR desde un proceso Node. Para un servicio público, sitúelo tras un proxy HTTPS, configure `PUBLIC_ORIGIN`, sesiones persistentes y cierre ordenado. La exportación OpenAPI es opcional mediante `generateOpenApi`; un schema que no pueda representarse produce error explícito.

El starter independiente creado con `meeko init` coordina el cierre de HTTP y Vite ante `SIGINT` y `SIGTERM`. El cierre es idempotente; si fallan ambos recursos conserva las dos causas y fija un código de salida fallido, sin dejar rechazos de promesas sin observar. El host de framework conserva del mismo modo el error original de arranque y comunica por el observador central cada fallo adicional al cerrar Socket, sesiones o Vite.

El adaptador Node entrega por separado varias cabeceras `Set-Cookie` y deja de transmitir el cuerpo si el cliente cierra la conexión. Una respuesta ya iniciada no puede sustituirse por un JSON de error; el adaptador cierra esa conexión y comunica el fallo al observador del host.

`pwsh -NoProfile -File tests/fullstack-consumer.ps1` instala un tarball local en un proyecto independiente, genera tipos, construye producción, arranca Node y prueba HTTP, dos sesiones, RPC/CSRF, WebSocket real y Chrome. También crea `meeko init-framework` desde ese paquete e instala, comprueba tipos y construye el starter generado. El fixture contiene páginas `/`, `/users`, `/users/[id]`, `/dashboard`, `/chat` y `/layer-demo`; sus aserciones TypeScript comprueban entradas y salidas válidas e inválidas de API, RPC, Socket, rutas y `ComponentProps` importado desde una página `.meeko` del paquete instalado.

Antes de preparar una publicación, ejecute `pnpm install --frozen-lockfile`, `pnpm run verify`, `pnpm run e2e`, `pnpm run pilot:e2e`, `pnpm run package:smoke`, la prueba Redis anterior, `pwsh -NoProfile -File tests/fullstack-consumer.ps1`, `pnpm pack` y `git diff --check`. La CI ejecuta estas familias de comprobaciones en Windows y Redis en Ubuntu. La existencia del workflow no sustituye una ejecución verde de CI. El workflow de publicación repite los gates y sólo responde a una etiqueta de versión; la decisión de crearla corresponde al mantenedor.

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

`pwsh -NoProfile -File tests/fullstack-consumer.ps1 -Benchmark` reproduce el consumidor externo, construye la aplicación mínima y escribe `.meeko/benchmarks/stability-baseline.json`. El baseline conservado está en `benchmarks/baseline-2026-10-24.json`. Cada tiempo usa siete muestras y dos calentamientos; el JSON contiene mediana, percentiles 10/90 y extremos. La compilación fría usa un worker nuevo por muestra; HMR mide una edición visible en Chrome con un servidor Vite nuevo por muestra. SSR y dispatchers se miden en proceso sobre el bundle de producción. Las mediciones de tamaño incluyen JS y CSS comprimidos con gzip. Son medidas de esta máquina, no umbrales de CI.

La entrada cliente generada registra `meeko-hydration` en el navegador. El benchmark actual mide navegación desde el clic de un enlace hasta que aparece la nueva ruta; el baseline histórico medía una llamada directa a `mountClientApp.navigate`. Por ese cambio de método, no compare las cifras de navegación entre ambas ejecuciones como si fueran una regresión del runtime. El JSON histórico permanece intacto.

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

Las entradas públicas soportadas de la versión actual son `@meekojs/meeko`, `/framework`, `/server`, `/vite` y `/devtools-ui`. `/internal` existe para el código generado por Meeko y no es contrato de consumo directo. La compilación se ofrece mediante la CLI y Vite; la raíz pública expone la reactividad y el runtime de SSR e hidratación, pero no una función `compile`. `defineMeekoConfig`, routing, `definePage`, `useState`, `createApiClient`, `createRpcClient`, `defineSocketChannel`, `attachNodeWebSocketServer`, `RedisSessionStore` y `SqlSessionStore` conservan sus nombres actuales. Los autoimports generados `api`, `rpc`, `socket` y `useSocket` dependen del manifiesto de cada aplicación.

Mientras la versión sea `0.x`, documente cada cambio incompatible y añada una entrada a `CHANGELOG.md` antes de aumentar minor; use patch para correcciones compatibles. En `1.x`, los cambios incompatibles requieren major. Una publicación requiere lockfile reproducible con el pnpm declarado, CI verde, consumidor externo y revisión del tarball. No se aumenta la versión automáticamente. Socket distribuido, adaptador edge y uso dinámico de configuración en el editor siguen siendo experimentales o no implementados.

## Límites actuales

- El adaptador de servidor publicado es Node 24; no hay adaptador edge.
- Redis tiene una prueba de integración con servidor real configurada en CI; su ejecución local depende de un servidor accesible. El adaptador SQL se probó con SQLite real. Redis Pub/Sub para Socket queda pendiente.
- Los canales Socket se descubren como archivos con nombre simple bajo `server/socket/`.
- Cambios en configuración o registro de autoimports fuerzan recarga completa en Vite. Las listas de configuración del editor deben ser estáticas.
- `server/session.ts` del starter requiere una implementación persistente antes de servir producción.
- La revocación por familia invalida el ID activo ante rotaciones concurrentes, pero las peticiones que ya pasaron autenticación pueden continuar ejecutándose. Si la aplicación requiere orden estricto entre operaciones en curso, debe coordinar esas operaciones. Meeko evita que una respuesta anterior restaure un token CSRF ya cambiado.
- Las rutas admiten SSR predeterminado o `render: "prerender"`. `render: "client"` no está implementado y se rechaza con un diagnóstico de tipos o un error explícito en runtime; no se ejecuta silenciosamente como SSR.
- Si falla el cambio de un outlet o la hidratación después de modificar el DOM durante una navegación cliente, Meeko solicita una carga completa de la última URL confirmada. La región puede verse parcialmente actualizada hasta que termine esa carga. No hay rollback transaccional ni conservación del estado local de los componentes en esta recuperación.
- Si la API de historial del navegador falla después de renderizar, Meeko solicita recargar la última URL confirmada y propaga el error original. Si también falla esa recuperación, conserva ambas causas en `AggregateError`.
