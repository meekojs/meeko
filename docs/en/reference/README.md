---
source-hash: c2ee84a454949feadd5ff49927fa88001cb2a95f3e8c0ec7e0b18f3e459538e8
---

# API reference pages

This folder is the source for the site's `/docs/reference`. It has two parts:

- **`taxonomy.json`**: the sidebar groups (Components, Macros, Composables…) with each symbol, in reading order, and its status. A symbol with `"pending": true` does not yet have a written page: the site links to its page generated from JSDoc, or its `fallback`.
- **`<grupo>/<slug>.md`**: a written page for each symbol. The site merges it with the content generated from source code (`packages/docs-content/src/content/reference.ts`).

The models to follow are [`composables/useform.md`](composables/useform.md), [`components/meekolink.md`](components/meekolink.md) and [`macros/definepage.md`](macros/definepage.md).

## Write a page

1. Choose a pending symbol from `taxonomy.json`.
2. Create `docs/reference/<id del grupo>/<slug>.md`. The slug is the last segment of the URL:
   - if the first symbol has a generated page (an export or `.meeko` syntax), use that page's slug so its URL does not change: `useForm` → `useform`, `<MeekoLink>` → `meekolink`, `ApiError` → `apierror` (check the current `/docs/reference/…` URL);
   - if it does not (a command, a configuration key or a generated client), use the entry's `slug` in `taxonomy.json`: `meeko-dev`, `config-server`.
3. Remove `"pending": true` from the entry.
4. Check with `pnpm -F meeko-site run test` (see [Checks](#checks)).

Verify every claim in the `packages/meeko/src` code and its tests, not just in the guides. Errors in the “Common mistakes” section must be real: copy the `MEEKxxx` code, `TSxxxx` code or message produced by `meeko check`, route discovery, `meeko build` or execution. If you have not seen it fail, do not write it.

## Frontmatter

```yaml
---
title: useForm
group: composables
since: 1.2.0
description: Estado de un formulario en un componente, con una señal por campo y validación con un Standard Schema.
symbols:
  - "@meekojs/meeko/framework#useForm"
types:
  - "@meekojs/meeko/framework#Form"
signature: first
related:
  - "@meekojs/meeko/framework#ClientError"
  - docs/framework.md#formularios-useform
---
```

| Key           | Required | Value                                                                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | yes      | Symbol name as written: `useForm`, `<MeekoLink>`, `meeko dev`.                                                                  |
| `group`       | yes      | The group ID, which is also the folder.                                                                                         |
| `since`       | yes      | Version in which it appeared, such as `1.2.0`. If the JSDoc has `@since`, it must match.                                        |
| `description` | yes      | One line, without links: the page subtitle, `<meta name="description">`, index and `llms.txt`.                                  |
| `symbols`     | yes      | The symbols it documents, by ID (see below). The first belongs to the page and must match its entry in `taxonomy.json`.         |
| `types`       | no       | Additional declarations for the “Type” section, such as interfaces for options or the return value.                             |
| `signature`   | no       | `first`: “Type” shows only the first overload of the first symbol, for functions with internal overloads, such as `definePage`. |
| `related`     | no       | Symbols (by ID) and guide sections (`docs/framework.md#ancla`) for “Related”.                                                   |

### Symbol IDs

| ID                                 | What it is                                                                          | Checked against                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `@meekojs/meeko/framework#useForm` | An export from a public subpath                                                     | The exports in `packages/meeko/package.json#exports`, with TypeScript |
| `syntax:meekolink`                 | `.meeko` syntax: tags, script macros, directives and blocks, by generated page slug | `packages/docs-content/src/content/api-builtins.ts`                   |
| `autoimport:useApi`                | An auto-imported generated client: `api`, `rpc`, `socket`, `useApi`…                | `packages/meeko/src/autoimports.ts`                                   |
| `cli:dev`, `cli:auth hash`         | A CLI command                                                                       | The help text in `packages/meeko/src/cli.ts`                          |
| `config:server`                    | A `meeko.config.ts` key                                                             | The members of `MeekoConfig`                                          |

## Page structure

Below the frontmatter, the page starts with the **description** (one or two paragraphs, without a heading), followed by these `##` sections, in this order and with these titles:

1. **`## Usage`**: the complete, minimal working example (with the file path in a comment on the first line).
2. **Type**: do not write it. The site generates it after “Usage” with the exact signatures and declarations from `symbols` and `types`, so it never falls out of sync with the package.
3. **`## Parameters`**, **`## Props`**, **`## Options`** or **`## Attributes`**: a table with `Type`, `Default` and `Description`. Write the types as the symbol's user sees them; the exact types are in “Type”.
4. **`## Return value`** or, for a tag, command or syntax, **`## Result`**: what it returns or produces (HTML, files, output).
5. **`## Examples`**: real use cases, one per `###`, from simplest to most complex.
6. **`## Common mistakes`**: one `###` per error, each with the incorrect code, why it fails (with the `MEEKxxx` code, `TSxxxx` code or actual message) and the correct version.
7. **`## Notes`**: server or client, SSR, hydration, performance, security and accessibility, in a list with each topic in bold.
8. **Related**: do not write it. The site generates it from `related`.

Within each section you can use `###`, tables, lists and alerts. Do not add other `##` sections.

### “Correct” and “Incorrect” blocks

In “Common mistakes”, mark each block after its language:

````markdown
```html bad
<input model="form.fields.name.value">
```

`meeko check` da `TS2322: …`.

```html good
<input model="form.fields.name">
```
````

`bad` displays the block as “Incorrect” and `good` as “Correct”. Each `###` in “Common mistakes” needs at least one of each; for a file structure, use `text bad` and `text good`.

### Alerts

Use GitHub syntax, which the site renders as an alert:

```markdown
> [!NOTE]
> `meeko check` comprueba `initial` contra la entrada del schema.
```

It supports `[!NOTE]` (note), `[!TIP]` (tip), `[!IMPORTANT]` (important), `[!WARNING]` (warning) and `[!CAUTION]` (caution). Reserve them for information the reader must not miss; everything else goes in “Notes”.

### Checked examples

Non-`bad` ` ```ts ` blocks are compiled with TypeScript against the repository's `@meekojs/meeko` during checks, so they must be self-contained: include imports and do not depend on project files. If a block cannot be self-contained (it uses `valibot`, a generated client such as `api`, or a fragment), write `<!-- no-check -->` on the preceding line. `html` blocks (`.meeko` components) are not compiled: check them with `meeko check` in a project before writing them.

## Checks

```powershell
pnpm -F meeko-site run test
```

`apps/meeko/tests/reference.test.mjs` checks:

- that each symbol in `taxonomy.json` and frontmatter (`symbols`, `types`, `related`) exists in the exports, `.meeko` syntax, auto-imports, CLI or configuration;
- that each page has frontmatter, that its folder, slug and first symbol match its entry in `taxonomy.json`, and that its `since` matches the JSDoc `@since`;
- that each page has the sections in the order above, without “Type” or “Related”, and that each common mistake has a `bad` block and a `good` block;
- that a symbol without a page is marked `pending` and one with a page is not: the pending list can only shrink;
- that `fallback` targets and the guide sections in `related` exist;
- that checkable `ts` blocks compile.

## For language models

The site build publishes [`/llms.txt`](https://meekojs.com/llms.txt), the index with a link and one line for each guide and symbol, and [`/llms-full.txt`](https://meekojs.com/llms-full.txt), the complete guides and reference in Markdown: written pages with their generated “Type” and pending symbols with their JSDoc.
