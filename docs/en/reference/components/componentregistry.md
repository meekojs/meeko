---
title: Registro de componentes
group: components
since: 1.7.0
description: Discovers .meeko components by directory, queries their types and loads them by name.
symbols:
  - "@meekojs/meeko#ComponentRegistry"
  - "@meekojs/meeko#ComponentName"
  - "@meekojs/meeko#ComponentOf"
  - "@meekojs/meeko#ComponentProps"
  - "@meekojs/meeko#ResolvedComponent"
related:
  - "syntax:component-tag"
  - docs/framework.md#autoimports-y-typescript
source-hash: 7e9cabf5fdae4ba415d6462e8126fa46d7885b17bd47f70bb653f5e3287024cf
---

Meeko discovers `.meeko` files in `app/components` without manually importing each module. Declare additional directories in `meeko.config.ts`. The same catalog powers tag auto-imports, the typed registry and a generated loader for loading a component by name.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  components: {
    dirs: [
      { path: "app/components/Form", prefix: "Form" },
      { path: "app/widgets", prefix: "Widget" },
    ],
  },
});
```

`app/components` is always included, even when configuring `components.dirs`. Paths are relative to the project root or each layer. `path` must be a safe relative path; `prefix` is optional, empty by default and, if specified, must start uppercase and contain only letters or numbers. `.meeko` files are discovered in subdirectories; other files do not become registered components.

The name is formed from the prefix plus path segments relative to the chosen directory, in PascalCase. Hyphens and underscores separate words:

| File                                   | Registering directory                | Name             |
| -------------------------------------- | ------------------------------------ | ---------------- |
| `app/components/Button.meeko`          | `app/components`                     | `Button`         |
| `app/components/Form/UserCreate.meeko` | `app/components/Form`, prefix `Form` | `FormUserCreate` |
| `app/components/Form/UserEdit.meeko`   | `app/components/Form`, prefix `Form` | `FormUserEdit`   |
| `app/components/user-menu.meeko`       | `app/components`                     | `UserMenu`       |

If a file belongs to two configured directories in the same source, the most specific directory wins and the file is registered once. Thus, the example's `Form` prefix is not added to the `Form` folder a second time. Across sources, the project wins first, then `extends` and `layers` in Meeko's resolution order, then module contributions. Two different files with the same name within one source produce an error with both paths; change the name or prefix.

An existing module can contribute components with `meeko.addComponentsDir(dir, { prefix: "Accent" })`. These participate in the final catalog without creating another layer system. In an untrusted workspace, the language server reads configuration statically and does not execute modules: it cannot discover components depending on module `setup` there.

## Options

Meeko generates `.meeko/types/components.d.ts` with `ComponentRegistry` entries. Each entry points to the real `.meeko` module. Public types from `@meekojs/meeko` are:

| Type                      | Meaning                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ComponentRegistry`       | Mapping between each registered component's name and module.                                                                                            |
| `ComponentName`           | Union of registered names.                                                                                                                              |
| `ComponentOf<Name>`       | Renderable module corresponding to `Name`, with its public exports.                                                                                     |
| `ComponentProps<Name>`    | Input props extracted from that module's `renderToString` contract.                                                                                     |
| `ResolvedComponent<Name>` | Component with props already associated through `resolveComponent(name, props)`. `Name` is optional for storing different components in the same state. |

<!-- no-check -->

```ts
// app/utils/component-types.ts
type Name = ComponentName; // Por ejemplo: "Button" | "FormUserCreate" | "FormUserEdit"
type FormModule = ComponentOf<"FormUserCreate">;
type FormInput = ComponentProps<"FormUserCreate">;

const known: ComponentName = "FormUserCreate";
// const unknown: ComponentName = "Missing"; // Error de TypeScript.
```

Types follow the contract compiled by `defineProps`, including required and optional props and imported types. `ComponentOf` also retains the module's event, model and snippet exports; `ComponentProps` describes input props. In a `.meeko`'s `<script>`, you can also use `ComponentProps<"FormUserCreate">` without a manual import; the component still exports its own `ComponentProps` type for consumers importing it from the module.

For a generic component, `ComponentOf<Name>` retains exported generic signatures. `ComponentProps<Name>` extracts the input shape without choosing concrete type arguments; for a specialization, use the module's generic contract directly.

For a function receiving names from a union, a tuple union preserves the relationship between each name and its props at the call site:

<!-- no-check -->

```ts
// app/utils/modal-request.ts
function openModal(...request: ComponentArgs): void {
  const [name, props] = request;
  // Entregar name y props al modal de la aplicación.
  void name;
  void props;
}

openModal("FormUserCreate", { name: "Diego", role: "admin" });
// Las props exactas dependen de defineProps en Form/UserCreate.meeko.
```

The `openModal` example only shows argument typing: Meeko does not include a modal system. If the component declares other props, adjust the call to its actual `defineProps`.

## Result

`resolveComponent(name)` is an `app`-scope auto-import pointing to the generated loader in `.meeko/generated/components.ts`. It returns **`Promise<ComponentOf<Name>>`**: await loading before passing the module to `<component is>`. Each loader entry uses `import()` with a literal path so Vite can analyze it and split the component from the initial bundle. An external name is not interpreted as a path: a missing name rejects the promise with `Componente de Meeko no registrado`.

