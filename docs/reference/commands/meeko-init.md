---
title: meeko init
group: commands
since: 1.0.0
description: Crea un proyecto SSR independiente, sin el framework, con un componente .meeko, su servidor de Node y Vite.
symbols:
  - "cli:init"
related:
  - "cli:init-framework"
  - "cli:types"
  - "cli:compile"
  - "@meekojs/meeko/vite#meeko"
  - docs/api.md#herramientas
  - docs/framework.md#crear-una-aplicación
---

`meeko init` crea el starter del motor de componentes: una página renderizada en el servidor e hidratada en el navegador, sin rutas por archivos, sin `meeko.config.ts` y sin `app/` ni `server/`. Es el punto de partida para usar componentes `.meeko` dentro de un servidor propio o para aprender cómo funcionan SSR e hidratación sin el framework. Para una aplicación completa, usa [`meeko init-framework`](/docs/reference/meeko-init-framework).

No instala dependencias ni sobrescribe archivos: escribe el proyecto y dice el siguiente paso.

## Uso

```sh
npx @meekojs/meeko init mi-app
```

```text
Proyecto creado en C:\proyectos\mi-app
Siguiente paso: cd C:\proyectos\mi-app && npm install && npm run dev
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `<directorio>` | ruta | obligatorio | Carpeta del proyecto. Se crea si no existe; si existe, sólo puede contener `.git` (una carpeta recién creada con `git init`) o un `package.json` con lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`), `pnpm-workspace.yaml`, `node_modules`, `.npmrc` y `.git`; las mismas que `meeko init-framework`. Hasta `1.6`, una carpeta con sólo `.git` se rechazaba. Su nombre, en minúsculas y con `-`, es el `name` del `package.json` nuevo. |

## Resultado

```text
mi-app/
├── .gitignore          node_modules/, dist/, .meeko/
├── README.md
├── index.html
├── package.json
├── server.mjs          servidor de Node: Vite en desarrollo, dist/ con --production
├── tsconfig.json       con allowArbitraryExtensions y rootDirs sobre .meeko/types
├── vite.config.ts      plugins: [meeko()]
└── src/
    ├── App.meeko       un contador con props y una señal
    ├── entry-client.ts hidrata con las props y el estado del servidor
    └── entry-server.ts renderiza con renderWithState
```

`package.json` fija `@meekojs/meeko` a la versión exacta que creó el proyecto (el código compilado y el runtime deben coincidir), añade `@types/node`, `typescript` y `vite` y declara estos scripts:

| Script | Comando |
| --- | --- |
| `dev` | `node server.mjs` |
| `check` | `meeko types src/App.meeko && tsc --noEmit` |
| `build` | `npm run check && vite build --outDir dist/client --manifest && vite build --ssr src/entry-server.ts --outDir dist/server` |
| `start` | `node server.mjs --production` |

El mensaje dice `pnpm` en lugar de `npm` si la carpeta ya tenía `pnpm-lock.yaml`. Si el directorio es el actual, omite el `cd`.

## Ejemplos

### Un proyecto nuevo

```sh
npx @meekojs/meeko init contador
cd contador
npm install
npm run dev
# http://localhost:4173
```

### En la carpeta actual, con el paquete ya instalado

```sh
mkdir contador && cd contador
pnpm add @meekojs/meeko
pnpm exec meeko init .
pnpm install
pnpm run dev
```

`package.json`, `pnpm-lock.yaml` y `node_modules` se conservan: `init` añade sus scripts y dependencias al `package.json` existente.

### Comprobar y construir

```sh
npm run check   # genera .meeko/types/src/App.d.meeko.ts y ejecuta tsc
npm run build   # dist/client y dist/server
npm start       # sirve dist/ con SSR en 127.0.0.1:4173
```

`MEEKO_PORT` (o `PORT`) cambia el puerto de `server.mjs`; la dirección es siempre `127.0.0.1`, y se cambia editando `server.mjs`, que ya es código del proyecto.

## Errores comunes

### Una carpeta con archivos

```sh bad
meeko init mi-app   # mi-app ya tiene src/ e index.html
```

```text
El destino no está vacío: C:\proyectos\mi-app (.gitignore, index.html, README.md, server.mjs, src, tsconfig.json, vite.config.ts)
```

La lista son las entradas que impiden crear el proyecto; nada se escribe. Una carpeta con sólo `.git` se acepta desde `1.7`; con lockfiles o `node_modules` pero sin `package.json`, el mensaje termina en `(sin package.json)`. Los mensajes están en español desde `1.7`.

```sh good
meeko init mi-app-nueva
```

### Un `package.json` con otros scripts o dependencias

```sh bad
# package.json con "scripts": { "dev": "vite" } o con "dependencies": { "react": "…" }
meeko init .
```

`El destino ya define el script dev: C:\proyectos\mi-app` o `El destino tiene otras dependencias: C:\proyectos\mi-app`. El starter sólo se combina con un `package.json` recién creado.

```sh good
npm init -y && meeko init .
```

### Olvidar el directorio

```sh bad
meeko init
```

`Falta el directorio de init`, con el uso y código `1`.

```sh good
meeko init .
```

## Notas

- **Motor, no framework.** El starter no tiene rutas, layouts, API, sesiones ni `meeko dev`: `server.mjs` es un servidor de ejemplo que renderiza `/` con `renderWithState` y sirve los assets. Todo lo demás lo decide el proyecto.
- **Tipos.** `meeko types src/App.meeko` escribe las declaraciones de los componentes en `.meeko/types/`, y el `tsconfig.json` las superpone a `src/` con `rootDirs`; por eso `check` lo ejecuta antes de `tsc`.
- **Cierre.** `server.mjs` cierra HTTP y Vite con `SIGINT` y `SIGTERM`, conserva las dos causas si ambos fallan y sale con un código de error.
- **Windows y POSIX.** Los scripts usan `node` y `vite` sin sintaxis de shell, así que funcionan igual en PowerShell, `cmd` y POSIX.
- **Node 24.** El `package.json` declara `"engines": { "node": ">=24" }`.
