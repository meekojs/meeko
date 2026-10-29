---
title: createNavigator
group: advanced
since: 1.0.0
description: Navegador de cliente de bajo nivel para un host propio, que resuelve rutas, actualiza el historial y atiende popstate, y delega el render en un callback.
symbols:
  - "@meekojs/meeko/framework#createNavigator"
types:
  - "@meekojs/meeko/framework#Navigator"
  - "@meekojs/meeko/framework#NavigationContext"
related:
  - "@meekojs/meeko/framework#mountClientApp"
  - "@meekojs/meeko/framework#matchRoute"
  - "@meekojs/meeko/framework#createRouteManifest"
  - "@meekojs/meeko/framework#useNavigation"
  - docs/framework.md#estado-de-navegación
---

`createNavigator` es la pieza de historial que usa [`mountClientApp`](/docs/reference/mountclientapp), sin nada más: resuelve la URL de destino con el manifiesto de rutas, llama a tu callback de render con la ruta, sus parámetros, un `AbortSignal` y cuántos layouts se conservan, y, si el render termina bien, actualiza el historial. También atiende `popstate` (atrás y adelante). No intercepta enlaces, no pide datos ni hidrata: el host decide cómo pintar.

Sirve para integrar el enrutado de Meeko en una aplicación que pinta sus páginas de otra forma (fragmentos HTML del servidor, otro framework) o para pruebas del enrutado.

## Uso

```ts
import { createNavigator, createRouteManifest } from "@meekojs/meeko/framework";

const routes = createRouteManifest([
  { id: "/", file: "app/pages/index.meeko", layouts: [] },
  { id: "/users/[id]", file: "app/pages/users/[id].meeko", layouts: [] },
]);

const navigator = createNavigator(routes, async ({ match, signal }) => {
  const html = await (await fetch(`/fragments${match.route.id}?id=${match.params.id ?? ""}`, { signal })).text();
  if (signal.aborted) return false;
  document.querySelector("#outlet")!.innerHTML = html;
}, window, (error) => console.error("navegación fallida", error));

await navigator.navigate("/users/42");
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `routes` | `RouteRecord[]` | obligatorio | Manifiesto de rutas, idealmente creado con `createRouteManifest`. |
| `render` | `(context) => void \| boolean \| Promise<…>` | obligatorio | Pinta cada navegación. Devolver `false` la cancela y el historial no cambia. |
| `browser` | `Window` | `window` | La ventana cuyo `history` y `location` se usan. |
| `onError` | `(error) => void` | consola | Fallos de las navegaciones por historial (atrás y adelante), que no tienen a quién rechazar. |

El callback recibe un `NavigationContext`: `url` (la URL de destino), `match` (`{ route, params }`), `signal` (se aborta si otra navegación sustituye a ésta) y `retainedLayouts` (la longitud del prefijo de layouts común con la ruta anterior, que el host puede conservar).

## Valor devuelto

Un `Navigator`:

| Miembro | Descripción |
| --- | --- |
| `navigate(to, { replace? })` | Navega a `to` en el mismo origen. Resuelve `true` si navegó, `false` si la URL no tiene ruta o se canceló, y rechaza si el render falla o la URL es de otro origen. Con `replace`, sustituye la entrada del historial. |
| `dispose()` | Deja de escuchar `popstate`. |

## Ejemplos

### Conservar los layouts comunes

<!-- no-check -->
```ts
const mounted: Array<{ dispose(): void }> = [];
const navigator = createNavigator(routes, async ({ match, retainedLayouts }) => {
  // Libera los layouts que salen; los primeros `retainedLayouts` siguen en pantalla.
  for (const layout of mounted.splice(retainedLayouts)) layout.dispose();
  for (const file of match.route.layouts.slice(retainedLayouts)) mounted.push(await mountLayout(file));
  await renderPage(match.route.file, match.params);
});
```

### Interceptar los enlaces tú mismo

<!-- no-check -->
```ts
document.addEventListener("click", (event) => {
  const anchor = (event.target as Element).closest("a");
  if (!anchor || anchor.origin !== location.origin || event.metaKey || event.ctrlKey) return;
  event.preventDefault();
  void navigator.navigate(anchor.href).then((navigated) => { if (!navigated) location.assign(anchor.href); });
});
```

`createNavigator` no escucha clics: una URL sin ruta (`navigate` resuelve `false`) se deja al navegador.

## Errores comunes

### Navegar a otro origen

```ts bad
await navigator.navigate("https://otro.example/users/42");
```

Rechaza con `TypeError: External navigation is not a Meeko route`: `createNavigator` sólo cambia la URL dentro del mismo origen, como `history.pushState`. Un enlace externo es una navegación del navegador. Después de `dispose()`, `navigate` rechaza con `Navigator disposed`.

<!-- no-check -->
```ts good
location.assign("https://otro.example/users/42");
```

### Ignorar el `signal` en un render lento

```ts bad
createNavigator(routes, async ({ match }) => {
  const html = await (await fetch(`/fragments${match.route.id}`)).text();
  document.querySelector("#outlet")!.innerHTML = html;
});
```

Si el usuario hace clic en dos enlaces seguidos, la respuesta lenta de la primera navegación puede llegar después y pintar encima de la segunda.

<!-- no-check -->
```ts good
createNavigator(routes, async ({ match, signal }) => {
  const html = await (await fetch(`/fragments${match.route.id}`, { signal })).text();
  if (signal.aborted) return false;
  document.querySelector("#outlet")!.innerHTML = html;
});
```

### Esperar que hidrate o pida datos

```ts bad
createNavigator(routes, () => {});
```

El historial cambia, pero la página no: el callback es el único que pinta. Para la navegación completa de Meeko (datos, layouts, hidratación, middleware), usa `mountClientApp`.

<!-- no-check -->
```ts good
const app = await mountClientApp({ root, payload, routes, loadPage, serverData: true });
```

## Notas

- **Sólo en el navegador.** Usa `window.history` y `popstate`.
- **Transaccional.** El historial sólo cambia cuando el render termina bien; si falla, `navigate` rechaza y la URL sigue siendo la anterior.
- **Fragmentos.** Una URL que sólo cambia el `#fragmento` de la página actual no llama a `render`: añade la entrada al historial y desplaza la página hasta el ancla.
- **Rutas.** La resolución es la de [`matchRoute`](/docs/reference/matchroute): estáticas antes que dinámicas, segmentos decodificados y rechazados si contienen `/`, `\`, `.` o `..`.
- **Limpieza.** Llama a `dispose()` al desmontar el host; si no, el listener de `popstate` sigue activo.
