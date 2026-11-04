# Meeko translation glossary

Use this Spanish-to-English glossary for the English documentation. It describes wording, not new framework behavior. Read [the translation guide](TRANSLATING.md) before translating a batch.

## Framework and component terminology

| Spanish source                        | Preferred English                | Usage                                                                                           |
| ------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| señal, signal                         | signal                           | Use `signal` for the API identifier; “a signal” for the concept.                                |
| señal de solo lectura                 | read-only signal                 | Preserve the identifier `ReadonlySignal`.                                                       |
| valor derivado, calculado             | computed value                   | Preserve `computed`; do not call it a writable signal.                                          |
| reactividad                           | reactivity                       | “Reactive” is the adjective.                                                                    |
| efecto                                | effect                           | Preserve the API name `effect`.                                                                 |
| observador                            | observer                         | Use “subscriber” only when the source specifically describes a subscription.                    |
| dependencia                           | dependency                       | Distinguish reactive dependencies from package dependencies.                                    |
| lote, agrupar escrituras              | batch, batch writes              | Preserve `batch`.                                                                               |
| raíz, raíz activa                     | root, active root                | Qualify as “reactive root” when needed; distinguish the project root.                           |
| contexto                              | context                          | Distinguish reactive context from request context.                                              |
| proveer, inyectar                     | provide, inject                  | Preserve `provide`, `inject` and `createContext`.                                               |
| componente                            | component                        | A component is not necessarily a custom element.                                                |
| componente integrado, etiqueta propia | built-in component, built-in tag | Use “built-in tag” for compiler-recognized tags; “custom element” means an HTML custom element. |
| etiqueta de componente                | component tag                    | Preserve actual tag names and capitalization.                                                   |
| elemento personalizado                | custom element                   | Do not use this for every Meeko component.                                                      |
| plantilla                             | template                         | Preserve `<template>`.                                                                          |
| snippet                               | snippet                          | Keep this term; do not substitute “slot”.                                                       |
| prop, propiedades de un componente    | prop, component props            | Use “property” for ordinary object properties.                                                  |
| atributo                              | attribute                        | Distinguish an HTML attribute from a component prop.                                            |
| directiva                             | directive                        | Preserve its syntax exactly.                                                                    |
| interpolación                         | interpolation                    | Preserve expressions between braces.                                                            |
| enlace, vinculación de datos          | binding                          | Use “link” for navigation links instead.                                                        |
| enlace bidireccional                  | two-way binding                  | Preserve `model` and `model:name`.                                                              |
| atributos en bloque                   | bulk attributes                  | For `bind="object"`; preserve the expression and precedence rules.                              |
| ámbito, scope                         | scope                            | “Scoped styles” for estilos con ámbito; “scope attribute” for atributo de ámbito.               |
| ciclo de vida                         | lifecycle                        | One word.                                                                                       |
| montar, desmontar                     | mount, unmount                   | Distinguish unmounting from disposing a reactive root.                                          |
| liberar recursos, limpieza            | dispose of resources, cleanup    | Use “dispose” for a root and “cleanup” for a registered callback.                               |
| renderizar, pintar                    | render                           | Avoid literal “paint” unless describing browser painting.                                       |
| renderizado en servidor               | server-side rendering (SSR)      | Expand on first use when helpful; keep SSR uppercase.                                           |
| hidratación, hidratar                 | hydration, hydrate               | Do not imply a second server render.                                                            |
| prerender, prerenderizado             | prerendering, prerendered        | Verb: “prerender”; preserve the configuration value `"prerender"`.                              |
| streaming                             | streaming                        | Preserve the rendering mode `"stream"`.                                                         |
| motor independiente, motor aislado    | standalone engine                | Distinguish the engine from the application framework.                                          |

## Application and server terminology

