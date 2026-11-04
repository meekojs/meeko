---
source-hash: 8763080a7589d1df4895e7c622b0fb17df638da539e1455da402179bd6d04e03
---

# Project diagnostics

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
