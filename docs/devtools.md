# Meeko DevTools (experimental)

DevTools permite examinar cada instancia hidratada durante el desarrollo con Vite. Esta función se está desarrollando después de la versión npm `0.0.1`; para probarla desde el repositorio usa el código actual. Hay dos interfaces para el mismo runtime: un panel dentro de la página y un panel de Chrome DevTools.

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

Cuando una versión con DevTools esté publicada, otra aplicación podrá montarlo explícitamente:

```ts
if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  const panel = mountDevtoolsPanel();
  // panel.unmount() libera la interfaz cuando deje de usarse.
}
```

El panel tiene un árbol de instancias, detalle de props y señales, eventos recientes, resaltado del DOM y un punto de parada por instancia. Sus estilos viven en Shadow DOM para no alterar los de la aplicación.

## Panel de Chrome DevTools

1. Abre `chrome://extensions`, activa el modo de desarrollador y carga la carpeta `tools/devtools-extension` como extensión descomprimida.
2. Abre una aplicación Meeko servida por Vite en desarrollo y luego las herramientas de desarrollador de Chrome.
3. En la pestaña **Meeko**, selecciona una instancia para ver sus props, señales y eventos. Usa **Resaltar** para ubicarla en la página o activa el punto de parada y provoca una actualización de su señal.

La extensión consulta el hook de la página inspeccionada. No necesita cuenta ni servicio remoto. El panel de Chrome se distribuye aquí para desarrollo local; todavía no se ha publicado en Chrome Web Store.

## Alcance y límites

- El hook aparece sólo durante la hidratación de componentes compilados por Vite en modo desarrollo. No se crea durante SSR ni en el build de producción.
- Una instancia aparece con estado «Hidratado» después de completar su hidratación; al desmontarse desaparece del árbol y queda un evento de desmontaje.
- Los valores mostrados son copias acotadas y serializables; funciones, nodos DOM y estructuras profundas se resumen para que ambos paneles puedan transportarlos sin ejecutar código de la aplicación.
- El punto de parada se dispara por cambios en señales editables del componente seleccionado. Para pausar el navegador, mantén abiertas las herramientas de desarrollo.
- DevTools inspecciona props y señales; esta etapa no permite mutarlos desde el panel ni depurar cada expresión de plantilla paso a paso.