```html
<!-- app/components/Form/UserCreate.meeko -->
<script lang="ts">
const props = defineProps<{ name: string; role: "admin" | "user" }>();
</script>

<template>
  <p>{props.name}: {props.role}</p>
</template>
```

```html
<!-- app/pages/create.meeko -->
<script lang="ts">
const selected = signal<ResolvedComponent<"FormUserCreate"> | undefined>(undefined);

async function showForm(): Promise<void> {
  selected.value = await resolveComponent("FormUserCreate", {
    name: "Diego",
    role: "admin",
  });
}
</script>

<template>
  <button type="button" on:click="showForm">Crear usuario</button>
  <component
    if:when="selected.value"
    is="selected.value!"
  />
</template>
```

The conditional avoids rendering the component before its promise resolves. This example initiates loading through a browser interaction: SSR displays the button, and the component appears after loading on the client. It assumes neither that an unresolved promise can be passed to `is` nor that deferred content appears in SSR HTML. `<component is>` still receives the renderable module, not its name or a promise. For content required in initial HTML, use a component already available during SSR rendering.

The second argument is a `ComponentProps<Name>` object: TypeScript checks required props, names, literals and callbacks against the chosen component. Union names and props must form a valid pair; a name union does not allow mixing props from different components. Each call creates its own association without modifying the shared module or another call's props.

To restrict an API to a subset of the registry, filter `ComponentArgs` and forward the complete tuple. The result retains that subset of names:

<!-- no-check -->

```ts
type ModalName = Extract<ComponentName, `Modal${string}`>;
type ModalArgs = Extract<ComponentArgs, [name: ModalName, props: unknown]>;

async function openModal(...request: ModalArgs): Promise<ResolvedComponent<ModalName>> {
  return resolveComponent(...request);
}
```

Associated values are captured when loading finishes. For values that must change later, use `bind:` in the template: explicit props and events take priority over associated values. Models and snippets still pass through `model`, `model:nombre` and tag content. If the association changes while retaining the same component, props update in the existing instance.

```html
<component
  if:when="selected.value"
  is="selected.value!"
  bind:name="'Otro nombre'"
/>
```

The single-argument form preserves previous behavior: `await resolveComponent("FormUserCreate")` returns the original module, and its props remain required when rendering with `bind:` or `bind="objeto"`.

### A literal in `is` or `resolveComponent`

Since `1.8`, `<component is>` accepts a component name as a PascalCase string literal (`is="big ? 'UICard' : 'section'"`), including `'MeekoLink'`. That name is known when writing the template: the compiler imports it like its tag, without a promise, and it appears in SSR HTML (see [Component names in `is`](../../api.md#component-names-in-is)). `resolveComponent` is for a name known only **at runtime** (from a URL, data, a table) or for lazy-loading a component in its own chunk.

Both use the same names: components from `app/components`, configured directories, modules such as `@meekojs/ui`'s `UI*` and, since `1.8`, `"MeekoLink"`. `resolveComponent("MeekoLink", { to: "/users/[id]", params: { id: "7" } })` loads `<MeekoLink>` as a component, with a props variant per route: `meeko check` requires a dynamic route's `params` and rejects a nonexistent route or an `href`. If the project has its own component named `MeekoLink`, that name refers to it.

## Examples

Creating or deleting a `.meeko` in registered directories makes the Vite plugin rediscover the catalog, regenerate the loader and declarations and reload the page. Editing a registered component regenerates its declaration and those of its `.meeko` imports if changed, without traversing all components; compiler HMR updates the module. Renaming is equivalent to deleting the old entry and creating a new one. Configuration changes may require full discovery. `meeko check` prepares project declarations before checking components. If the editor shows old names, confirm regeneration finished and rerun `meeko check` to see the specific diagnostic.

```powershell
npm run check
```

## Common mistakes

### Unregistered name

```ts bad
// app/utils/component.ts, con ComponentName generado por el proyecto
const name: ComponentName = "Missing";
```

TypeScript rejects the name because it is absent from `ComponentRegistry`.

```text good
// app/utils/component.ts, después de registrar FormUserCreate.meeko
const name: ComponentName = "FormUserCreate";
```

| Symptom                                         | What to check                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Componente de Meeko no registrado`             | Names are case-sensitive; confirm the directory, prefix and generated name. Validate external strings before using them. |
| Duplicate name or ambiguous auto-import         | Two files generate the same name; rename one or change its prefix.                                                       |
| `ComponentName` omits a file                    | Confirm it is `.meeko`, under a registered directory and type generation finished.                                       |
| TypeScript rejects props                        | Compare the call with the component's `defineProps`; `ComponentProps<Name>` does not create new optional props.          |
| `<component is>` receives an incompatible value | Await `resolveComponent(name)` and pass the resulting module, not the promise.                                           |
| The editor cannot see module components         | An untrusted workspace does not execute `setup`; open it as trusted if appropriate.                                      |

## Notes

- The application generates the registry from configured directories and updates it during development.
- `resolveComponent` loads asynchronously; await its result before passing it to `<component is>`.
