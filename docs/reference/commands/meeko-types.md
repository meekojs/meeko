---
title: meeko types
group: commands
since: 1.0.0
description: Genera en .meeko/types/ la declaración .d.meeko.ts de un componente y de los componentes que importa, para que TypeScript compruebe sus props.
symbols:
  - "cli:types"
related:
  - "cli:check"
  - "cli:compile"
  - "cli:routes"
  - "cli:init"
  - docs/api.md#herramientas
---

`meeko types` escribe la declaración de tipos de un componente `.meeko` (sus props, eventos, modelos, snippets y lo que expone) y la de cada `.meeko` que importa, de forma recursiva, con imports relativos o por alias de ruta. Las declaraciones van a `.meeko/types/`, con la misma ruta relativa al proyecto y la extensión `.d.meeko.ts`; nunca junto a las fuentes. Imprime la ruta de cada declaración escrita.

Con esas declaraciones, un archivo `.ts` que importa el componente (`import App from "./App.meeko"`) recibe sus props exactas. Es lo que hace el script `check` del starter de [`meeko init`](/docs/reference/meeko-init) antes de `tsc`. En una aplicación del framework no hace falta llamarlo: `meeko check`, `meeko dev` y `meeko routes` generan las de todos los componentes.

## Uso

```sh
meeko types src/App.meeko
```

```text
C:\proyectos\contador\.meeko\types\src\App.d.meeko.ts
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `<componente.meeko>` | ruta | obligatorio | El componente de entrada. El proyecto es la carpeta más cercana con `package.json` o `meeko.config.*`; sus aliases de ruta se aplican a los imports. |

## Resultado

Por cada componente del grafo, `.meeko/types/<ruta relativa>.d.meeko.ts`, que empieza por `// @meeko-generated component-declaration v1` y declara los exports del módulo compilado: `Props` y los tipos del componente, `renderWithState`, `hydrate`, `css`… Los imports relativos a módulos `.ts` se reescriben para que sigan apuntando a las fuentes. Termina con `0`, o con `1` y el error si un componente no compila.

Para que TypeScript use estas declaraciones al importar `./App.meeko`, el `tsconfig.json` necesita `allowArbitraryExtensions` y `rootDirs` que superpongan las fuentes con `.meeko/types/`:

```json
{
  "compilerOptions": {
    "allowArbitraryExtensions": true,
    "rootDirs": ["src", ".meeko/types/src"]
  }
}
```

`meeko init` ya lo escribe así.

## Ejemplos

### Comprobar un consumidor en TypeScript

<!-- no-check -->
```ts
// src/entry-server.ts
import { css, renderWithState } from "./App.meeko";

export function renderPage(initial = 1): string {
  const props = { initial: String(initial) };
  const rendered = renderWithState(props);
  return `<style>${css}</style><div id="app">${rendered.html}</div>`;
}
```

```sh
meeko types src/App.meeko && tsc --noEmit
```

```text
src/entry-server.ts(5,36): error TS2345: Argument of type '{ initial: string; }' is not assignable to parameter of type 'Props'.
  Types of property 'initial' are incompatible.
    Type 'string' is not assignable to type 'number'.
```

Sin las declaraciones, `./App.meeko` no tiene tipos y `tsc` no detecta que `App.meeko` declara `initial: number`.

### Varios componentes de entrada

```sh
meeko types src/App.meeko
meeko types src/Admin.meeko
```

Cada llamada genera el grafo de su componente; un componente compartido se reescribe con el mismo contenido.

## Errores comunes

### Un componente con errores

Antes de generar, `meeko types` comprueba el componente de entrada como `meeko check`: con un error de sintaxis o de tipos no escribe nada.

```html bad
<!-- src/App.meeko -->
<template><p>{count.value</p></template>
```

```text
C:\proyectos\contador\src\App.meeko:1:14 MEEK010: Expresión de plantilla sin cerrar
```

Un error de tipos en el script (`const n: number = "x"`) da igualmente `TS2322` y código `1`.

```html good
<!-- src/App.meeko -->
<script lang="ts">
import { signal } from "@meekojs/meeko";
const count = signal(0);
</script>
<template><p>{count.value}</p></template>
```

### Mayúsculas distintas en Windows

```sh bad
meeko types src/app.meeko   # el archivo es src/App.meeko
```

En Windows y macOS funciona, porque el sistema de archivos no distingue mayúsculas, y desde `1.7` la declaración toma el nombre real del archivo (`.meeko\types\src\App.d.meeko.ts`; hasta `1.6` se escribía como `app.d.meeko.ts`). En Linux y en CI el mismo comando falla con `No existe el archivo src/app.meeko (…)`: escriba el nombre tal como está en el disco.

```sh good
meeko types src/App.meeko
```

## Notas

- **Dónde.** Siempre bajo `.meeko/types/` del proyecto, nunca junto a las fuentes. `.meeko/` va en el `.gitignore`: regenera las declaraciones en CI antes de `tsc`.
- **Huérfanos.** En una aplicación del framework, las declaraciones generadas se registran en `.meeko/manifests/component-types.json` y `meeko check` borra sólo las administradas cuyo componente ya no existe; `meeko types` no borra nada.
- **Componentes de `server/`.** Un `.meeko` bajo `server/` se compila con los autoimports del servidor; el resto, con los del cliente.
- **Rendimiento.** Comprueba sólo el componente de entrada con un `tsc` y después compila cada componente del grafo y emite su declaración sin más comprobaciones.
