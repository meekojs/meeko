---
title: imports
group: config
since: 1.0.0
description: Auto-import folders in addition to the defaults, each with the scope of its containing folder, app, shared or server.
symbols:
  - "config:imports"
related:
  - "config:alias"
  - "config:layers"
  - docs/framework.md#autoimports-y-typescript
  - docs/framework.md#configuración
source-hash: 51d3aa35c06073c5068971aa494260b27afb0a348d86a7fbfb8e24960bd72b23
---

`imports` adds folders whose exports are auto-imported, in addition to the defaults (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`, `shared/{types,schemas,utils,constants,enums}` and `server/utils`). Each option only accepts folders within its root, and each folder inherits that root's scope, so a `server/` service never reaches a component.

`serverDirs` exists since `1.0`; `appDirs` and `sharedDirs` since `1.3`. Folders are also searched within each layer, with the same relative path.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  imports: {
    appDirs: ["app/services"],
    sharedDirs: ["shared/validators"],
    serverDirs: ["server/services", "server/repositories"],
  },
});
```

## Options

| Option       | Type                | Default | Description                                                                                                                                           |
| ------------ | ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appDirs`    | `readonly string[]` | `[]`    | Since `1.3`. Folders within `app/`, with `app/` scope: components and `.ts` files in `app/`, in the browser and SSR; also server code. Not `shared/`. |
| `sharedDirs` | `readonly string[]` | `[]`    | Since `1.3`. Folders within `shared/`, with `shared/` scope: the entire project.                                                                      |
| `serverDirs` | `readonly string[]` | `[]`    | Folders within `server/`, only for server code: `server/`, `<script server>`, `*.route.ts` and `*.server.ts` sidecars.                                |

Each entry is a relative path starting with its root (`app/…`, `shared/…`, `server/…`), with `/` or `\` and no `.` or `..` segments.

## Result

Each folder is read recursively, in the project and each layer. Only its `.ts` files contribute exports (excluding `*.test.ts`, `*.spec.ts` and `*.d.ts`); `.meeko` files in these folders are not components. The `.client.ts`, `.server.ts` and `.shared.ts` suffixes override the folder's scope. Export names are flat: the subfolder is not added to the name, unlike components (`App/Card.meeko` is `AppCard`). `export function total()` in `app/utils/cart/total.ts` is `total`, not `CartTotal`, and two files that export `total` in a scope are the duplicate name error, even in different folders. `.mts` and `.cts` do not work here: they are read and their names are declared, but using them makes `meeko check` and `meeko build` report `TS2307`, because the import Meeko generates points to `.js`, and the page responds `500` in `meeko dev`; a `.cts` with `export` also reports `TS1287`. Write these files as `.ts`.

- A `type` or `interface` is brought in with `import type`.
- A project export with the name of a framework auto-import (`useRoute`, `useForm`…) takes priority.
- Two files exporting the same name in one scope produce an error naming both.
- A folder already used for auto-imports or inside another listed folder is not read twice.
- `meeko check` and the editor declare names in `.meeko/types/autoimports/`.

## Examples

### Server services without imports

```ts
// server/services/orders.ts
export async function markReady(id: string): Promise<{ id: string; status: "ready" }> {
  return { id, status: "ready" };
}
```

<!-- no-check -->

```ts
// server/api/orders/[id]/ready.post.ts: markReady llega por autoimport
export default defineApiRoute({ params: orderParams, handler: ({ params }) => markReady(params.id) });
```

### Validators shared by the form and API

```ts
// shared/validators/email.ts
export const isCorporateEmail = (value: string): boolean => value.endsWith("@acme.example");
```

`isCorporateEmail` is available in `app/`, `server/` and `shared/` itself.

### A server-only service within `appDirs`

```text
app/services/cart.ts          → app/ (navegador y SSR)
app/services/payments.server.ts → sólo servidor: un componente que lo usa da MEEK108
```

## Common mistakes

### A path outside its root

```ts bad
export default defineMeekoConfig({ imports: { appDirs: ["services"] } });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: imports.appDirs[0] debe ser una ruta relativa dentro de app/: services`; the editor in a trusted workspace marks the entry (`MEEK_CONFIG`).

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ imports: { appDirs: ["app/services"] } });
```

### Use a `serverDirs` service in a component

```html bad
<!-- app/pages/orders.meeko -->
<script lang="ts">
const orders = await listOrders(); // de server/services
</script>
```

`meeko check` reports `MEEK108`: server code cannot reach the browser. Load it in `<script server>` or expose it through an API.

```html good
<script server lang="ts">
export const orders = await listOrders();
</script>
```

### `imports` that is not an object

```ts bad
export default defineMeekoConfig({ imports: ["server/services"] as never });
```

`…/meeko.config.ts: imports debe ser un objeto`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ imports: { serverDirs: ["server/services"] } });
```

## Notes

- **Scopes and security.** Scope prevents a `server/` secret from ending up in the browser bundle: `serverDirs` only exists in server code.
- **Development.** Creating, editing or deleting a `.ts` file in these folders reloads the registry without restarting; changing the `imports` lists requires restarting `meeko dev`.
- **Editor.** In an untrusted workspace, the editor reads all three lists without executing the configuration if they are literal arrays of strings.
