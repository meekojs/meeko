---
title: meeko routes
group: commands
since: 1.0.0
description: Discovers routes, server contracts, components and auto-imports and prepares .meeko/ like meeko check (manifests, declarations and tsconfig), without running TypeScript.
symbols:
  - "cli:routes"
related:
  - "cli:check"
  - "cli:types"
  - "@meekojs/meeko/framework#RouteId"
  - docs/framework.md#configuración
  - docs/framework.md#autoimports-y-typescript
source-hash: b6a2bcf3786393f4ce5da9d8539cc6c2ecd052eafafdb1189091bbb84ad155c4
---

`meeko routes` performs the discovery step of [`meeko check`](/en/docs/reference/meeko-check) without checking anything: it reads `app/pages`, `server/api`, `server/rpc`, `server/socket`, components and auto-import folders from the project and its layers, then writes the manifests and declarations used by the editor, `href()` and the `api`, `rpc` and `socket` clients. Since `1.7`, it prepares `.meeko/` like `meeko check`: it also writes Vite entry points, `.meeko/types/services.d.ts`, page contracts and `tsconfig.*.json`, so `tsc -p .meeko/tsconfig.server.json` works afterward. It prints the path of each file written.

It is the quick way to make a new page or endpoint available to types, for example in a script or your own watcher, without waiting for TypeScript.

## Usage

```sh
meeko routes .
```

```text
C:\proyectos\tienda\.meeko\types\routes.d.ts
C:\proyectos\tienda\.meeko\manifests\routes.json
C:\proyectos\tienda\.meeko\types\server-contracts.d.ts
C:\proyectos\tienda\.meeko\manifests\server.json
C:\proyectos\tienda\.meeko\types\app\app.d.meeko.ts
C:\proyectos\tienda\.meeko\types\app\components\Greeting.d.meeko.ts
C:\proyectos\tienda\.meeko\types\app\layouts\default.d.meeko.ts
C:\proyectos\tienda\.meeko\types\app\pages\index.d.meeko.ts
C:\proyectos\tienda\.meeko\generated\page-contracts.server.ts
C:\proyectos\tienda\.meeko\types\services.d.ts
C:\proyectos\tienda\.meeko\types\autoimports\client.d.ts
C:\proyectos\tienda\.meeko\types\autoimports\server.d.ts
C:\proyectos\tienda\.meeko\types\autoimports\shared.d.ts
C:\proyectos\tienda\.meeko\tsconfig.app.json
C:\proyectos\tienda\.meeko\tsconfig.server.json
C:\proyectos\tienda\.meeko\tsconfig.shared.json
```

## Parameters

| Parameter      | Type | Default  | Description                                                                                                                          |
| -------------- | ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `<directorio>` | path | required | Project root. Unlike `dev`, `check` and `build`, it has no default: `meeko routes` without it gives `Falta el directorio de routes`. |

## Result

| File                                                   | Contents                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `.meeko/types/routes.d.ts`                             | Routes (`RouteId`, their parameters), layouts and named middleware.                       |
| `.meeko/manifests/routes.json`                         | The route manifest.                                                                       |
| `.meeko/types/server-contracts.d.ts`                   | Types of `api`, `rpc` and `socket` from `server/` contracts.                              |
| `.meeko/manifests/server.json`                         | The manifest of endpoints, procedures and channels.                                       |
| `.meeko/types/**/*.d.meeko.ts`                         | The declaration for each `.meeko` component in the application.                           |
| `.meeko/generated/page-contracts.server.ts`            | Page and layout prop contracts checked by the `server` project (in `routes` since `1.7`). |
| `.meeko/types/services.d.ts`                           | The type of `context.services`, from `server/runtime.ts` (in `routes` since `1.7`).       |
| `.meeko/types/autoimports/{client,server,shared}.d.ts` | Auto-imports for each scope.                                                              |
| `.meeko/tsconfig.{app,server,shared}.json`             | TypeScript projects for each scope (in `routes` since `1.7`).                             |

It exits with code `0`, or with `1` and a message if discovery fails: two routes resolving to the same URL, an API contract without `response`, a nonexistent named layout or middleware, a computed `render`…

## Examples

### After creating a page, before using it in `<MeekoLink>`

```sh
mkdir -p app/pages/blog
printf '<template><h1>Blog</h1></template>\n' > app/pages/blog/index.meeko
meeko routes .
```

`to="/blog"` stops producing `TS2345` in the editor as soon as `routes.d.ts` includes the route.

### An invalid API contract

```sh
meeko routes .
```

```text
C:/proyectos/tienda/server/api/health.get.ts: la API requiere un schema público response
```

Server discovery requires a `response` imported from `shared/`; `meeko dev`, `meeko check` and `meeko build` give the same error because they share discovery.

## Common mistakes

### Omitting the directory

```sh bad
meeko routes
```

`Falta el directorio de routes`, with usage and code `1`.

```sh good
meeko routes .
```

### Expecting `routes` to perform the checks of `meeko check`

```sh bad
meeko routes . && echo "sin errores de tipos"
```

`meeko routes` only prepares `.meeko/`: it does not run TypeScript or check components, so it exits with `0` even with type errors. Since `1.7`, it prepares the same files as `meeko check`, and `npx tsc -p .meeko/tsconfig.server.json` works afterward; through `1.6`, it did not write `tsconfig.*.json` or `services.d.ts`, and `tsc` failed with `TS5058`. To check, use `meeko check` (or `meeko check-app` for components only).

```sh good
meeko check .
```

### The path of a subfolder

```sh bad
meeko routes app
```

`ENOENT: no such file or directory, scandir '…\app\app\pages'`: the path must be the project root.

```sh good
meeko routes .
```

## Notes

- **Without running TypeScript.** It only reads and writes files; it does not check types or page prop contracts. Use `meeko check` for that.
- **Executes configuration.** It loads `meeko.config.ts` and its modules' `setup` functions, like `dev` and `check`, but does not read the project's `.env`.
- **What it does not list.** It also writes, without listing them, Vite entry points (`entry-client.ts`, `entry-server.ts`, `entry-node.ts`), clients in `.meeko/generated/` (`clients.client.ts`, `clients.server.ts`, `socket-contracts.ts`), `<script server>` blocks in `.meeko/routes/` and `.meeko/types/virtual-pages.d.ts`. Through `1.6`, it did not write entry points, `tsconfig.*.json`, page contracts or `services.d.ts`.
- **Orphaned components.** Component declarations are recorded in `.meeko/manifests/component-types.json`; regeneration deletes only managed declarations whose component no longer exists.
- **Windows and POSIX.** Printed paths are absolute and use the system separator; server discovery errors use `/`.
