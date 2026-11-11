# Navegación

Meeko enlaza páginas con URLs reales, conserva los layouts compartidos y actualiza el estado de ruta al confirmar la navegación. Para el anidamiento visual, consulta [Layouts](routing-layouts.md).

## `<MeekoOutlet />` y `<MeekoLink>`

`<MeekoOutlet />` muestra el siguiente layout o la página. Para una URL conocida, usa el `<a>` nativo: Meeko también navega sin recargar al pulsar un enlace interno del mismo origen.

`<MeekoLink>` es opcional. Úsalo cuando quieras construir la URL desde un ID de ruta tipado, pasar parámetros o marcar automáticamente la página activa:

```html
<MeekoLink to="/users/[id]" bind:params="{ id: '42' }" match="prefix">Usuario</MeekoLink>
```

Ambos renderizan un `<a>` y comparten la misma navegación. `to` es el ID de ruta; `params` rellena sus segmentos. `match="prefix"` también marca una sección activa con `aria-current`. La query se pasa con `bind:search`. Si usas `@meekojs/ui`, `<UILink href="/ruta">` da estilo a un enlace normal y `<UILink to="/ruta">` usa la ruta tipada de Meeko. [Ver props y resolvedores de enlaces](routing-navigation-reference.md#meekooutlet--y-meekolink).

## Enlaces, anclas y scroll

Un `<a href>` interno normal también puede navegar sin recargar. Los clics modificados, descargas y enlaces externos siguen el comportamiento del navegador. Cambiar sólo el fragmento no vuelve a cargar los datos; atrás y adelante restauran el scroll. [Ver reglas completas](routing-navigation-reference.md#enlaces-anclas-y-scroll).

## View Transitions nativas

Configura `viewTransitions: true` en `meeko.config.ts` para animar cambios de página en navegadores compatibles. Puedes desactivar una navegación concreta con `data-meeko-view-transition="false"` en un enlace. La preferencia de movimiento reducido tiene prioridad. [Ver CSS y límites del navegador](routing-navigation-reference.md#view-transitions-nativas).

## Estado de navegación

`useNavigation().pending` indica que se está cargando la próxima página. En SSR vale `false`. Para navegar desde un host propio usa `app.navigate()`; `useNavigation()` sólo expone el estado. [Ver cuándo cambia](routing-navigation-reference.md#estado-de-navegación).

## Ruta actual

`useRoute()` ofrece señales `url`, `path`, `id`, `params` y `search`, además de `isActive()`. Representa la ruta **confirmada**; mientras hay una navegación pendiente conserva la anterior. Pide el composable en el script del componente y usa su resultado en los eventos. [Ver tipos, SSR e hidratación](routing-navigation-reference.md#ruta-actual).
