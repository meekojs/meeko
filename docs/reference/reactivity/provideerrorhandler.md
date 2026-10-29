---
title: provideErrorHandler
group: reactivity
since: 1.0.0
description: Registra el observador de los fallos del navegador de un componente y de toda su rama, con la fuente de cada fallo.
symbols:
  - "@meekojs/meeko#provideErrorHandler"
types:
  - "@meekojs/meeko#ComponentErrorHandler"
  - "@meekojs/meeko#ErrorSource"
related:
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/framework#mountClientApp"
  - docs/framework.md#errores
  - docs/framework.md#fallos-globales-del-navegador
---

En el navegador, muchos fallos ocurren fuera de cualquier `try`: un manejador `on:click` asíncrono que rechaza, un `onMounted` que lanza, una recarga de un componente que se monta tarde, un canal Socket que se cae. `provideErrorHandler(handler)` registra a quién se le entregan esos fallos: al componente que lo llama y a todos sus descendientes, salvo a los que registran su propio observador. `handler` recibe el error y su fuente (`ErrorSource`), para mostrar un aviso, enviarlo a un servicio de monitorización o ambas cosas.

Sin ningún observador, el fallo va al `onError` de `mountClientApp` o, si tampoco lo hay, a la consola. Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```html
<!-- app/app.meeko -->
<script lang="ts">
const failure = signal<string | null>(null);
provideErrorHandler((error, source) => {
  failure.value = error instanceof Error ? error.message : String(error);
  console.error(`[${source}]`, error);
});
</script>

<template>
  <p if:when="failure.value" role="alert">Algo falló: {failure.value}</p>
  <div class="site-root"><MeekoOutlet /></div>
</template>
```

Un manejador de cualquier página que rechaza deja el mensaje en el aviso, en lugar de un rechazo sin manejar.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `handler` | `(error: unknown, source: ErrorSource) => void` | obligatorio | Recibe cada fallo de la rama. `error` es `unknown`: compruébalo antes de leer sus propiedades. Un fallo dentro del propio `handler` se escribe en la consola junto al original. |

`source` dice dónde se observó el fallo:

| Fuente | Origen |
| --- | --- |
| `"event"` | Un manejador `on:` (síncrono o la promesa que devuelve), un aviso `onSuccess`/`onError` de una mutación o un error inesperado de `useForm`. |
| `"effect"` | Una promesa que un `effect` devolvió por error. |
| `"cleanup"` | Una promesa que una limpieza devolvió por error. |
| `"mounted"` | `onMounted`, la continuación tras un `await` de navegador o los datos de un componente que se monta tarde (desde `1.1`). |
| `"navigation"` | Una navegación del cliente que falla. |
| `"socket"` | Un cliente Socket sin `onError` propio. |
| `"uncaught"`, `"rejection"` | Desde `1.3`, en una aplicación montada: excepciones y promesas sin manejar del código que no pasa por Meeko (un `setTimeout`, una librería). |

## Valor devuelto

`void`. Sin un componente activo lanza `Error: provide() requires an active component root`, porque publica el observador con [`provide`](/docs/reference/provide).

## Ejemplos

### Un aviso por sección

Una rama puede tener su propio observador; los fallos de dentro ya no suben al de la aplicación.

```html
<!-- app/components/CheckoutPanel.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
const problem = signal("");
provideErrorHandler((error) => {
  problem.value = isClientError(error) ? "El servidor rechazó el pago." : "No se pudo conectar. Inténtalo de nuevo.";
});
</script>

<template>
  <section>
    <p if:when="problem.value" role="alert">{problem.value}</p>
    <render snippet="snippets.default" />
  </section>
</template>
```

### Enviar a un servicio de monitorización

```ts
// app/composables/report.ts
import type { ComponentErrorHandler } from "@meekojs/meeko";

export const reportError: ComponentErrorHandler = (error, source) => {
  const message = error instanceof Error ? error.message : String(error);
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, source, path: location.pathname }),
    keepalive: true,
  });
};
```

```html
<script lang="ts">
provideErrorHandler(reportError);
</script>
```

### Un `switch` sobre la fuente

`ErrorSource` puede ganar miembros en una versión menor: un `switch` necesita rama por defecto.

```ts
import type { ErrorSource } from "@meekojs/meeko";

function label(source: ErrorSource): string {
  switch (source) {
    case "navigation": return "No se pudo abrir la página";
    case "socket": return "Conexión perdida";
    default: return "Algo falló";
  }
}
```

## Errores comunes

### Leer `error.message` sin comprobar el tipo

```ts bad
provideErrorHandler((error) => console.log(error.message));
```

`meeko check` da `TS18046: 'error' is of type 'unknown'`: se puede lanzar cualquier valor, no sólo un `Error`.

<!-- no-check -->
```ts good
provideErrorHandler((error) => console.log(error instanceof Error ? error.message : String(error)));
```

### Esperar que capture los fallos del render

El observador recibe lo que falla **después** de montar: eventos, `onMounted`, navegación, Socket. Un error que lanza el script o la plantilla durante el render o la hidratación hace fallar ese render, y lo muestra la página de error.

```html bad
<script lang="ts">
const props = defineProps<{ items: { name: string }[] }>();
provideErrorHandler(() => { /* no se llama */ });
const first = props.items[0]!.name; // con una lista vacía: TypeError en el render
</script>
```

Para un dato que puede faltar, contrólalo en el script; para una página que puede fallar, usa `+error.meeko` o `app/error.meeko`:

<!-- no-check -->
```ts good
const first = computed(() => props.items[0]?.name ?? "Sin elementos");
```

### Llamarlo fuera de un componente

```ts bad
// app/utils/errors.ts, evaluado al importar
provideErrorHandler(reportError);
```

Lanza `Error: provide() requires an active component root`. Llámalo en el script de un componente (para toda la aplicación, `app/app.meeko`), o usa `onError` de `mountClientApp` en un host propio.

```html good
<!-- app/app.meeko -->
<script lang="ts">
provideErrorHandler(reportError);
</script>
```

## Notas

- **Sólo navegador.** En SSR no hay eventos ni montaje: un fallo del render del servidor responde con la página de error y llega al observador del servidor, no a éste.
- **El más cercano.** Gana el observador del ancestro más cercano. Un componente sin observador en su rama entrega sus fallos sólo al `onError` de la aplicación o a la consola, nunca al observador de otra rama.
- **Errores esperados.** Un `ClientError` (una respuesta prevista del servidor, como un `409`) también llega aquí si nadie lo captura; `useForm` lo trata él mismo y sólo entrega los fallos inesperados.
- **Sin repetirlos.** Un fallo que ya recibió un observador de Meeko no se vuelve a informar si escapa a `window`.
- **Seguridad.** El `error` puede contener datos de la respuesta o del usuario: no lo pintes con `html`, y filtra lo que envías a un servicio externo.