| Spanish source                     | Preferred English         | Usage                                                                                 |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| aplicación                         | application               | “App” is acceptable in concise instructions.                                          |
| enrutamiento, routing              | routing                   | Use “file-based routing” for rutas por archivos.                                      |
| ruta                               | route / path              | “Route” for a matched endpoint or page; “path” for a filesystem or URL path.          |
| layout                             | layout                    | Do not replace with “template”.                                                       |
| layout con nombre                  | named layout              | Preserve layout names and filenames.                                                  |
| outlet                             | outlet                    | Preserve `<MeekoOutlet>`.                                                             |
| capa, layer                        | layer                     | Preserve the configuration key `layers`.                                              |
| módulo                             | module                    | A Meeko module configures the framework; distinguish a JavaScript module.             |
| plugin                             | plugin                    | Do not replace with “module”; preserve `definePlugin`.                                |
| autoimport, importación automática | auto-import               | Verb: “automatically import”; adjective: “auto-imported”. Preserve `autoimport:` IDs. |
| alias de ruta                      | path alias                | Preserve aliases such as `~/` and `@/`.                                               |
| descubrimiento                     | discovery                 | For routes, imports and manifests.                                                    |
| manifiesto                         | manifest                  | Preserve generated filenames.                                                         |
| entrada cliente/servidor           | client/server entry point | Distinguish from request input.                                                       |
| middleware                         | middleware                | Use “route middleware”, “server route middleware” and “server middleware” distinctly. |
| guarda                             | guard                     | For authorization or validation guards.                                               |
| handler, manejador                 | handler                   | Use “event handler” where appropriate.                                                |
| petición, solicitud                | request                   | Preserve `Request` and `RequestContext`.                                              |
| respuesta                          | response                  | Preserve `Response`; do not confuse a response schema with its payload.               |
| valores por petición               | per-request values        | Preserve `locals` and `services`.                                                     |
| cargador, loader                   | loader                    | Preserve the page loader's server/client restrictions.                                |
| consulta                           | query                     | Distinguish a data query from URL query parameters.                                   |
| mutación                           | mutation                  | Preserve rules about origin checks and retry safety.                                  |
| schema, esquema de validación      | schema                    | Preserve Standard Schema, schema keys and library names.                              |
| canal, sala                        | channel, room             | Distinct Socket concepts; keep the subsystem name “Socket”.                           |
| sesión, store de sesiones          | session, session store    | Do not imply that an in-memory store is persistent.                                   |
| revocación, rotación               | revocation, rotation      | Preserve which operation and session family the source describes.                     |
| origen                             | origin                    | Keep `Origin` for the HTTP header and `origin` for an option.                         |
| despliegue                         | deployment                | Verb: “deploy”.                                                                       |
| build, compilación                 | build / compilation       | “Build” for project output or the build pipeline; “compilation” for compiler work.    |
| adaptador                          | adapter                   | Preserve adapter values such as `node` and `static`.                                  |
| entorno de ejecución               | runtime                   | Preserve specific runtime and product names.                                          |
| contrato público                   | public contract           | Distinguish supported behavior from internal implementation.                          |
| obsoleto, deprecado                | deprecated                | Not “removed”; retain the stated removal version.                                     |
| corrección, patch                  | fix, patch release        | Preserve semantic version numbers and compatibility exceptions.                       |
| valor por defecto                  | default value             | In prose, “by default”; in a table, “Default”.                                        |
| sobrecarga                         | overload                  | Preserve generated type signatures.                                                   |
| comprobación de tipos              | type checking             | Verb: “type-check”.                                                                   |
| inferencia de tipos                | type inference            | Do not strengthen a source claim about inferred types.                                |
| límite actual                      | current limitation        | Keep release-specific qualifications.                                                 |

## Tokens that stay unchanged

Preserve API and macro names (`signal`, `defineProps`, `definePage`, `defineServerRuntime`), type names (`ComponentProps`, `MeekoConfig`), package names and subpaths (`@meekojs/meeko/server`), and symbol IDs (`syntax:bind`, `cli:dev`, `config:server`, `autoimport:useApi`). Backticks distinguish identifiers from prose.

