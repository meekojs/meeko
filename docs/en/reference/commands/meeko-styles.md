---
title: meeko styles
group: commands
since: 1.12.0
description: Writes .meeko/styles/main.css, the processed global stylesheet that meeko dev maintains, without starting the server, for the editor and for meekoSortClasses "stylesheet" in CI.
symbols:
  - "cli:styles"
related:
  - "cli:dev"
  - "cli:check"
  - "cli:clean"
  - docs/framework-configuration.md#hoja-global-procesada-para-el-editor
  - docs/editors.md#orden-por-la-hoja-global
source-hash: bf633d35fe31a1d488c525c949ffb8cf9029b1b456a9d480ea97ff00958ce354
---

`meeko styles` writes `.meeko/styles/main.css`: the project's global stylesheet (`app/styles/main.css` with its `@import`s, the stylesheets that modules register and the Vite CSS plugins applied), already processed, as `meeko dev` maintains it. The editor reads it to complete the classes that only the CSS pipeline generates, and so does Prettier's `meekoSortClasses: "stylesheet"`, to sort them.

It uses the same Vite pipeline as `meeko dev`, with the modules' plugins and `extendViteConfig`, but on a server with no port, WebSocket or watchers that closes when it finishes. It does not generate types, run TypeScript or check the `.meeko` files. It writes the file atomically (a temporary file that is renamed), so a reader never sees half a stylesheet, and only replaces it if its contents change.

## Usage

```sh
meeko styles
```

```text
C:\proyectos\tienda\.meeko\styles\main.css
```

The output is the absolute path of the file written. A project with no stylesheets writes nothing and says so:

```text
C:\proyectos\tienda: sin hojas de estilos
```

## Options

| Option         | Type | Default | Description                                                                            |
| -------------- | ---- | ------- | -------------------------------------------------------------------------------------- |
| `[directorio]` | path | `.`     | Project root. Its `.env` is read before loading `meeko.config.ts` and the CSS plugins. |

There are no more options.

## Result

| Case                               | Standard output                        | Standard error                                                   | Code |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------- | ---- |
| Stylesheet written (or up to date) | `<path of .meeko/styles/main.css>`     |                                                                  | `0`  |
| The project has no stylesheets     | `<project path>: sin hojas de estilos` |                                                                  | `0`  |
| The stylesheets do not compile     |                                        | `[meeko] .meeko/styles/main.css conserva la versión anterior: …` | `1`  |

Without stylesheets, the command deletes an old `.meeko/styles/main.css` instead of leaving it: Prettier's ordering and the editor's completion must not follow a stylesheet that no longer exists. If the stylesheets do not compile, it keeps the previous one.

## Examples

### Sorting classes in CI

`.meeko/` is outside Git, so without a previous `meeko dev`, `meekoSortClasses: "stylesheet"` does not see the utilities of tools that register as a Vite plugin (such as Tailwind with `@tailwindcss/vite`, the case of `@meekojs/ui`) and sorts differently than locally. Run `meeko styles` before Prettier:

```yaml
# .github/workflows/ci.yml
- run: npm ci
- run: npx meeko styles
- run: npx prettier --check .
```

`meeko check` also writes the stylesheet when it finishes successfully, with the same contents: a job that already runs `meeko check` before Prettier does not need this step. If it only formats, `meeko styles` is the cheap option, because it does not check types.

### Preparing the editor after cloning

```sh
git clone https://github.com/ejemplo/tienda.git
cd tienda
npm install
npx meeko styles
```

The editor offers, as `main.css (global, procesada)`, the classes that only the CSS pipeline generates, without waiting for the first `meeko dev`. Reading the stylesheet does not run the project, so it also works in an untrusted workspace.

## Common mistakes

### Expecting `meeko build` to write it

```sh bad
meeko build
prettier --check .
```

`meeko build` does not write `.meeko/styles/main.css`: build CSS is minified and combines the global stylesheet with the components' `<style>` blocks.

```sh good
meeko styles
prettier --check .
```

### Ignoring the exit code

```sh bad
meeko styles; prettier --check .
```

If the stylesheets do not compile, `meeko styles` warns and exits with `1`, but `;` runs Prettier anyway with the previous stylesheet (or without it), and the order depends on what was on disk.

```sh good
meeko styles && prettier --check .
```

### Using it as the project check

```sh bad
meeko styles
meeko build
```

`meeko styles` only processes the stylesheets: it does not check the `.meeko` files or run TypeScript, so a type error in `server/api/*.ts` goes unnoticed.

```sh good
meeko check
meeko build
```

## Notes

- **Same contents as `meeko dev`.** For the same project it writes the same as `meeko dev`: the same Vite pipeline, with the modules' plugins. The contents of the stylesheet follow whatever Vite and its plugins generate and can change in any version; its path is kept throughout 1.x (see [the stability policy](../../stability.md#outside-the-contract)).
- **What `meeko clean` does.** It deletes `.meeko/styles/main.css` along with the rest of `.meeko/`; `meeko styles` writes it again.
- **`.env`.** It is read before loading the configuration and the CSS plugins, which may need project variables, as in `meeko dev`. The real environment wins.
- **Performance.** It loads Vite and the project's CSS plugins, but it does not generate types or run TypeScript, so it costs less than `meeko check`.
- **Stylesheet details.** The format, the warnings and when `meeko dev` rewrites it are in [Processed global stylesheet for the editor](../../framework-configuration.md#processed-global-stylesheet-for-the-editor).
