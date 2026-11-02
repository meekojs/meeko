---
title: meeko types
group: commands
since: 1.0.0
description: Generates a component's .d.meeko.ts declaration and those of its imported components in .meeko/types/, so TypeScript can check their props.
symbols:
  - "cli:types"
related:
  - "cli:check"
  - "cli:compile"
  - "cli:routes"
  - "cli:init"
  - docs/api.md#herramientas
source-hash: b600219314dcbac04a9c9353aacd9c8a259e7a9f83d9eecf80cc80df8e83f082
---

`meeko types` writes the type declaration of a `.meeko` component (its props, events, models, snippets and exposed values) and recursively of each `.meeko` it imports through relative imports or path aliases. Declarations go in `.meeko/types/`, with the same project-relative path and the `.d.meeko.ts` extension; never alongside sources. It prints the path of each declaration written.

With those declarations, a `.ts` file importing the component (`import App from "./App.meeko"`) receives its exact props. This is what the [`meeko init`](/en/docs/reference/meeko-init) starter's `check` script does before `tsc`. In a framework application you do not need to call it: `meeko check`, `meeko dev` and `meeko routes` generate declarations for all components.

## Usage

```sh
meeko types src/App.meeko
```

```text
C:\proyectos\contador\.meeko\types\src\App.d.meeko.ts
```

## Parameters

| Parameter            | Type | Default  | Description                                                                                                                        |
| -------------------- | ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `<componente.meeko>` | path | required | The entry component. The project is the nearest folder with `package.json` or `meeko.config.*`; its path aliases apply to imports. |

## Result

For each component in the graph, `.meeko/types/<ruta relativa>.d.meeko.ts`, starting with `// @meeko-generated component-declaration v1` and declaring the compiled module's exports: `Props` and component types, `renderWithState`, `hydrate`, `css`… Relative imports of `.ts` modules are rewritten to keep pointing to the sources. Exits with `0`, or `1` and the error if a component fails to compile.

For TypeScript to use these declarations when importing `./App.meeko`, `tsconfig.json` needs `allowArbitraryExtensions` and `rootDirs` overlaying the sources with `.meeko/types/`:

```json
{
  "compilerOptions": {
    "allowArbitraryExtensions": true,
    "rootDirs": ["src", ".meeko/types/src"]
  }
}
```

`meeko init` already writes it this way.

## Examples

### Check a TypeScript consumer

<!-- no-check -->

```ts
// src/entry-server.ts
import { css, renderWithState } from "./App.meeko";

export function renderPage(initial = 1): string {
  const props = { initial: String(initial) };
  const rendered = renderWithState(props);
  return `<style>${css}</style><div id="app">${rendered.html}</div>`;
}
```

```sh
meeko types src/App.meeko && tsc --noEmit
```

```text
src/entry-server.ts(5,36): error TS2345: Argument of type '{ initial: string; }' is not assignable to parameter of type 'Props'.
  Types of property 'initial' are incompatible.
    Type 'string' is not assignable to type 'number'.
```

Without declarations, `./App.meeko` has no types and `tsc` does not detect that `App.meeko` declares `initial: number`.

### Multiple entry components

```sh
meeko types src/App.meeko
meeko types src/Admin.meeko
```

Each call generates its component's graph; a shared component is rewritten with the same content.

## Common mistakes

### A component with errors

Before generating, `meeko types` checks the entry component like `meeko check`: with a syntax or type error, it writes nothing.

```html bad
<!-- src/App.meeko -->
<template><p>{count.value</p></template>
```

```text
C:\proyectos\contador\src\App.meeko:1:14 MEEK010: Expresión de plantilla sin cerrar
```

A type error in the script (`const n: number = "x"`) likewise produces `TS2322` and exit code `1`.

```html good
<!-- src/App.meeko -->
<script lang="ts">
import { signal } from "@meekojs/meeko";
const count = signal(0);
</script>
<template><p>{count.value}</p></template>
```

### Different casing on Windows

```sh bad
meeko types src/app.meeko   # el archivo es src/App.meeko
```

This works on Windows and macOS because the filesystem is case-insensitive, and since `1.7` the declaration uses the file's actual name (`.meeko\types\src\App.d.meeko.ts`; through `1.6` it was written as `app.d.meeko.ts`). On Linux and in CI the same command fails with `No existe el archivo src/app.meeko (…)`: write the name as it appears on disk.

```sh good
meeko types src/App.meeko
```

## Notes

- **Location.** Always under the project's `.meeko/types/`, never alongside sources. Put `.meeko/` in `.gitignore`: regenerate declarations in CI before `tsc`.
- **Orphans.** In a framework application, generated declarations are recorded in `.meeko/manifests/component-types.json` and `meeko check` deletes only managed declarations whose component no longer exists; `meeko types` deletes nothing.
- **Components in `server/`.** A `.meeko` under `server/` is compiled with server auto-imports; the rest use client auto-imports.
- **Performance.** It checks only the entry component with a `tsc` invocation, then compiles each component in the graph and emits its declaration without further checks.
