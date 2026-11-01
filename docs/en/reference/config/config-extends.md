---
title: extends
group: config
since: 1.0.0
description: The former name of layers, still supported in 1.x without a warning; its folders come before those in layers.
symbols:
  - "config:extends"
related:
  - "config:layers"
  - "config:modules"
  - docs/framework.md#layers
source-hash: 88e21b83f7f325d925630b8fb8fde07802abab1ab1780fc85fff55b58f08c87f
---

`extends` was the name of `layers` through `1.1`. It accepts the same values (project folders with `app/pages`) and applies the same rules, and continues to work throughout `1.x` without a warning. The only difference is the order: its folders come before those in `layers`.

In a new project, use `layers`.

## Usage

```ts
// meeko.config.ts de un proyecto de 1.0 o 1.1
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  extends: ["./layers/base"],
});
```

## Options

| Value     | Type                | Default | Description                                               |
| --------- | ------------------- | ------- | --------------------------------------------------------- |
| `extends` | `readonly string[]` | `[]`    | Project folders with `app/pages`, like those in `layers`. |

## Result

The `extends` folders are added as layers immediately after the application and before the `layers` folders. This order determines which named layout wins when two sources declare it, and the search order for the `~/`, `@/`, `#shared/` and `#server/` aliases.

## Examples

### Migrating to `layers`

```ts
// Antes (1.1)
// export default defineMeekoConfig({ extends: ["./layers/base", "./layers/admin"] });

// Después (1.2 o posterior): el mismo orden.
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./layers/base", "./layers/admin"] });
```

### Using both during a migration

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  extends: ["./layers/legacy"], // primero
  layers: ["./layers/base"],    // después
});
```

## Common mistakes

### The same folder in `extends` and `layers`

```ts bad
export default defineMeekoConfig({ extends: ["./layers/base"], layers: ["./layers/base"] });
```

`Raíz de fuentes de Meeko repetida: <ruta>`: a folder can only be one source.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./layers/base"] });
```

### A folder outside the project

```ts bad
export default defineMeekoConfig({ extends: ["../outside"] });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `layer ../outside sale de la raíz del proyecto <ruta>`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ extends: ["./layers/outside"] });
```

## Notes

- **No warning.** Unlike folders in `modules`, `extends` does not print a warning and is not scheduled for removal in `1.x`.
- **Editor.** Like `layers`, the editor reads it without executing the configuration if it is a literal array of strings.
