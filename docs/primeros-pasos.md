# Primera aplicación full-stack

Este recorrido usa el proyecto que genera `meeko init-framework`. Al terminar tendrás una página renderizada en el servidor, un botón que se hidrata en el navegador y comprobaciones de tipos. No necesitas configurar una base de datos para seguirlo.

## Crear y ejecutar

Necesitas Node.js 24 o posterior. En una carpeta donde quieras crear el proyecto, ejecuta:

```powershell
pnpm exec meeko init-framework my-app
cd my-app
npm install
npm run dev
```

Abre `http://localhost:4173`. El starter crea `app/pages/index.meeko`, `app/app.meeko`, `app/layouts/default.meeko` y `meeko.config.ts`. Cada archivo de `app/pages` es una ruta; el layout conserva la cabecera durante la navegación.

## Leer la primera página

Abre `app/pages/index.meeko`, que el starter ya creó. Tiene tres partes:

1. `<script server lang="ts">` declara la ruta con `definePage({ render: "prerender" })`. Esta página se genera como HTML durante el build.
2. `<script lang="ts">` crea una señal `count` para la interacción. El componente se ejecuta durante SSR y se conecta al HTML en el navegador.
3. `<template>` muestra el contador y usa `on:click` para incrementarlo.

Modifica el texto del `<h1>` y comprueba el resultado en el navegador. Después pulsa el botón: el valor cambia sin volver a cargar la página. Si quieres ver el ejemplo exacto que genera la CLI, está en el [starter](https://github.com/meekojs/meeko/blob/main/packages/meeko/src/framework/init.ts).

## Comprobar y construir

```powershell
npm run check
npm run build
npm start
```

`check` genera declaraciones del proyecto y comprueba los contratos TypeScript. `build` genera el cliente, el servidor Node y las páginas prerenderizadas en `.meeko/output/node/`. `start` sirve el build con SSR. Para un despliegue real, configura el origen público y las sesiones según la [guía de despliegue](framework.md#build-despliegue-y-verificación).

## Siguiente paso: datos y componentes

Cuando la página necesite datos iniciales, usa el código de servidor de la página o un loader en `definePage`. Para una consulta iniciada por un componente, usa `useApi` o `useRpcQuery`. La guía [Cómo elegir](como-elegir.md) explica cuándo corresponde cada opción y cómo mostrar carga y errores.

Para crear componentes reutilizables, colócalos en `app/components`. Lee [autoimports y registro de componentes](framework.md#autoimports-y-typescript) para conocer nombres, props y carga por nombre. Si una decisión de sintaxis no está clara, consulta la [referencia de componentes](api.md) y vuelve al recorrido.