Preserve directives and syntax: `if:when`, `bind:`, `bind`, `on:`, `each:of`, `each:as`, `each:key`, `each:index`, `ref:`, `model`, `model:name`, `html`, `<snippet>`, `<render>` and `<component is>`. Keep the exact source spelling inside examples and identifier titles, including schematic Spanish tokens such as `bind:nombre` or `on:evento`; explain their meaning in English outside the code.

Preserve diagnostic codes (`MEEK001`, `MEEK120`, `TS2322`), error identifiers (`INVALID_ORIGIN`, `INTERNAL_ERROR`), literal diagnostic output, HTTP methods/statuses, environment variables, configuration keys and values, commands/flags, URLs and code paths. Keep `.meeko`, `meeko.config.ts`, `server/runtime.ts`, `.meeko/` and `pnpm -F meeko-site run test` verbatim. See the translation guide for the explicit exception for internal documentation link destinations.

Keep product names and acronyms: Meeko, Meeko DevTools, TypeScript, Vite, Node.js, Bun, Deno, Cloudflare Workers, Durable Objects, Standard Schema, SSR, DOM, API, RPC, CSP, CSRF and ESM.

## Reference section titles

Keep this order. Alternatives in one row are alternatives, not extra sections.

| Spanish heading | English heading | Authorship                                              |
| --------------- | --------------- | ------------------------------------------------------- |
| Uso             | Usage           | Written                                                 |
| Tipo            | Type            | Generated; do not add to the Markdown body              |
| Parámetros      | Parameters      | Written; choose the appropriate heading from this group |
| Props           | Props           | Written                                                 |
| Opciones        | Options         | Written                                                 |
| Atributos       | Attributes      | Written                                                 |
| Valor devuelto  | Return value    | Written                                                 |
| Resultado       | Result          | Written; alternative to Return value                    |
| Ejemplos        | Examples        | Written                                                 |
| Errores comunes | Common mistakes | Written; keep each mistake under `###`                  |
| Notas           | Notes           | Written                                                 |
| Relacionado     | Related         | Generated; do not add to the Markdown body              |

Common table labels: `Nombre` → `Name`, `Tipo` → `Type`, `Por defecto` → `Default`, `Descripción` → `Description`, `Obligatoria` → `Required`, `Valor` → `Value`. Rendered example labels: `Correcto` → `Correct`, `Incorrecto` → `Incorrect`; fence markers remain `good` and `bad`.

At inspection time, `packages/docs-content/src/content/reference.ts` exports Spanish-only `pageSections`. `apps/meeko/tests/reference.test.mjs` checks those titles in order and looks up `Errores comunes` and `Ejemplos` literally. These English headings are the translation convention, not headings already accepted by that validator. The coordinator must localize the renderer and validator before English references are included in their validation. The generated Type and Related labels also need localization.

## Voice and typography

Use clear, direct English and address the reader as “you”. Both Spanish “tú” and “usted” become “you”; do not introduce a formal/informal distinction. Prefer an imperative for instructions: “Run”, “Create”, “Use”. Use present tense for behavior and preserve conditions, warnings, negations and version qualifiers.

Use sentence case in headings: “Create an application”, “Common mistakes”, “Server route middleware”. Preserve API and product capitalization even in headings. Use “English”, “Spanish”, “TypeScript”, “SSR” and “Socket”, but lowercase generic terms such as “component”, “signal” and “plugin”. Avoid promotional wording or adding claims absent from the source.

Use “must” for requirements, “can” for capabilities and “may” for possibilities. Keep distinctions such as “only on the server”, “by default”, “since 1.8”, “deprecated” and “planned for 2.0” explicit. Translation must not change a security requirement or turn a planned behavior into a current feature.
