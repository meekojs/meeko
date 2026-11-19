# Datos y renderizado

Cada página elige **dónde obtiene sus datos** y **cuándo se genera el HTML**. Esta guía resume las decisiones habituales. Los contratos, límites y casos especiales están en [detalles técnicos](routing-data-reference.md).

## Página de error de la aplicación (`app/error.meeko`)

Usa `app/error.meeko` para el `404` de una URL sin página y como respaldo cuando una página falla. Un `+error.meeko` más cercano tiene prioridad. Ambas reciben `status` y `message`. [Ver los casos especiales](routing-data-reference.md#página-de-error-de-la-aplicación-apperrormeeko).

## Código de servidor de la página

En `<script server lang="ts">` puedes cargar datos antes de renderizar. Se ejecuta en el servidor por petición; sólo los valores exportados llegan al componente. Para un ejemplo completo, sigue el [tutorial del router](router.md#2-validar-y-cargar-los-datos).

### Código de nivel superior y datos exportados

Es la forma directa: lee `usePage()`, carga los datos y expórtalos. `redirect()` y `notFound()` detienen la petición cuando corresponda.

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
	const { params } = usePage()
	export const user = { id: params.id }
</script>
<template><h1>Usuario {user.id}</h1></template>
```

[Ver ejecución, serialización y errores](routing-data-reference.md#código-de-nivel-superior-y-datos-exportados).

### Opciones de ruta con `definePage`

`definePage({ load })` es una alternativa: entrega el resultado como `props.data`. Elige **`load` o código de nivel superior** para los datos de una página; no los combines. Puedes colocar las opciones en un sidecar `*.route.ts`. [Ver opciones y contratos](routing-data-reference.md#opciones-de-ruta-con-definepage).

### Reglas comunes

El bloque de servidor y el `<script>` del componente tienen ámbitos distintos. El servidor puede importar `server/`; los datos que exporta deben poder serializarse para llegar al navegador. `meeko check` comprueba el contrato de la página. [Ver restricciones y diagnósticos](routing-data-reference.md#reglas-comunes).

### Dónde se usa cada API

`usePage()`, `redirect()` y `notFound()` pertenecen al código de servidor de una página en curso. Las APIs del componente se usan en su `<script>` y plantilla. [Ver la tabla completa](routing-data-reference.md#dónde-se-usa-cada-api).

## Modos de render

| `render`               | Cuándo se genera el contenido                             | Úsalo cuando                                           |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `ssr` (predeterminado) | En el servidor, por petición.                             | Necesitas datos actuales y HTML inicial.               |
| `stream`               | En el servidor; puede enviar valores secundarios después. | Una parte lenta no debe retrasar la primera respuesta. |
| `prerender`            | Durante el build.                                         | Las páginas pueden generarse antes de recibir visitas. |
| `client`               | En el navegador.                                          | La página puede arrancar sin HTML de sus datos.        |

En `client`, el loader viaja al navegador y no puede usar secretos ni servicios de servidor. [Ver modos, prerender y límites](routing-data-reference.md#modos-de-render).

## Streaming SSR (`render: "stream"`)

Usa `defer()` para datos secundarios que pueden llegar después del HTML inicial. Mantén en los datos críticos lo que decide redirecciones, cabeceras o contenido que debe indexarse. Un proxy que almacena toda la respuesta puede anular la ventaja del streaming. [Ver protocolo, cancelación y proxies](routing-data-reference.md#streaming-ssr-render-stream).

## Caché de páginas SSR

`definePage({ cache })` permite revalidar páginas públicas con `etag` y, si conviene, guardar el render en memoria. Sólo se aplica a respuestas aptas para caché; las peticiones con sesión o `Authorization` no reutilizan esa copia. Si el HTML depende de cookies propias, inclúyelas en la versión o evita la caché. [Ver opciones y exclusiones](routing-data-reference.md#caché-de-páginas-ssr).
