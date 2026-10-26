# Actualizar de 1.0 a 1.1

`1.1` es un minor: el código escrito para `1.0` sigue funcionando y lo nuevo (etiquetas de componente, eventos, modelos, snippets, refs, `<script server>`, composables de datos, componentes genéricos…) es opcional. Aun así, algunos cambios se notan al actualizar. Esta guía los reúne con lo que conviene revisar en cada uno. La lista completa, con lo añadido y corregido, está en el [CHANGELOG](../CHANGELOG.md); los compromisos de compatibilidad, en la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualice `@meekojs/meeko` a la versión exacta `1.1.0` y vuelva a compilar o construir: el código generado y el runtime deben tener la misma versión. Si usa la extensión de VS Code o Meeko DevTools, actualícelas también.
2. Ejecute `meeko check`. Los errores nuevos más probables son props sobrantes en componentes (véase [Props de componente más estrictas](#props-de-componente-más-estrictas)) y nombres reservados en la plantilla.
3. Revise el código del nivel superior del setup de las páginas y los layouts con datos o con componentes dinámicos (véase [Render previo de la navegación](#render-previo-de-la-navegación)).
4. Sustituya el import de `useSocket` desde `@meekojs/meeko/framework` por `useSocketClient`. Si tiene un cliente WebSocket o un adaptador de Socket propios, revise los nuevos cierres del handshake (véase [Socket: cierres `4401` y `4403` en el handshake](#socket-cierres-4401-y-4403-en-el-handshake)).
5. Si alguna herramienta lee la salida de la CLI o de `meeko check`, haga que use los códigos y no el texto de los mensajes.

## Comprobación de tipos

### Props de componente más estrictas

`meeko check` y el editor comprueban las props de cada etiqueta (`<Etiqueta>` o `<component is>`) sólo contra las que declara el hijo:

- Una prop desconocida es un error aunque haya otras válidas en la misma etiqueta. En `1.0` pasaba la comprobación y en ejecución se ignoraba.
- `bind:variant="'secondary'"` conserva su tipo literal frente a una unión (`"primary" | "secondary"`) en lugar de ensancharse a `string`.
- Una prop obligatoria que falta se señala en la etiqueta, con `TS2345` en lugar de `TS2769`.

Una prop sobrante no fallaba en ejecución, así que este cambio es una [excepción aprobada](stability.md#excepciones-aprobadas) a la política de estabilidad. Para corregirlo, borre la prop o declárela en el `defineProps` del hijo:

```html
<!-- Antes: "size" no existe en las props de Card y 1.0 lo aceptaba -->
<component is="Card" bind:title="title" bind:size="'lg'"></component>

<!-- Después -->
<component is="Card" bind:title="title"></component>
```

Si una herramienta filtraba los diagnósticos por `TS2769`, añada `TS2345`.

### `meeko check` comprueba los `.ts` importados con sus autoimports

Los `.ts` que importa un `.meeko` se comprueban con los autoimports de su ámbito y con las rutas generadas, como en los proyectos `tsconfig.*` de `.meeko/`. Puede ver errores nuevos que el editor ya mostraba, por ejemplo `href("/ruta-inexistente")`. Los `TS2304` falsos de composables, stores o utilidades autoimportados en esos archivos desaparecen.

### `ErrorSource` incluye `"mounted"`

Los fallos de un callback de `onMounted` y de la continuación en el navegador de un setup con `await` llegan a `provideErrorHandler` y al `onError` de la aplicación con la fuente `"mounted"`. Un `switch` exhaustivo sobre `ErrorSource` sin rama `default` deja de compilar: añada la rama `"mounted"` o una por defecto.

## Plantilla

### `ref`, `model` y `html` son directivas

- `ref:nombre` es una directiva. `ref="x"` y `bind:ref` se comportan como en `1.0`.
- En un elemento personalizado (etiqueta con guion, como `<x-markdown html="intro">` o `<my-input model="query">`), `html` y `model` siguen siendo atributos HTML literales, como en `1.0`: no hace falta cambiar nada. Lo que sigue se aplica a los elementos HTML estándar, donde `html` y `model` no son atributos válidos.
- `model="..."` en un elemento ya no escribe el atributo HTML `model`: enlaza una señal con un control de formulario (véase [Controles de formulario con `model`](api.md#controles-de-formulario-con-model)). En un elemento que no lo admite da `MEEK065`.
- `html="..."` en un elemento ya no escribe el atributo HTML `html`: inserta el valor como HTML sin escapar (véase [HTML sin escapar con `html`](api.md#html-sin-escapar-con-html)). En un elemento que no lo admite da `MEEK095`.

Si necesita el atributo literal, escríbalo con `bind:model` o `bind:html`, que siguen escribiendo el atributo:

```html
<!-- Antes: atributo HTML model="draft" -->
<div model="draft"></div>

<!-- Después -->
<div bind:model="'draft'"></div>
```

En una etiqueta de componente, `is`, `ref` y `html` no son props estáticas (`MEEK032`).

### Diagnósticos retirados

`MEEK005` (falta `<script lang="ts">`), `MEEK023` (falta `each:key`) y `MEEK049` (contenido dentro de una etiqueta de componente) dejan de emitirse porque ese código pasa a ser válido. Una herramienta que los esperara no los recibirá.

## Ciclo de vida y navegación

### Render previo de la navegación

Antes de confirmar una navegación, el navegador renderiza la página nueva sin mostrarla para cargar sus `await` de datos, con `useNavigation().pending` en `true`. Esa pasada es en seco: no ejecuta `effect`, `onMounted` ni la continuación de navegador, y `useSocket` no conecta.

Lo que sí se ejecuta otra vez es el **código del nivel superior del setup** de la página y de los layouts nuevos, con un estado provisional que se descarta. Así, en las páginas cuyo árbol tiene un `await` de datos o un componente elegido en tiempo de ejecución (`<component is>` con una variable, un elemento de `each:` o un parámetro de snippet), ese código se ejecuta dos veces por navegación. Si el árbol no puede esperar datos, la pasada se salta y el setup se ejecuta una sola vez, como en `1.0`.

Revise el nivel superior del setup de esas páginas y layouts: una petición con `api.*`, una escritura en un almacén externo o un contador que se incrementa ahí se repiten. Llévelos a `onMounted`, a un handler o a un `effect`:

```html
<script lang="ts">
// Antes: se ejecuta también en el render previo de cada navegación
void api.analytics.post({ body: { page: "users" } });

// Después: sólo en el navegador, una vez montada la página
onMounted(() => {
  void api.analytics.post({ body: { page: "users" } });
});
</script>
```

Véase [Navegación y `render: "client"`](framework.md#navegación-y-render-client).

### Orden de `onMounted`

`onMounted` es nuevo en `1.1`. Si sustituye con él un `effect` o un `queueMicrotask` que esperaba al DOM, tenga en cuenta su orden: los callbacks se ejecutan al final de la hidratación o del montaje en curso, cuando ya existen los hermanos posteriores y los bindings del padre, y los hijos ejecutan el suyo antes que el padre. Nunca se ejecuta en SSR ni en el render previo de la navegación. Véase [Ciclo de vida](api.md#ciclo-de-vida).

### Páginas de error al navegar y título `Error`

- Una navegación cliente cuya petición de datos responde `404` (por `notFound()` o por un `ApiError` `404` del loader) muestra el `+error.meeko` más cercano, o `app/error.meeko`, con `{ status: 404, message }`, como el documento SSR. En `1.0` la navegación fallaba con un error.
- Las páginas de error se titulan `Error` en SSR y al navegar, incluida la `404` de `app/error.meeko` para una URL sin ruta. Si una prueba esperaba otro `document.title` en esas páginas, actualícela.
- Al navegar a una página sin `title`, `document.title` vuelve al título del host, o a ninguno, como en SSR; antes conservaba el de la página anterior.
- Una navegación nueva empieza arriba o en el elemento de su fragmento; antes conservaba el scroll de la página anterior. Un enlace a un fragmento de la página actual ya no vuelve a renderizar la página.

### Páginas de capas y módulos dentro del shell del proyecto

`app/app.meeko` y el layout raíz del proyecto envuelven ahora las páginas de `extends` y `modules`, y los `+layout.meeko` de la capa se anidan dentro. Si el proyecto tiene `app.meeko` o layout raíz, sustituyen a los de la capa. Antes esas páginas se renderizaban sueltas en `#app`. Revise el aspecto de las páginas de capas si su layout raíz asumía que no las envolvía.

## Framework y CLI

### `useSocket` de `@meekojs/meeko/framework` pasa a `useSocketClient`

`useSocket(url, contract, options)` de `@meekojs/meeko/framework` está deprecado y se retirará en `2.0`. Es la misma función que `useSocketClient`, con la misma firma y los mismos tipos, así que basta con cambiar el import:

```ts
// Antes
import { useSocket } from "@meekojs/meeko/framework";
const chat = useSocket("wss://example.com/_meeko/socket/chat", chatContract);

// Después
import { useSocketClient } from "@meekojs/meeko/framework";
const chat = useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
```

El editor tacha los usos del alias. El autoimport `useSocket("canal", opciones)` de los clientes generados no cambia ni está deprecado.

### Socket: cierres `4401` y `4403` en el handshake

En `1.0`, un handshake de Socket sin sesión en un canal `auth: "required"` recibía `401` por HTTP, y uno que `authorize` rechazaba recibía `403`, sin upgrade. El `WebSocket` del navegador no expone ese estado, así que el cliente lo veía como un fallo de red y reintentaba sin fin. Desde `1.1`, los adaptadores de Node, Bun, Deno y Cloudflare completan el upgrade y cierran en seguida con `4401` («Autenticación requerida») o `4403` («Acceso denegado»), sin llamar a ningún handler ni entregar mensajes. El cliente de Meeko pasa entonces al estado terminal `"unauthorized"`. Un hub que vuelve a autorizar una conexión ya aceptada, como el Durable Object de una sala al despertar, también cierra con `4401` o `4403`, y ya no con `1008` («Unauthorized»).

Los demás rechazos no cambian: Origin no permitido (`403` `INVALID_ORIGIN`), canal inexistente (`404`), nombre o petición inválidos (`400`) y límites siguen respondiendo por HTTP.

Qué revisar:

- **Cliente WebSocket propio** (otra librería, una app nativa o pruebas que esperaban `401`/`403` en el handshake, por ejemplo con el evento `unexpected-response` de `ws`): el handshake ahora se abre y se cierra en seguida. Trate los cierres `4401` y `4403` como un rechazo definitivo y no reintente.
- **Adaptador propio sobre `createSocketUpgradeHandler`**: sigue funcionando sin cambios y responde `status` por HTTP, como en `1.0`. Para dar el comportamiento nuevo, atienda el campo `close` de la acción `reject`: haga el upgrade y cierre con `close.code` y `close.reason` sin llamar a `open`.

```ts
const upgrade = await handleUpgrade(request);
if (upgrade.action === "pass") return app.fetch(request);
if (upgrade.action === "reject" && !upgrade.close) return new Response(null, { status: upgrade.status });
const { socket, response } = Deno.upgradeWebSocket(request);
socket.onopen = () => {
  // Deno corta la conexión sin el frame de cierre si lee un mensaje mientras cierra: se cierra tras un tick.
  if (upgrade.action === "reject") { setTimeout(() => socket.close(upgrade.close?.code, upgrade.close?.reason), 0); return; }
  const session = upgrade.open({ send: (message) => socket.send(message), close: (code, reason) => socket.close(code, reason) });
  socket.onmessage = (event) => session.receive(event.data);
  socket.onclose = () => session.closed();
};
return response;
```

- **`createNodeSocketUpgradeHandler` con `reject` propio**: esos dos rechazos ya no llegan a `reject`, sino a `upgrade`, seguido del cierre. El Origin no permitido y los demás rechazos siguen llegando a `reject`.

### Mensajes en español

Los textos de la CLI (ayuda, éxito, errores y salida de `meeko clean`), los diagnósticos de Meeko del compilador, de `meeko check` y del framework, y los hovers, logs y diagnósticos propios del servidor de lenguaje están en español. Los códigos (`MEEK0xx`, `MEEK1xx`, `MEEK_*`) no cambian. Una herramienta que lea la salida debe usar el código y no el texto, que no forma parte del contrato.

Un comando o una opción desconocidos de la CLI indican ahora el problema (`Comando desconocido: …`, `Opción desconocida para dev: --port`) antes del uso, que sigue saliendo por `stderr` con código `1`.

### `meeko dev` registra archivos nuevos sin reiniciar

Crear o borrar páginas, layouts, `app/app.meeko`, `app/error.meeko`, middlewares o módulos de `server/api`, `server/rpc` y `server/socket` vuelve a descubrir las rutas y crea de nuevo la aplicación. Al recrearla se cierran las conexiones Socket y se vuelve a llamar a `server/runtime.ts`, así que se pierden las sesiones de un almacén en memoria.

### Salidas de build

- `meeko build` ya no copia `public/` en la raíz de la salida de servidor (`.meeko/output/node/`, Bun y Deno), donde nadie lo servía: sólo está en `client/`. Si un script de despliegue leía esos archivos de la raíz, léalos de `client/`.
- El documento SSR y el prerenderizado incluyen en `<head>` el CSS de cada componente que renderizan, no sólo el de la página y sus layouts.
