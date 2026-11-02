---
title: meeko check
group: commands
since: 1.0.0
description: Checks an entire project, or a single .meeko component, with Meeko and TypeScript diagnostics, and generates .meeko/ types.
symbols:
  - "cli:check"
related:
  - "cli:check-app"
  - "cli:build"
  - "cli:routes"
  - "cli:types"
  - "cli:lsp"
  - docs/framework.md#autoimports-y-typescript
  - docs/framework.md#tipos-de-los-servicios
  - docs/editors.md#comprobación-del-proyecto
source-hash: 9d977d58789ef0e48252b5cd3f7a15e38fb27fe618f7aa4e21954cc59eb7b23f
---

`meeko check` is the complete application check: the one that must pass in CI before `meeko build`. With a directory (the current one by default), it generates the same files as `meeko dev` in `.meeko/` (entry points, manifests, declarations for routes, contracts, auto-imports, components and, since `1.7`, `.meeko/types/services.d.ts`), checks each application `.meeko` and its prop contracts, then runs TypeScript on the three generated projects: `app`, `server` and `shared`.

With a `.meeko` file, it checks only that component: its syntax, directives and types, like the editor. Since `1.7`, in an application it also reports what previously only the project check reported: `MEEK044` (a `<script server>` outside `app/pages`), `MEEK100` (`generic` in a page or layout) and type errors in its `<script server>`, including route options. If the project already has `.meeko/types`, it regenerates them first, so it sees a layout created after the last `meeko check .`.

## Usage

```sh
meeko check
```

```text
C:\proyectos\tienda: OK
```

The `OK` line includes the project's absolute path. The starter declares it as `"check": "meeko check ."`.

## Options

| Option               | Type | Default | Description                                                                                                             |
| -------------------- | ---- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `[directorio]`       | path | `.`     | Project root to check. Its `.env` is read before loading `meeko.config.ts`.                                             |
| `[componente.meeko]` | path | none    | Instead of a directory: checks only that component. A path that is not an existing directory is treated as a component. |
| `--json`             | flag | no      | Only with a component, always after it: prints diagnostics as a JSON array on stdout.                                   |

## Result

| Case                              | Standard output       | Standard error                                                                  | Code                      |
| --------------------------------- | --------------------- | ------------------------------------------------------------------------------- | ------------------------- |
| Project without errors            | `<ruta absoluta>: OK` | Warnings (`aviso MEEKxxx`), if any                                              | `0`                       |
| Project with errors in a `.meeko` |                       | All diagnostics, including warnings, as `archivo:línea:columna CÓDIGO: mensaje` | `1`                       |
| Project with errors in a `.ts`    |                       | `Falló la comprobación con TypeScript (<tsconfig>):` and `tsc` output           | `1`                       |
| Component without errors          | `<ruta>: OK`          | Warnings                                                                        | `0`                       |
| Component with errors             |                       | Diagnostics                                                                     | `1`                       |
| Component with `--json`           | The diagnostics array |                                                                                 | `1` if there is any error |

Each `.meeko` diagnostic points to the original file, with its line and column:

```text
C:\proyectos\tienda\app\components\Greeting.meeko:3:7 TS2322: Type 'string' is not assignable to type 'number'.
C:\proyectos\tienda\app\components\Greeting.meeko:3:23 aviso MEEK101: props.name se lee una sola vez porque el setup se ejecuta una sola vez: …
```

The order for a project is: configuration, migration of `server/session.ts`, generated files, `.meeko` files (stopping there if any have errors) and finally TypeScript with `.meeko/tsconfig.app.json`, `tsconfig.server.json` and `tsconfig.shared.json`, sequentially.

A plain `app/` module is checked with `tsconfig.app.json`, so it can use the auto-imports reserved for browser code (`useHead`, `useForm`, `resolveComponent`…), which do not exist in `server/`. Since its exports also reach the server, that module also enters the `tsconfig.server.json` program: since `1.8`, `meeko check` skips its diagnostics there, already checked in `tsconfig.app.json`. **Running `tsc -p .meeko/tsconfig.server.json` by hand does not skip them** and gives `TS2304` on those names: use `meeko check`.

## Examples

### In CI

```yaml
# .github/workflows/ci.yml
- run: npm ci
- run: npx meeko check
- run: npx meeko build
```

`.meeko/` is in the starter's `.gitignore`: `meeko check` generates it on every run, so you do not need to version or cache it. `meeko build` checks the project again before building; with two separate steps, the log shows which phase failed.

