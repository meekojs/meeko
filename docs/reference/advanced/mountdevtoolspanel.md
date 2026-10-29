---
title: mountDevtoolsPanel
group: advanced
since: 1.0.0
description: Monta en la página el panel de Meeko DevTools, aislado en Shadow DOM, con el árbol de instancias, las señales editables, la línea de tiempo y los puntos de parada.
symbols:
  - "@meekojs/meeko/devtools-ui#mountDevtoolsPanel"
types:
  - "@meekojs/meeko/devtools-ui#DevtoolsPanelOptions"
  - "@meekojs/meeko/devtools-ui#DevtoolsPanel"
related:
  - "@meekojs/meeko/vite#meeko"
  - "@meekojs/meeko/framework#definePlugin"
  - docs/devtools.md#panel-dentro-de-la-página
  - docs/devtools.md#editar-señales
  - docs/devtools.md#alcance-y-límites
---

`mountDevtoolsPanel` añade a la página el panel de Meeko DevTools: un árbol con las instancias de componentes vivas, el detalle de sus props y señales (con un editor para cambiarlas), una línea de tiempo filtrable de lecturas y escrituras con su archivo y su línea, el resaltado del elemento de cada instancia en la página y un punto de parada por instancia. Vive en un Shadow DOM, así que no hereda ni altera los estilos de la aplicación.

Lee el hook `window.__MEEKO_DEVTOOLS__`, que instala el código de desarrollo de los componentes al hidratarse con Vite en desarrollo. Si todavía no existe, el panel lo dice y se conecta solo en cuanto aparece.

## Uso

<!-- no-check -->
```ts
// app/plugins/devtools.client.ts
import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin(async () => {
  if (!import.meta.env.DEV) return;
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
});
```

El plugin `.client.ts` se ejecuta sólo en el navegador, antes de hidratar; el panel se conecta al hook cuando el primer componente se hidrata. Con `import()` dinámico dentro de `import.meta.env.DEV`, el panel no entra en el bundle de producción.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `container` | `Element` | `document.body` | Elemento que recibe el host del Shadow DOM. El panel se coloca fijo en la esquina inferior derecha. |

## Valor devuelto

Un `DevtoolsPanel`:

| Miembro | Descripción |
| --- | --- |
| `refresh()` | Vuelve a buscar el hook y actualiza los datos. Es lo que hace el botón «Actualizar». |
| `unmount()` | Quita el panel y libera sus suscripciones, sus eventos y el resaltado. El botón de cerrar hace lo mismo. |

Lanza `Error: Meeko DevTools requires a browser document` si el contenedor no pertenece a un documento con ventana.

## Ejemplos

### En un host de Vite propio

<!-- no-check -->
```ts
// src/entry-client.ts
import { hydrate } from "./App.meeko";

hydrate(document.getElementById("app")!, props, state);

if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  const panel = mountDevtoolsPanel();
  import.meta.hot?.dispose(() => panel.unmount());
}
```

`import.meta.hot.dispose` quita el panel antes de que HMR vuelva a ejecutar la entrada, para no acumular paneles.

### En un contenedor propio

<!-- no-check -->
```ts
const panel = mountDevtoolsPanel({ container: document.querySelector("#devtools") ?? document.body });
```

### Mostrarlo con un atajo de teclado

<!-- no-check -->
```ts
let panel: { unmount(): void } | undefined;
window.addEventListener("keydown", async (event) => {
  if (!(event.ctrlKey && event.shiftKey && event.key === "M")) return;
  if (panel) { panel.unmount(); panel = undefined; return; }
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  panel = mountDevtoolsPanel();
});
```

## Errores comunes

### Montarlo en producción

```ts bad
import { mountDevtoolsPanel } from "@meekojs/meeko/devtools-ui";
mountDevtoolsPanel();
```

En producción el compilador no instala el hook: el panel sólo muestra `Hook no disponible. Abre una página Meeko con Vite en desarrollo y pulsa Actualizar.`, y el import estático mete su código en el bundle de producción.

<!-- no-check -->
```ts good
if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
}
```

### Llamarlo en el servidor

```ts bad
// app/plugins/devtools.ts (sin .client), que también se ejecuta en el SSR
export default definePlugin(async () => {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
});
```

En el servidor no hay `document`: la llamada lanza `ReferenceError: document is not defined` y la petición falla.

<!-- no-check -->
```ts good
// app/plugins/devtools.client.ts
export default definePlugin(async () => {
  if (!import.meta.env.DEV) return;
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
});
```

### Montarlo dos veces con HMR

```ts bad
// src/entry-client.ts
if (import.meta.env.DEV) mountDevtoolsPanel();
```

Cada vez que HMR vuelve a ejecutar la entrada se añade otro panel encima del anterior.

<!-- no-check -->
```ts good
if (import.meta.env.DEV) {
  const panel = mountDevtoolsPanel();
  import.meta.hot?.dispose(() => panel.unmount());
}
```

## Notas

- **Sólo en desarrollo.** El hook existe sólo con los componentes compilados por Vite en modo desarrollo; `meeko build` no lo incluye.
- **Versión.** El panel comprueba la versión del protocolo del hook: con otro `@meekojs/meeko` en la página, muestra `Versión de protocolo DevTools no compatible` y pide usar el mismo paquete para el panel y la aplicación.
- **Seguridad.** El panel puede leer y cambiar las señales de la página: no lo montes donde lo vea un usuario final.
- **Estilos.** El panel está aislado en su Shadow DOM, con `all: initial` en su host y su propio esquema de color oscuro, y se dibuja por encima de todo (`z-index` máximo). Cada llamada crea un panel nuevo: no hay comprobación de uno ya montado.
- **Chrome.** La extensión Meeko DevTools ofrece el mismo panel dentro de Chrome DevTools, sin tocar el código de la aplicación.
