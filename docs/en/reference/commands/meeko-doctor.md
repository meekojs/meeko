---
title: meeko doctor
group: commands
since: 1.8.0
description: Inspects the project's local environment (Node, packages, configuration, .meeko/ artifacts and language server) without running its code, reading .env or modifying files.
symbols:
  - "cli:doctor"
related:
  - "cli:check"
  - "cli:routes"
  - "cli:lsp"
  - docs/doctor.md
source-hash: cfb1e7f7e683c8900c321d9eb919497bf91423d2025fbcb36659e6cee2303d37
---

`meeko doctor` reviews what `meeko check`, the editor and `meeko dev` need in order to start: the Node version, `package.json`, which version of each Meeko package and its tools resolves from the project, the configuration, the basic `.meeko/` artifacts and the project's language server. It prints a human-readable report or, with `--json`, the same report as structured data to attach to an issue.

The inspection is static: it reads `meeko.config.*` without executing it, does not load `.env`, import modules, start the LSP or connect to services, and writes no files. It checks presence and resolution; to validate the whole project, use [`meeko check`](/en/docs/reference/meeko-check).

## Usage

```sh
meeko doctor .
```

```text
Meeko doctor — C:\proyectos\tienda
Proyecto: application · Node 24.22.3

OK Node 24.22.3; Meeko requiere Node 24 o superior.
OK package.json válido.
OK Meeko 1.9.0 resuelve desde el proyecto.
OK Configuración leída estáticamente: los módulos importados, las funciones y sus opciones no se ejecutan.
OK Los artefactos básicos de .meeko están presentes; esto no garantiza que estén actualizados.
OK Servidor de lenguaje del proyecto disponible.

Paquetes:
  @meekojs/meeko: 1.9.0
  @meekojs/ui: 1.9.0
  typescript: 7.0.2
  vite: 8.3.8

La elección efectiva del editor depende de la confianza del workspace y de su configuración; este informe no consulta ni modifica VS Code.
No se ejecutaron módulos ni configuración, no se cargó .env y no se modificó ningún archivo.
```

`Paquetes` lists only the packages that resolve from the project, among `@meekojs/meeko`, `@meekojs/ui`, `@meekojs/i18n`, `@meekojs/eslint-plugin`, `@meekojs/prettier-plugin`, `typescript`, `vite`, `eslint` and `prettier`.

## Options

| Option         | Type | Default | Description                                                                                  |
| -------------- | ---- | ------- | -------------------------------------------------------------------------------------------- |
| `[directorio]` | path | `.`     | Root of the application or workspace to inspect.                                             |
| `--json`       | flag | no      | Prints the report as JSON instead of readable text. It can go before or after the directory. |

There are no other options: `--verbose` gives `Opción desconocida para doctor: --verbose`, with usage and code `1`.

## Result

Each check is an `OK`, `AVISO` (warning) or `ERROR` line. `AVISO` flags a state that may be normal, such as a project that has not been prepared yet or an optional tool that is not installed; `ERROR` flags an unmet requirement.

| Check (`id`)      | `OK`                                                                                       | Otherwise                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `node`            | Node 24 or later                                                                           | `ERROR`                                                                    |
| `manifest`        | `package.json` is valid JSON                                                               | `AVISO`                                                                    |
| `meeko`           | `@meekojs/meeko` resolves from the directory                                               | `AVISO`: install dependencies or build the workspace                       |
| `config`          | The configuration is read statically, or there is no file                                  | `AVISO`, without repeating the error, which could contain secrets          |
| `generated`       | The `.meeko/` `tsconfig.*.json`, `types/routes.d.ts` and `generated/entry-client.ts` exist | `AVISO`. Checked only if the directory has `app/`                          |
| `language-server` | The project's `@meekojs/meeko` package includes `meeko-language-server`                    | `AVISO`: the editor may fall back to the server bundled with its extension |

| Case                     | Output                                              | Code |
| ------------------------ | --------------------------------------------------- | ---- |
| No `ERROR`               | The report on stdout, even with warnings            | `0`  |
| At least one `ERROR`     | The report on stdout                                | `1`  |
| Directory does not exist | `No existe el directorio <ruta absoluta>` on stderr | `1`  |

With `--json`, the report has `schemaVersion: 1`, `root`, `node`, `projectKind` (`application`, `workspace` or `unknown`), `packageManager` if `package.json` declares it, `packages` (name, version, folder, entry point and language server of each), `config` (`mode: "static"`, the file, and the names in `modules` and in `extends` and `layers`), `generated` (each artifact with `exists`), `languageServer`, `checks` (`id`, `status` and `message`) and `ok`, which is `false` if any check is `error`.

```json
{
	"schemaVersion": 1,
	"root": "C:\\proyectos\\tienda",
	"node": "24.22.3",
	"projectKind": "application",
	"packageManager": "pnpm@12.14.0",
	"checks": [{ "id": "node", "status": "ok", "message": "Node 24.22.3; Meeko requiere Node 24 o superior." }],
	"ok": true
}
```

The excerpt omits `packages`, `config`, `generated` and `languageServer`.

## Examples

### Before opening an issue

```sh
pnpm exec meeko doctor . --json > doctor.json
```

The JSON does not include `.env` values, module options or catalog contents, but it does include absolute paths on your machine: review it before attaching it.

### An application inside a monorepo

```sh
pnpm exec meeko doctor apps/tienda
```

It inspects `apps/tienda` and resolves packages from that folder, as the application would.

### In CI, only as a Node requirement

```sh
meeko doctor . && meeko check .
```

`doctor` fails only with an `ERROR`, which today is a Node version below 24; `meeko check` checks the project.

## Common mistakes

### Treating an artifacts `AVISO` as a failure

```sh bad
meeko doctor . || echo "proyecto roto"
```

`AVISO Faltan artefactos de .meeko; …` does not change the exit code, which stays `0`. The artifacts are generated when the project is prepared:

```sh good
meeko routes .
```

### Expecting it to check types

```sh bad
meeko doctor .
```

With a type error in a page, `doctor` prints `OK` on every line: it only checks that the `.meeko/` files exist, not that they are up to date or that the code compiles.

```sh good
meeko check .
```

### A directory that does not exist

```sh bad
meeko doctor ./tiend
```

`No existe el directorio C:\proyectos\tiend` on stderr and code `1`, without a report.

```sh good
meeko doctor ./tienda
```

## Notes

- **No code is executed.** `meeko.config.*` is read as text: an imported module, a function or a dynamic expression is neither executed nor listed as loaded in `modules`.
- **Language server.** It reports the server the project has available, not the one the editor runs: that depends on workspace trust and VS Code settings. See [Editors](/en/docs/editors).
- **Spanish output.** `OK`, `AVISO`, `ERROR` and the messages are the CLI's literal output. In a script, read `checks[].id` and `checks[].status` from the JSON rather than the text, which may improve in any release.
- **Windows and POSIX.** Report paths use the system separator.
