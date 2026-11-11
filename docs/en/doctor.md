---
source-hash: b89b1d179821f7513ad2f97c91317a54207c04bcb28d75a981416e475fbb04ce
---

# Project diagnostics

## When something fails to start

If `meeko check`, your editor, or the development server cannot find a package or generated types, run this from **your application's** root:

```sh
pnpm exec meeko doctor .
pnpm exec meeko doctor . --json
```

Human-readable output starts with `Meeko doctor — <path>` and `Proyecto: <kind> · Node <version>`, then lists `OK`, `AVISO`, or `ERROR` checks and detected packages, and ends with the inspection limits. The JSON report exposes the same findings for an issue report. `ERROR` produces exit code 1; `AVISO` does not change a successful exit code. These status words are the CLI's literal Spanish output.

Node versions below 24 need an upgrade. If dependencies are missing, install them in the application. If `.meeko` artifacts are missing, run `pnpm exec meeko check .` and reopen the editor. Doctor checks presence and resolution; `check` performs project preparation and validation.

`meeko doctor` inspects the local environment without executing application configuration or modules, loading `.env`, starting the LSP, connecting to services or modifying files.

```sh
pnpm exec meeko doctor
pnpm exec meeko doctor apps/meeko
pnpm exec meeko doctor apps/meeko --json
```

## What it checks

- Node version and the requirement for Node 24 or later.
- `package.json` and the declared package manager.
- Versions and local resolution of Meeko, UI, i18n, plugins, TypeScript, Vite, ESLint and Prettier.
- Configuration file and static module and layer references.
- Presence of tsconfigs, route types and generated client entry point in `.meeko`.
- Availability of the language server installed with Meeko in the project.

## Interpreting the result

`OK` confirms a check; `AVISO` asks you to review a potentially normal state, such as missing optional dependencies or a project that has not been prepared yet. `ERROR` indicates an unmet requirement. Errors return exit code 1; warnings do not.

The JSON has `schemaVersion: 1`, information about packages, configuration, artifacts and the LSP, and a list of checks with IDs and statuses. You can attach it to an issue or process it in scripts. It does not include `.env` values, module options or catalog contents.

## Limitations and next steps

Reading is static: imported modules, functions and dynamic expressions are neither executed nor listed as though they were loaded. The presence of a generated file does not guarantee it is up to date; `meeko check` prepares and validates the project when you need a complete check.

The actual LSP selection depends on workspace trust and VS Code settings. Doctor reports which project server is available; it does not claim the editor is running it or modify extensions.

If artifacts are missing, run `pnpm exec meeko routes` or `pnpm exec meeko check`. If dependencies are missing, install them from the workspace root. See [Editors](editors.md), [Tooling](tooling.md) and [Testing](testing.md) for the corresponding workflows.
