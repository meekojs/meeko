---
source-hash: 3104170185f43d54a976a1c76aa7437b12768a8054ffe1a2a3a5ff2adc040b0d
---

# Documentation guide

The documentation is organized by task. Existing guides keep their paths and anchors to preserve links from the repository and the public website.

## Get started

- [First application](primeros-pasos.md).
- [Choose Meeko](como-elegir.md).
- [Full-stack framework](framework.md#create-an-application): structure, configuration and local development.

## Framework and server

- [Routing, layouts and SSR](framework.md#routing-layouts-and-ssr).
- [Middleware](framework.md#route-and-server-middleware).
- [API and RPC](framework.md#api-and-rpc).
- [View Transitions](framework.md#native-view-transitions).
- [Reference by category](reference/README.md): macros, reactivity, composables, utilities and server.

## Components and modules

- [Components and API](api.md).
- [Meeko UI](ui.md) and [UI package API](../../packages/ui/README.md).
- [Internationalization](i18n.md).
- [Modules](framework.md#modules) and [layers](framework.md#layers).

## Tooling and quality

- [Doctor](doctor.md): local diagnostics without running the project.
- [Editors and LSP](editors.md).
- [ESLint](eslint.md): `defineEslint`, Perfectionist, rules and parser.
- [ESLint and Prettier](tooling.md).
- [DevTools](devtools.md).
- [Tests and CI](testing.md).

## Architecture and performance

- [Architecture](architecture.md).
- [Benchmarks](benchmarks.md).
- [Performance measurements and budgets](performance.md).
- [Stability contract](stability.md).

## Maintain and publish

- [Development plan](roadmap.md).
- [Releases](releasing.md).
- [Changelog](../../packages/meeko/CHANGELOG.md).

The public website publishes these categories from `packages/docs-content/src/content/catalog.ts`; the detailed reference has its own taxonomy. When adding a guide, update this index and its catalog entry if it should be public.
