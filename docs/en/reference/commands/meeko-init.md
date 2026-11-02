---
title: meeko init
group: commands
since: 1.0.0
description: Creates a standalone SSR project without the framework, with a .meeko component, its Node server and Vite.
symbols:
  - "cli:init"
related:
  - "cli:init-framework"
  - "cli:types"
  - "cli:compile"
  - "@meekojs/meeko/vite#meeko"
  - docs/api.md#herramientas
  - docs/framework.md#crear-una-aplicación
source-hash: 4d96c29dc076e42e97fdec9af0de558095cd0d764fc8e456de796391310045ee
---

`meeko init` creates the component engine starter: a server-rendered page hydrated in the browser, without file-based routing, `meeko.config.ts`, `app/` or `server/`. It is the starting point for using `.meeko` components inside your own server or learning how SSR and hydration work without the framework. For a complete application, use [`meeko init-framework`](/en/docs/reference/meeko-init-framework).

It does not install dependencies or overwrite files: it writes the project and tells you the next step.

## Usage

```sh
npx @meekojs/meeko init mi-app
```

```text
Proyecto creado en C:\proyectos\mi-app
Siguiente paso: cd C:\proyectos\mi-app && npm install && npm run dev
```

## Parameters

| Parameter      | Type | Default  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<directorio>` | path | required | Project folder. Created if absent; if it exists, it may only contain `.git` (a folder just created with `git init`) or a `package.json` with lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`), `pnpm-workspace.yaml`, `node_modules`, `.npmrc` and `.git`; the same as `meeko init-framework`. Through `1.6`, a folder containing only `.git` was rejected. Its name, lowercased and hyphenated, becomes the new `package.json`'s `name`. |

## Result

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

`package.json` pins `@meekojs/meeko` to the exact version that created the project (compiled code and runtime must match), adds `@types/node`, `typescript` and `vite` and declares these scripts:

| Script  | Command                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `dev`   | `node server.mjs`                                                                                                          |
| `check` | `meeko types src/App.meeko && tsc --noEmit`                                                                                |
| `build` | `npm run check && vite build --outDir dist/client --manifest && vite build --ssr src/entry-server.ts --outDir dist/server` |
| `start` | `node server.mjs --production`                                                                                             |

The message says `pnpm` instead of `npm` if the folder already had `pnpm-lock.yaml`. If the directory is the current one, it omits `cd`.

## Examples

### A new project

```sh
npx @meekojs/meeko init contador
cd contador
npm install
npm run dev
# http://localhost:4173
```

### In the current folder, with the package already installed

```sh
mkdir contador && cd contador
pnpm add @meekojs/meeko
pnpm exec meeko init .
pnpm install
pnpm run dev
```

`package.json`, `pnpm-lock.yaml` and `node_modules` are preserved: `init` adds its scripts and dependencies to the existing `package.json`.

### Check and build

```sh
npm run check   # genera .meeko/types/src/App.d.meeko.ts y ejecuta tsc
npm run build   # dist/client y dist/server
npm start       # sirve dist/ con SSR en 127.0.0.1:4173
```

`MEEKO_PORT` (or `PORT`) changes the port of `server.mjs`; the address is always `127.0.0.1`, and you change it by editing `server.mjs`, which is now project code.

## Common mistakes

### A folder containing files

```sh bad
meeko init mi-app   # mi-app ya tiene src/ e index.html
```

```text
El destino no está vacío: C:\proyectos\mi-app (.gitignore, index.html, README.md, server.mjs, src, tsconfig.json, vite.config.ts)
```

The list shows entries that prevent project creation; nothing is written. A folder containing only `.git` is accepted since `1.7`; with lockfiles or `node_modules` but no `package.json`, the message ends in `(sin package.json)`. Messages have been in Spanish since `1.7`.

```sh good
meeko init mi-app-nueva
```

### A `package.json` with other scripts or dependencies

```sh bad
# package.json con "scripts": { "dev": "vite" } o con "dependencies": { "react": "…" }
meeko init .
```

`El destino ya define el script dev: C:\proyectos\mi-app` or `El destino tiene otras dependencias: C:\proyectos\mi-app`. The starter only merges with a newly created `package.json`.

```sh good
npm init -y && meeko init .
```

### Omit the directory

```sh bad
meeko init
```

`Falta el directorio de init`, with usage and exit code `1`.

```sh good
meeko init .
```

## Notes

- **Engine, not framework.** The starter has no routes, layouts, API, sessions or `meeko dev`: `server.mjs` is an example server that renders `/` with `renderWithState` and serves assets. The project decides everything else.
- **Types.** `meeko types src/App.meeko` writes component declarations in `.meeko/types/`, and `tsconfig.json` overlays them on `src/` with `rootDirs`; this is why `check` runs it before `tsc`.
- **Shutdown.** `server.mjs` closes HTTP and Vite on `SIGINT` and `SIGTERM`, preserves both causes if both fail and exits with an error code.
- **Windows and POSIX.** Scripts use `node` and `vite` without shell syntax, so they work the same in PowerShell, `cmd` and POSIX.
- **Node 24.** `package.json` declares `"engines": { "node": ">=24" }`.