### JSON diagnostics for a tool

```sh
meeko check app/components/Greeting.meeko --json
```

```json
[{"code":"TS2322","message":"Type 'string' is not assignable to type 'number'.","filename":"C:\\proyectos\\tienda\\app\\components\\Greeting.meeko","location":{"offset":72,"line":3,"column":7}},{"code":"MEEK101","message":"props.name se lee una sola vez…","filename":"…","location":{"offset":88,"line":3,"column":23},"severity":"warning"}]
```

An error has no `severity`; a warning has `"severity": "warning"`. `offset` counts characters from the start of the `.meeko` file.

### A TypeScript error outside components

The `.ts` files in `server/`, `shared/` and `app/` are checked with their generated project:

```text
Falló la comprobación con TypeScript (C:\proyectos\tienda\.meeko\tsconfig.server.json):
server/api/health.get.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.
```

In diagnostics for a `<script server>`, the path is the page's, with the same line and column.

### Regenerating types for the editor

After creating a page or endpoint, `<MeekoLink>`'s `to="/nueva"` or `api.nuevo.get()` are type errors until declarations are regenerated:

```sh
meeko check
```

If you only want declarations without waiting for TypeScript, use [`meeko routes`](/en/docs/reference/meeko-routes); the editor also regenerates them on save in a trusted workspace.

## Common mistakes

### `--json` with a project

```sh bad
meeko check . --json
```

`--json sólo está disponible para un componente .meeko`, with code `1`. Before the component (`meeko check --json`), the error is `--json va después del componente .meeko de check`.

```sh good
meeko check app/pages/index.meeko --json
```

### A path that does not exist

```sh bad
meeko check ./tiend
```

Since `1.7`, a path not ending in `.meeko` is a project, and the error says so: `No existe el directorio ./tiend (…\tiend)`, with code `1`. A nonexistent path ending in `.meeko` gives `No existe el archivo …`. Through `1.6`, any path that was not a directory was treated as a component, and the error was `ENOENT: no such file or directory, open '…\tiend'`.

```sh good
meeko check ./tienda
```

### Running it from a subfolder

```sh bad
cd app
meeko check
```

`meeko check` looks for `app/pages` inside the directory and fails with `ENOENT: no such file or directory, scandir '…\app\app\pages'`.

```sh good
meeko check ..
```

### A standalone component without `@types/node`

Outside a project with `tsconfig.json`, the component is checked with the default options, which include Node types:

```sh bad
# Card.meeko en una carpeta sin node_modules
meeko check Card.meeko
```

```text
Falló la comprobación con TypeScript 7: error TS2688: Cannot find type definition file for 'node'.
```

```sh good
# dentro de un proyecto con @types/node instalado
meeko check app/components/Card.meeko
```

### Relying on `meeko check-app` as the complete check

```sh bad
meeko check-app .
```

`check-app` only checks `.meeko` files: a type error in `server/api/*.ts` or `shared/` does not stop it (it prints `.: OK`).

```sh good
meeko check .
```

## Notes

- **What it does not check.** `meeko.config.ts` is only checked with TypeScript when its validation fails on load; an unknown key, such as `sitemapp: true`, does not produce an error. It does not run loaders or prerender either: a missing `prerenderEntries` on a dynamic route is detected only by `meeko build`.
- **`.env`.** It is read before loading configuration, because `meeko.config.ts` and `server/runtime.ts` can read project variables. The actual environment takes precedence.
- **Service types.** Since `1.7`, it generates `.meeko/types/services.d.ts`, which infers the type of `context.services` from the default export of `server/runtime.ts`; if the runtime uses auto-imported `defineServerRuntime`, it also writes a copy with imports in `.meeko/types/server-runtime.ts`.
- **Performance.** The slowest part is TypeScript 7 (native `tsc`), which runs sequentially in child processes: one for each application `.meeko`, then one for each project (`app`, `server` and `shared`). Time grows with the number of components. Checking a single component launches one `tsc` for that component and its imports, which is suitable for a pre-commit hook on changed `.meeko` files.
- **Windows and POSIX.** Diagnostic paths use the system format: with `\` on Windows. `tsc` messages use project-relative paths with `/`.
- **Warnings.** Warnings (`MEEK101`, `MEEK109`…) do not change the exit code, but are always printed, including alongside errors.
