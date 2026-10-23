# Meeko DevTools (experimental)

DevTools permite examinar cada instancia hidratada durante el desarrollo con Vite. Se incorpora al paquete desde `0.0.2`. Hay dos interfaces para el mismo runtime: un panel dentro de la página y un panel de Chrome DevTools.

## Plan de esta etapa

| Fase | Entrega | Criterio de aceptación |
| --- | --- | --- |
| Instrumentación | Identidad de instancia, árbol padre e hijos, props, señales, eventos y limpieza al desmontar. | Una instancia anidada aparece bajo su padre; HMR conserva su identidad; SSR y producción no crean el hook. |
| Depuración | Selección, resaltado y punto de parada por instancia cuando cambia una señal. | Al activar el punto de parada y modificar una señal, Chrome pausa en el runtime de esa instancia. |
| Interfaces | Panel integrado y panel de Chrome que consumen `window.__MEEKO_DEVTOOLS__`. | Ambos muestran los mismos datos y permiten las mismas acciones básicas. |
| Validación | Pruebas de runtime, interfaz y navegador real. | Pasan tipos, pruebas, instalación como dependencia y flujo de desarrollo/producción. |

## Panel dentro de la página

El ejemplo Vite lo monta automáticamente en modo desarrollo:

```powershell
pnpm run build
pnpm run vite:dev
```

Una aplicación puede montar el panel explícitamente con `@meekojs/meeko@0.0.2` o posterior:

```ts
if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  const panel = mountDevtoolsPanel();
  // panel.unmount() libera la interfaz cuando deje de usarse.
}
```

El panel tiene un árbol de instancias, detalle de props y señales, una línea de tiempo filtrable de cambios de señales, resaltado del DOM y un punto de parada por instancia. Cada cambio conserva el nombre y archivo `.meeko` del componente y una copia segura del nuevo valor; al seleccionar un evento de una instancia activa se abre su detalle. Los eventos de señal permiten desplegar las expresiones de texto y atributo que dependen directamente de ella, con archivo, línea y columna. Sus estilos viven en Shadow DOM para no alterar los de la aplicación.

## Panel de Chrome DevTools

1. Abre `chrome://extensions`, activa el modo de desarrollador y carga la carpeta `tools/devtools-extension` como extensión descomprimida.
2. Abre una aplicación Meeko servida por Vite en desarrollo y luego las herramientas de desarrollador de Chrome.
3. En la pestaña **Meeko**, selecciona una instancia para ver sus props, señales y línea de tiempo. Filtra por señales o por instancia y pulsa un evento para volver a su componente activo. Usa **Resaltar** para ubicarlo en la página o activa el punto de parada y provoca una actualización de su señal.

La extensión consulta el hook de la página inspeccionada. No necesita cuenta ni servicio remoto. El panel de Chrome se distribuye aquí para desarrollo local; todavía no se ha publicado en Chrome Web Store.

## Alcance y límites

- El hook aparece sólo durante la hidratación de componentes compilados por Vite en modo desarrollo. No se crea durante SSR ni en el build de producción.
- Una instancia aparece con estado «Hidratado» después de completar su hidratación; al desmontarse desaparece del árbol y queda un evento de desmontaje.
- Los valores mostrados son copias acotadas y serializables; funciones, nodos DOM y estructuras profundas se resumen para que ambos paneles puedan transportarlos sin ejecutar código de la aplicación.
- Las ubicaciones de la línea de tiempo identifican **lecturas** de la señal en expresiones de texto y atributo de la plantilla. No indican la instrucción que **escribió** el nuevo valor. El seguimiento usa las dependencias activas de cada instancia, de modo que una rama que ya no lee la señal deja de aparecer. Las lecturas indirectas a través de `computed` y las expresiones de directivas de condición/lista o props de componentes todavía no tienen ubicación propia.
- El punto de parada se dispara por cambios en señales editables del componente seleccionado. Para pausar el navegador, mantén abiertas las herramientas de desarrollo.
- DevTools inspecciona props y señales; esta etapa no permite mutarlos desde el panel ni depurar cada expresión de plantilla paso a paso.
