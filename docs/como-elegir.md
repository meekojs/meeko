# Cómo elegir en Meeko

Esta guía conecta las capacidades existentes. Empieza con la [primera aplicación](primeros-pasos.md) si aún no tienes un proyecto y usa la [referencia](/docs/reference) para los contratos y opciones de cada API.

## Página y código de servidor

| Necesitas                                           | Empieza por                                                 | Usa la otra forma cuando                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Declarar la ruta junto a su página                  | `export const route = definePage(...)` en `<script server>` | Un sidecar `*.route.ts` mantiene separada la lógica de servidor extensa.                            |
| Compartir opciones entre un grupo de páginas        | `+group.ts` con `defineGroup`                               | Cada página necesita sus propias opciones o datos.                                                  |
| Ejecutar código durante SSR dentro de un componente | `<script>`                                                  | El código es exclusivo de la petición y debe ir en `<script server>` de una página o en un sidecar. |

`<script server>` y `*.route.ts` son dos ubicaciones para el mismo contrato de ruta. Elige **una por página**: si declaras ambas, el descubrimiento informa un conflicto. El bloque de servidor está limitado a páginas de `app/pages`; `render: "client"` cambia su entorno de ejecución y lo envía al navegador. Antes de usar secretos, revisa el [límite de ejecución](reference/syntax/script-server.md) y los [modos de render](framework.md#modos-de-render).

## Datos y carga

| Necesitas                                                   | Empieza por                                                            | Qué ocurre                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Datos imprescindibles en el HTML inicial                    | Loader de `definePage` o código de nivel superior en `<script server>` | La página espera los datos antes de renderizar.                            |
| Datos de un componente disponibles en SSR                   | `await useApi(...)` o `await useRpcQuery(...)`                         | La consulta participa en el render inicial.                                |
| Datos secundarios después del primer pintado                | `useApi(...)` o `useRpcQuery(...)` sin `await`, con `<MeekoAwait>`     | El componente muestra carga, datos o error sin retrasar el primer pintado. |
| Entregar una parte de los datos más tarde desde el servidor | `render: "stream"` y `defer(...)`                                      | El servidor envía la página y luego el valor diferido.                     |

`<MeekoAwait>` representa los estados del recurso: no crea otro transporte. Consulta [MeekoAwait](reference/components/meekoawait.md), [datos en componentes](framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation) y [streaming SSR](framework.md#streaming-ssr-render-stream).

## API, RPC y Socket

| Necesitas                                                      | Elige                 | Motivo                                           |
| -------------------------------------------------------------- | --------------------- | ------------------------------------------------ |
| Una URL HTTP pública, webhook o contrato para otro cliente     | `defineApiRoute`      | El endpoint conserva semántica HTTP.             |
| Una operación interna tipada entre la aplicación y su servidor | `defineRpc`           | El cliente llama una operación del registro RPC. |
| Mensajes que llegan sin una petición nueva                     | `defineSocketChannel` | Comunicación persistente en tiempo real.         |

API y RPC comparten validación de contratos y controles del servidor. El tipo TypeScript del cliente no valida por sí solo datos externos: declara schemas de entrada y salida donde corresponda. Consulta [API y RPC](framework.md#api-y-rpc), [defineApiRoute](reference/macros/defineapiroute.md) y [defineRpc](reference/macros/definerpc.md).

## Valores en la plantilla

| Necesitas                                                         | Elige                                    | Dirección                                 |
| ----------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| Texto calculado entre etiquetas                                   | `{expresión}`                            | Lectura.                                  |
| Atributo HTML o prop calculada                                    | `bind:nombre="expresión"`                | Del padre hacia el elemento o componente. |
| Valor editable de un control o modelo declarado por un componente | `model="señal"` o `model:nombre="señal"` | Lectura y escritura de una señal.         |
| Responder a un evento                                             | `on:nombre="handler"`                    | El evento llama al handler.               |

`bind:` no convierte una expresión en un modelo bidireccional. Si tienes una señal, lee su valor: `bind:disabled="saving.value"`; pasar `saving` entrega el objeto señal. `model` requiere una señal escribible y el componente hijo debe declarar su modelo con `defineModel`. Consulta [bind](reference/syntax/bind.md), [model](reference/syntax/model.md) y [on](reference/syntax/on.md).

## Componentes por nombre

Usa una etiqueta de componente cuando su identidad se conoce en la plantilla. Si se elige durante la ejecución, usa `<component is>` con un componente renderizable. Si el nombre viene del [registro de componentes](framework.md#autoimports-y-typescript), cárgalo mediante el helper del registro antes de renderizarlo. `<component is>` también acepta etiquetas HTML dinámicas; en ese caso los atributos se aplican según la etiqueta elegida. Lee [component is](reference/components/component-tag.md) antes de combinar etiquetas HTML con atributos distintos.

## Autoimports y ámbitos

Los símbolos disponibles dependen del lugar: `<script>`, `<script server>`, `app/`, `shared/` y `server/` no tienen el mismo entorno. Un archivo de servidor no pasa al navegador por aparecer en una página SSR. Si un nombre tiene más de un origen, resuelve la ambigüedad de forma explícita. La [guía de autoimports](framework.md#autoimports-y-typescript) describe carpetas, ámbitos, precedencia y declaraciones generadas; [dónde se usa cada API](framework.md#dónde-se-usa-cada-api) resume los límites.

## Seguir aprendiendo

- [Primera aplicación](primeros-pasos.md): recorrido ejecutable con el starter.
- [Framework full-stack](framework.md): configuración, rutas, recursos, seguridad y despliegue.
- [Componentes y API](api.md): sintaxis de `.meeko` y contratos del componente.
- [Referencia](/docs/reference): detalle de cada símbolo y sus ejemplos.
