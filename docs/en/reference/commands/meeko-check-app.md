---
title: meeko check-app
group: commands
since: 1.0.0
description: Checks all .meeko components in the application and its layers, without generating .meeko/ or checking .ts files with TypeScript.
symbols:
  - "cli:check-app"
related:
  - "cli:check"
  - "cli:types"
  - docs/framework.md#aliases-de-ruta
source-hash: f814b14734efb2419b8d2c2a21af6844a787fbd7023647c5b81bcdce6a3879dc
---

`meeko check-app` scans the `.meeko` files in `app/`, `server/` and `shared/` in the project and its layers and checks each one like `meeko check <componente>`: syntax, directives, types and placement of `<script server>` blocks. It also warns about misplaced `+group.ts` files and imports using aliases from an inappropriate scope (`#server/` in `app/` or `shared/`, `@/` in `shared/`).

It is the first half of [`meeko check`](/en/docs/reference/meeko-check): it does not generate `.meeko/`, read `.env` or run TypeScript on `.ts` files in `server/`, `shared/` and `app/`. Use `meeko check` for CI; `check-app` checks only components.

## Usage

```sh
meeko check-app .
```

```text
.: OK
```

The `OK` line repeats the directory as written, not its absolute path.

## Parameters

| Parameter      | Type | Default  | Description                                                   |
| -------------- | ---- | -------- | ------------------------------------------------------------- |
| `<directorio>` | path | required | Project root. Without it, `Falta el directorio de check-app`. |

## Result

| Case                                   | Output                                                        | Code |
| -------------------------------------- | ------------------------------------------------------------- | ---- |
| No errors                              | Warnings on stderr and `<directorio>: OK` on stdout           | `0`  |
| Errors                                 | All diagnostics (errors and warnings) on stderr, one per line | `1`  |
| Directory does not exist (since `1.7`) | `No existe el directorio <directorio>` on stderr              | `1`  |

```text
C:\proyectos\tienda\app\components\Greeting.meeko:3:7 TS2322: Type 'string' is not assignable to type 'number'.
C:\proyectos\tienda\app\components\Greeting.meeko:3:23 aviso MEEK101: props.name se lee una sola vez porque el setup se ejecuta una sola vez: …
```

`meeko check` does the same in its first step and, if there are errors, stops there with the same diagnostics before running TypeScript on the projects.

## Examples

### Only components, in a hook

```sh
meeko check-app . || exit 1
```

### Components in a layer

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ layers: ["./layers/base"] });
```

```sh
meeko check-app .
```

It also checks `layers/base/app/**/*.meeko`, with the auto-imports and aliases available to them in the project.

## Common mistakes

### Treating it as the complete check

```sh bad
meeko check-app .
```

With a type error in `server/api/health.get.ts`, `check-app` prints `.: OK` and exits with `0`: it does not run TypeScript on `.ts` files.

```sh good
meeko check .
```

### A directory that does not exist

```sh bad
meeko check-app ./tiend
```

`No existe el directorio ./tiend (C:\proyectos\tiend)` on stderr and code `1`, without `OK`. Through `1.6`, it printed `./tiend: OK` and exited with `0`, because it did not distinguish a missing folder from a project without errors.

```sh good
meeko check-app ./tienda
```

### Omitting the directory

```sh bad
meeko check-app
```

`Falta el directorio de check-app`, with usage and code `1`.

```sh good
meeko check-app .
```

## Notes

- **Performance.** Each component is checked with its own `tsc` process, sequentially: in an application with many components, it takes longer than the editor, which only checks open ones.
- **Generated types.** It does not regenerate `.meeko/types/` (routes, contracts, auto-imports): it uses existing files. After creating a page or endpoint, run `meeko routes` or `meeko check` first.
- **No `.env`.** It does not read it or execute the server runtime.
- **Windows and POSIX.** Diagnostic paths use the system separator.
