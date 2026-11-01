---
title: meeko init-framework
group: commands
since: 1.0.0
description: Creates a full-stack Meeko application with meeko.config.ts, app/, a layout, a prerendered page, .env.example and CLI scripts.
symbols:
  - "cli:init-framework"
related:
  - "cli:init"
  - "cli:dev"
  - "cli:check"
  - "@meekojs/meeko/framework#defineMeekoConfig"
  - docs/framework.md#crear-una-aplicación
  - docs/framework.md#configuración
source-hash: aacddbd438c996eaa4df65161bb3d168b2f74dd48a99529042379a65853ddafc
---

`meeko init-framework` creates the framework starter: file-based routes in `app/pages`, a layout preserving the shell during navigation, global styles and minimal configuration. You do not need `server/runtime.ts` or Redis to get started: in development, sessions live in memory. It neither installs dependencies nor overwrites files.

## Usage

```sh
npx @meekojs/meeko init-framework tienda
```

```text
Proyecto creado en C:\proyectos\tienda
Siguiente paso: cd C:\proyectos\tienda && npm install && npm run dev
```

## Parameters

| Parameter      | Type | Default  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<directorio>` | path | required | Application folder. Created if missing; if it exists, it may only contain `.git` (a folder just created with `git init`) or a `package.json` with lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`), `pnpm-workspace.yaml`, `node_modules`, `.npmrc` and `.git`; the same as `meeko init`. Until `1.6`, folders containing only `.git` and Bun lockfiles were rejected. Its normalized name becomes the `package.json` `name` if none is set. |

## Result

```text
tienda/
├── .env.example            las variables MEEKO_* comentadas
├── .gitignore              node_modules/, .meeko/, .env
├── README.md
├── meeko.config.ts         defineMeekoConfig({ layers: [], modules: [], imports: { serverDirs: [] } })
├── package.json
├── tsconfig.json           referencia .meeko/tsconfig.app.json, server y shared
├── public/.gitkeep
└── app/
    ├── app.meeko           el documento raíz
    ├── layouts/default.meeko
    ├── pages/index.meeko   render: "prerender", con un contador
    └── styles/main.css     estilos globales, que se cargan solos
```

`package.json` receives these scripts and pins `@meekojs/meeko` to the exact version of the CLI that created it, with `@types/node`, `typescript` and `vite` as development dependencies:

| Script  | Command         |
| ------- | --------------- |
| `dev`   | `meeko dev .`   |
| `check` | `meeko check .` |
| `build` | `meeko build .` |
| `start` | `meeko start .` |

If the folder had `pnpm-lock.yaml`, the next step says `pnpm install && pnpm run dev`.

## Examples

### A new application, from start to finish

```sh
npx @meekojs/meeko init-framework tienda
cd tienda
npm install
npm run dev      # http://localhost:4173
npm run check    # tipos y contratos
npm run build    # .meeko/output/node
```

`npm start` in production requires a persistent session store (`MEEKO_REDIS_URL` or `sessions` in `server/runtime.ts`); see [`meeko start`](/en/docs/reference/meeko-start).

### Over an existing `package.json`

With a folder containing only `pnpm-lock.yaml` and this `package.json`:

```json
{ "name": "tienda", "scripts": { "test": "node --test" } }
```

```sh
meeko init-framework .
```

```text
Proyecto creado en C:\proyectos\tienda
Siguiente paso: pnpm install && pnpm run dev
```

```json
{
  "name": "tienda",
  "scripts": {
    "test": "node --test",
    "dev": "meeko dev .",
    "check": "meeko check .",
    "build": "meeko build .",
    "start": "meeko start ."
  },
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "dependencies": { "@meekojs/meeko": "1.6.0" },
  "devDependencies": { "@types/node": "^24.0.0", "typescript": "^7.0.2", "vite": "^8.3.5" }
}
```

Existing fields, scripts and dependencies are preserved; `private`, `type` and `engines.node` are set. The version number is that of the CLI you ran.

### In a monorepo

```sh
pnpm exec meeko init-framework apps/tienda
pnpm install
pnpm -F tienda dev
```

Scripts use `.` as the directory, so they work with `pnpm -F` or from the application folder.

## Common mistakes

### A nonempty folder

```sh bad
meeko init-framework tienda   # tienda ya tiene app/ o un README.md
```

`El destino no está vacío: C:\proyectos\tienda (app, README.md)`. Since `1.7`, as with `meeko init`, the message lists the blocking entries.

```sh good
meeko init-framework tienda-nueva
```

### Lockfiles without their `package.json`

```sh bad
# tienda tiene bun.lock o node_modules, pero no package.json
meeko init-framework tienda
```

`El destino no está vacío: C:\proyectos\tienda (sin package.json)`: lockfiles without their `package.json` belong to another project. A folder containing only `.git` (`git init tienda`) is accepted since `1.7`; until `1.6` it was rejected.

```sh good
cd tienda && npm init -y && meeko init-framework .
```

### A `package.json` already defining `dev`, `check`, `build` or `start`

```sh bad
# package.json con "scripts": { "dev": "vite" }
meeko init-framework .
```

`El destino ya define el script dev: C:\proyectos\tienda`. Nothing is written.

```sh good
# renombra o quita el script y vuelve a ejecutarlo
meeko init-framework .
```

## Notes

- **`.meeko/` is not versioned.** The starter's `.gitignore` excludes it, along with `.env`. Types and entry points are regenerated with `meeko dev` or `meeko check`.
- **No server to configure.** Sessions work without `server/runtime.ts`: in memory during development and, in production, in Redis through `MEEKO_REDIS_URL`. Add `server/runtime.ts` with `defineServerRuntime` when you need services, your own store or Socket policy.
- **`.env.example`.** Documents `MEEKO_PORT`, `MEEKO_HOST`, `MEEKO_PUBLIC_ORIGIN`, `MEEKO_REDIS_URL`, `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE`, `MEEKO_TRUST_PROXY` and, since `1.8`, `MEEKO_TRUSTED_PROXIES` (commented out). Copy it to `.env`: `dev`, `build`, `start`, `preview` and `check` read it.
- **Exact version.** The project pins the `@meekojs/meeko` version it was created with; update it manually with your package manager.
- **Windows and POSIX.** The message uses `&&`, which works in PowerShell 7, `cmd` and POSIX.
