---
title: meeko check-app
group: commands
since: 1.0.0
description: Comprueba todos los componentes .meeko de la aplicación y sus layers, sin generar .meeko/ ni comprobar los .ts con TypeScript.
symbols:
  - "cli:check-app"
related:
  - "cli:check"
  - "cli:types"
  - docs/framework.md#aliases-de-ruta
---

`meeko check-app` recorre los `.meeko` de `app/`, `server/` y `shared/` del proyecto y de sus layers y comprueba cada uno como `meeko check <componente>`: sintaxis, directivas, tipos y la posición de los bloques `<script server>`. Además avisa de los archivos `+group.ts` fuera de su sitio y de los imports con alias de un ámbito que no les corresponde (`#server/` en `app/` o `shared/`, `@/` en `shared/`).

Es la primera mitad de [`meeko check`](/docs/reference/meeko-check): no genera `.meeko/`, no lee el `.env` y no ejecuta TypeScript sobre los `.ts` de `server/`, `shared/` y `app/`. Para CI usa `meeko check`; `check-app` sirve para comprobar sólo los componentes.

## Uso

```sh
meeko check-app .
```

```text
.: OK
```

La línea `OK` repite el directorio tal como se escribió, no la ruta absoluta.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `<directorio>` | ruta | obligatorio | Raíz del proyecto. Sin él, `Falta el directorio de check-app`. |

## Resultado

| Caso | Salida | Código |
| --- | --- | --- |
| Sin errores | Los avisos en la salida de errores y `<directorio>: OK` en la estándar | `0` |
| Con errores | Todos los diagnósticos (errores y avisos) en la salida de errores, uno por línea | `1` |
| El directorio no existe (desde `1.7`) | `No existe el directorio <directorio>` en la salida de errores | `1` |

```text
C:\proyectos\tienda\app\components\Greeting.meeko:3:7 TS2322: Type 'string' is not assignable to type 'number'.
C:\proyectos\tienda\app\components\Greeting.meeko:3:23 aviso MEEK101: props.name se lee una sola vez porque el setup se ejecuta una sola vez: …
```

`meeko check` hace lo mismo en su primer paso y, si hay algún error, se detiene ahí con los mismos diagnósticos, antes de ejecutar TypeScript sobre los proyectos.

## Ejemplos

### Sólo los componentes, en un hook

```sh
meeko check-app . || exit 1
```

### Componentes de un layer

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ layers: ["./layers/base"] });
```

```sh
meeko check-app .
```

Comprueba también `layers/base/app/**/*.meeko`, con los autoimports y aliases que tienen en el proyecto.

## Errores comunes

### Tomarlo por la comprobación completa

```sh bad
meeko check-app .
```

Con un error de tipos en `server/api/health.get.ts`, `check-app` imprime `.: OK` y termina con `0`: no ejecuta TypeScript sobre los `.ts`.

```sh good
meeko check .
```

### Un directorio que no existe

```sh bad
meeko check-app ./tiend
```

`No existe el directorio ./tiend (C:\proyectos\tiend)` en la salida de errores y código `1`, sin `OK`. Hasta `1.6` imprimía `./tiend: OK` y terminaba con `0`, porque no distinguía una carpeta que no existe de un proyecto sin errores.

```sh good
meeko check-app ./tienda
```

### Sin el directorio

```sh bad
meeko check-app
```

`Falta el directorio de check-app`, con el uso y código `1`.

```sh good
meeko check-app .
```

## Notas

- **Rendimiento.** Cada componente se comprueba con su propio proceso `tsc`, en serie: en una aplicación con muchos componentes tarda más que el editor, que sólo comprueba los abiertos.
- **Tipos generados.** No regenera `.meeko/types/` (rutas, contratos, autoimports): usa los que ya existan. Tras crear una página o un endpoint, ejecuta antes `meeko routes` o `meeko check`.
- **Sin `.env`.** No lo lee, y tampoco ejecuta el runtime del servidor.
- **Windows y POSIX.** Las rutas de los diagnósticos usan el separador del sistema.
