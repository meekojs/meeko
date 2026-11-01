---
title: meeko clean
group: commands
since: 1.1.0
description: Deletes Meeko-generated files in a project (.meeko/ and the Vite cache) and, with --all, node_modules too, without ever following links.
symbols:
  - "cli:clean"
related:
  - "cli:dev"
  - "cli:build"
  - docs/framework.md#limpiar-el-proyecto
source-hash: 5c9e74ef09f67bee0437721604f9a91dbc1090a8d60da04ce64ae8489984ce77
---

`meeko clean` returns a project to its original state: it deletes `.meeko/` (types, entry points, manifests, builds and generated `tsconfig.*` files) and Vite's cache in `node_modules/.vite`. With `--all`, it also deletes the entire `node_modules` folder. Nothing else: application files, `.env`, `package.json` and lockfiles are never touched.

It only acts on a Meeko project and deletes a fixed list of paths inside it, without ever entering a symbolic link or junction: it is safe with pnpm's `link:` and `npm link`.

## Usage

```sh
meeko clean --dry-run
```

```text
Se borraría .meeko (90 archivos, 942.0 KiB)
Se borraría node_modules/.vite (2 archivos, 169 B)
Se liberarían 942.1 KiB en C:\proyectos\tienda (simulación: no se ha borrado nada)
```

```sh
meeko clean
```

```text
Borrado .meeko (90 archivos, 942.0 KiB)
Borrado node_modules/.vite (2 archivos, 169 B)
Liberados 942.1 KiB en C:\proyectos\tienda
```

## Options

| Option         | Type | Default | Description                                                                                          |
| -------------- | ---- | ------- | ---------------------------------------------------------------------------------------------------- |
| `[directorio]` | path | `.`     | Project root. Must have `meeko.config.*` or `@meekojs/meeko` in `dependencies` or `devDependencies`. |
| `--all`        | flag | no      | Deletes all of `node_modules` instead of only `node_modules/.vite`.                                  |
| `--dry-run`    | flag | no      | Measures what would be deleted without deleting anything.                                            |

Both flags can appear in any order and position after `clean`: `meeko clean --all --dry-run .` is valid. There are no others: `--force` gives `Opción desconocida para clean: --force`.

## Result

| Line                                                          | Output | When                                                                                                  |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `Borrado <ruta> (N archivos, M enlaces (sin seguir), tamaño)` | stdout | Each deleted path. `Se borraría …` with `--dry-run`; `Borrado en parte …` if something inside failed. |
| `Liberados <tamaño> en <proyecto>`                            | stdout | On completion. With `--dry-run`, `Se liberarían … (simulación: no se ha borrado nada)`.               |
| `Nada que limpiar en <proyecto>`                              | stdout | If none of the paths exist.                                                                           |
| `Omitido <ruta>: <motivo>`                                    | stderr | A path whose parent folder is a link, such as `node_modules/.vite` with a linked `node_modules`.      |
| `No se puede borrar <ruta>: <mensaje>`                        | stderr | A file that remains locked after retries.                                                             |

The exit code is `0` unless something could not be deleted or the directory is not allowed, in which case it is `1`.

## Examples

### Reinstalling from scratch

```sh
meeko clean --all
pnpm install
```

Links in `node_modules` (pnpm links, or `node_modules/@meekojs/meeko` with `link:`) are deleted as links: the repository they point to remains intact. The report counts them separately, as `4 enlaces (sin seguir)`.

### Before a clean build in CI

```sh
npx meeko clean
npx meeko build
```

Useful when a CI cache restores `.meeko/` from another branch. `meeko build` empties its output folder on every run, but does not delete types or manifests for routes that no longer exist.

### Seeing how much space generated files take

```sh
meeko clean --all --dry-run
```

```text
Se borraría .meeko (90 archivos, 942.0 KiB)
Se borraría node_modules (2 archivos, 4 enlaces (sin seguir), 169 B)
Se liberarían 942.1 KiB en C:\proyectos\tienda (simulación: no se ha borrado nada)
```

The size only counts files that would be deleted, not link targets.

## Common mistakes

### Running it outside a project

```sh bad
cd ..
meeko clean
```

```text
Meeko no limpia C:\proyectos: no es un proyecto Meeko (no tiene meeko.config.ts ni @meekojs/meeko en dependencies o devDependencies de package.json)
```

The command refuses before measuring anything, with code `1`. It also rejects a drive root (`es la raíz del sistema de archivos`) and the user's home folder or any folder containing it.

```sh good
meeko clean tienda
```

### Expecting it to delete other build folders

```sh bad
meeko clean --force dist
```

`Opción desconocida para clean: --force`. Even without the flag, `dist/` would not be deleted: the path list is fixed (`.meeko`, `node_modules/.vite` and, with `--all`, `node_modules`).

```sh good
meeko clean
rm -rf dist
```

### A misspelled path

```sh bad
meeko clean ./tiend
```

`No se puede limpiar C:\proyectos\tiend: el directorio no existe`, with code `1`. Pointing at the home folder gives `Meeko no limpia C:\Users\ana: es la carpeta personal del usuario o la contiene`.

```sh good
meeko clean ./tienda
```

### Cleaning while `meeko dev` is still running

```sh bad
# con meeko dev corriendo en otra terminal
meeko clean
```

Deletion does not fail, but `meeko dev` writes `.meeko/` only on startup: the server keeps responding with modules already in memory, without entry points on disk, and `.meeko/types/` remains empty for the editor and `tsc` until the next `meeko dev` or `meeko check`.

```sh good
# Ctrl+C en meeko dev
meeko clean
meeko dev
```

## Notes

- **Safety.** The directory is resolved to its real path; each deleted path must be inside it, and a path whose parent folder is a link elsewhere is skipped with a warning. Links and junctions are deleted as links, without entering them.
- **Windows.** Transient Windows locks (`EBUSY`, `EPERM`, `EACCES`, `ENOTEMPTY`, typical of antivirus and indexers) are retried five times with increasing delays (50 to 800 ms). Read-only files are unlocked before deletion. A junction is removed with nonrecursive `rmdir`, which only removes the reparse point.
- **POSIX.** Symbolic links are removed with `unlink`, without following them.
- **What it does not delete.** `.env`, lockfiles, `package.json`, `public/`, `dist/` and any other folder. For a monorepo, run it in each application.
- **Performance.** It deletes batches of 32 files in parallel. `--dry-run` walks the entire tree to measure it, so it also takes time with a large `node_modules`.
- **Nothing to delete.** If none of the paths exist, it prints `Nada que limpiar en <proyecto>` and exits with code `0`.
