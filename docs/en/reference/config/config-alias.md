---
title: alias
group: config
since: 1.5.0
description: Custom path aliases, or changes to ~/, @/, #shared/ and #server/, used in Vite, generated tsconfig files, the editor and @utilities.
symbols:
  - "config:alias"
related:
  - "config:imports"
  - "config:layers"
  - docs/framework.md#aliases-de-ruta
  - docs/framework.md#aliases-propios-alias
  - docs/framework.md#ámbitos-de-los-aliases
  - docs/framework.md#prioridad-y-conflictos-de-los-aliases
source-hash: 0ce36edbc60791882c13fbff2b38e6c52264506025a3aad9e140d620cd3db9fb
---

Without configuration, Meeko defines four path aliases: `~/` (the project root), `@/` (`app/`), `#shared/` (`shared/`) and `#server/` (`server/`, only in server code). `alias` adds your own or changes these: each key is a prefix ending in `/` and each value is a project folder or `false` to remove the alias.

An alias inherits the scope of its target folder, like auto-imports: an alias pointing to `server/` only exists in server code.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  alias: {
    "ui/": "app/components/ui/",
    "db/": "server/db/",
    "#server/": false,
  },
});
```

<!-- no-check -->

```ts
// a .ts file in app/
import { Button } from "ui/Button";
```

## Options

| Value   | Type                              | Default                     | Description                                                                            |
| ------- | --------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `alias` | `Record<string, string \| false>` | `{}` (only Meeko's aliases) | Prefix → folder relative to the project root (including a layer's folder), or `false`. |

- **Key.** Ends in `/`; no spaces, `*` or `\`; does not start with `.` or `/`; no `//`.
- **Value.** A relative path inside the project, or `false`. A nonexistent folder is not an error: the import fails at resolution time.

## Result

| Target                                       | Where you can use it                                      |
| -------------------------------------------- | --------------------------------------------------------- |
| Inside `server/`                             | Only in server code; in a component or `app/`, `MEEK108`. |
| Inside `app/`                                | In `app/` and on the server; in `shared/`, `MEEK118`.     |
| Another folder (`shared/`, the root, `lib/`) | Throughout the project.                                   |

It applies in Vite (`meeko dev`, `meeko build` and all adapters), the `tsconfig` files Meeko generates (used by `meeko check` and the editor), the language server and `@utilities` modules. A custom alias points exactly to its folder; it does not search layers like Meeko's aliases. Changing a Meeko alias (`"@/": "src/"`) makes it a custom alias, with the scope of its new folder.

## Examples

### A design folder

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ alias: { "ui/": "app/components/ui/" } });
```

```html
<script lang="ts">
import * as Dialog from "ui/Dialog.meeko";
</script>
```

### Free `#shared/` for Node _subpath imports_

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

// package.json declares "imports": { "#shared/*": "./lib/shared/*.js" }
export default defineMeekoConfig({ alias: { "#shared/": false } });
```

Without this, Meeko detects the conflict, yields the prefix to `package.json` and warns once per process.

### A project with `src/`

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ alias: { "@/": "src/" } });
```

If `tsconfig.json` already had `"@/*": ["./src/*"]`, declare it here too: Vite does not read TypeScript `paths`.

## Common mistakes

### A key without a trailing `/`

```ts bad
export default defineMeekoConfig({ alias: { "@ui": "app/components/ui/" } });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: alias "@ui" debe ser un prefijo que termine en / (como "@/", "~/" o "lib/"), sin espacios, * ni \, y que no empiece por . ni /`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ alias: { "@ui/": "app/components/ui/" } });
```

### A folder outside the project

```ts bad
export default defineMeekoConfig({ alias: { "ui/": "../design-system/src/" } });
```

`…/meeko.config.ts: alias "ui/" debe ser una ruta relativa dentro del proyecto (su carpeta o la de un layer): ../design-system/src/`. For code from another repository, install it as a package.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ alias: { "ui/": "layers/design/app/components/" } });
```

### A server alias in a component

```html bad
<script lang="ts">
import { db } from "db/client"; // "db/": "server/db/"
</script>
```

`meeko check`, the editor and the browser build report `MEEK108`, even with `import type`. For a server type, use `~/server/…`.

```html good
<script server lang="ts">
import { db } from "db/client";
export const total = await db.orders.count();
</script>
```

## Notes

- **`meeko.config.ts`.** Node loads the configuration without Vite: neither it nor its imported modules can use aliases.
- **Editor.** In an untrusted workspace, the editor reads `alias` without executing the configuration only if it is an object literal containing strings and `false`; otherwise, it uses the default aliases.
- **Priority.** A `paths` pattern in `tsconfig.json` or a Vite `resolve.alias` covering a Meeko prefix disables it, with a warning; a `#…` entry in `package.json` `imports` also wins.
- **Packages.** Modules in `node_modules` never receive project aliases.
