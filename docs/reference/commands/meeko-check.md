---
title: meeko check
group: commands
since: 1.0.0
description: Comprueba un proyecto completo, o un solo componente .meeko, con los diagnósticos de Meeko y TypeScript, y genera los tipos de .meeko/.
symbols:
  - "cli:check"
related:
  - "cli:check-app"
  - "cli:build"
  - "cli:routes"
  - "cli:types"
  - "cli:lsp"
  - docs/framework.md#autoimports-y-typescript
  - docs/framework.md#tipos-de-los-servicios
  - docs/editors.md#comprobación-del-proyecto
---

`meeko check` es la comprobación completa de una aplicación: la que debe pasar en CI antes de `meeko build`. Con un directorio (por defecto, el actual) genera lo mismo que `meeko dev` en `.meeko/` (entradas, manifiestos, declaraciones de rutas, contratos, autoimports, componentes y, desde `1.7`, `.meeko/types/services.d.ts`), comprueba cada `.meeko` de la aplicación y sus contratos de props y después ejecuta TypeScript sobre los tres proyectos generados: `app`, `server` y `shared`.

Con un archivo `.meeko` comprueba sólo ese componente: su sintaxis, sus directivas y sus tipos, como el editor. Desde `1.7`, en una aplicación da también lo que antes sólo daba el proyecto: `MEEK044` (un `<script server>` fuera de `app/pages`), `MEEK100` (`generic` en una página o un layout) y los errores de tipos de su `<script server>`, opciones de ruta incluidas. Si el proyecto ya tiene `.meeko/types`, los regenera antes, así que ve un layout creado después del último `meeko check .`.

## Uso

```sh
meeko check
```

```text
C:\proyectos\tienda: OK
```

La línea `OK` lleva la ruta absoluta del proyecto. El starter lo declara como `"check": "meeko check ."`.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `[directorio]` | ruta | `.` | Raíz del proyecto que se comprueba. Se lee su `.env` antes de cargar `meeko.config.ts`. |
| `[componente.meeko]` | ruta | ninguno | En lugar de un directorio: comprueba sólo ese componente. Una ruta que no es un directorio existente se trata como un componente. |
| `--json` | bandera | no | Sólo con un componente, y siempre después de él: imprime los diagnósticos como un array JSON en la salida estándar. |

## Resultado

| Caso | Salida estándar | Salida de errores | Código |
| --- | --- | --- | --- |
| Proyecto sin errores | `<ruta absoluta>: OK` | Los avisos (`aviso MEEKxxx`), si los hay | `0` |
| Proyecto con errores en un `.meeko` | | Todos los diagnósticos, avisos incluidos, como `archivo:línea:columna CÓDIGO: mensaje` | `1` |
| Proyecto con errores en un `.ts` | | `Falló la comprobación con TypeScript (<tsconfig>):` y la salida de `tsc` | `1` |
| Componente sin errores | `<ruta>: OK` | Los avisos | `0` |
| Componente con errores | | Los diagnósticos | `1` |
| Componente con `--json` | El array de diagnósticos | | `1` si hay algún error |

Cada diagnóstico de un `.meeko` apunta al archivo original, con su línea y su columna:

```text
C:\proyectos\tienda\app\components\Greeting.meeko:3:7 TS2322: Type 'string' is not assignable to type 'number'.
C:\proyectos\tienda\app\components\Greeting.meeko:3:23 aviso MEEK101: props.name se lee una sola vez porque el setup se ejecuta una sola vez: …
```

El orden de un proyecto es: la configuración, la migración de `server/session.ts`, los archivos generados, los `.meeko` (si alguno tiene errores se detiene ahí) y, por último, TypeScript con `.meeko/tsconfig.app.json`, `tsconfig.server.json` y `tsconfig.shared.json`, uno tras otro.

## Ejemplos

### En CI

```yaml
# .github/workflows/ci.yml
- run: npm ci
- run: npx meeko check
- run: npx meeko build
```

`.meeko/` está en el `.gitignore` del starter: `meeko check` lo genera en cada ejecución, así que no hace falta versionarlo ni cachearlo. `meeko build` vuelve a comprobar el proyecto antes de construir; con los dos pasos separados, el log dice en qué fase falló.

### Diagnósticos en JSON para una herramienta

```sh
meeko check app/components/Greeting.meeko --json
```

```json
[{"code":"TS2322","message":"Type 'string' is not assignable to type 'number'.","filename":"C:\\proyectos\\tienda\\app\\components\\Greeting.meeko","location":{"offset":72,"line":3,"column":7}},{"code":"MEEK101","message":"props.name se lee una sola vez…","filename":"…","location":{"offset":88,"line":3,"column":23},"severity":"warning"}]
```

Un error no lleva `severity`; un aviso lleva `"severity": "warning"`. `offset` cuenta caracteres desde el principio del `.meeko`.

### Un error de TypeScript fuera de los componentes

Los `.ts` de `server/`, `shared/` y `app/` se comprueban con su proyecto generado:

```text
Falló la comprobación con TypeScript (C:\proyectos\tienda\.meeko\tsconfig.server.json):
server/api/health.get.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.
```

En los diagnósticos de un `<script server>`, la ruta es la de la página, en la misma línea y columna.

### Regenerar los tipos para el editor

Tras crear una página o un endpoint, `to="/nueva"` de `<MeekoLink>` o `api.nuevo.get()` son errores de tipos hasta que se regeneran las declaraciones:

```sh
meeko check
```

Si sólo quieres las declaraciones, sin esperar a TypeScript, usa [`meeko routes`](/docs/reference/meeko-routes); el editor también las regenera al guardar en un workspace de confianza.

## Errores comunes

### `--json` con un proyecto

```sh bad
meeko check . --json
```

`--json sólo está disponible para un componente .meeko`, con código `1`. Antes del componente (`meeko check --json`) el error es `--json va después del componente .meeko de check`.

```sh good
meeko check app/pages/index.meeko --json
```

### Una ruta que no existe

```sh bad
meeko check ./tiend
```

Desde `1.7`, una ruta que no termina en `.meeko` es un proyecto, y el error lo dice: `No existe el directorio ./tiend (…\tiend)`, con código `1`. Una que termina en `.meeko` y no existe da `No existe el archivo …`. Hasta `1.6`, cualquier ruta que no fuera un directorio se trataba como un componente y el error era `ENOENT: no such file or directory, open '…\tiend'`.

```sh good
meeko check ./tienda
```

### Ejecutarlo desde una subcarpeta

```sh bad
cd app
meeko check
```

`meeko check` busca `app/pages` dentro del directorio y falla con `ENOENT: no such file or directory, scandir '…\app\app\pages'`.

```sh good
meeko check ..
```

### Un componente suelto sin `@types/node`

Fuera de un proyecto con `tsconfig.json`, el componente se comprueba con las opciones por defecto, que incluyen los tipos de Node:

```sh bad
# Card.meeko en una carpeta sin node_modules
meeko check Card.meeko
```

```text
Falló la comprobación con TypeScript 7: error TS2688: Cannot find type definition file for 'node'.
```

```sh good
# dentro de un proyecto con @types/node instalado
meeko check app/components/Card.meeko
```

### Confiar en `meeko check-app` como comprobación completa

```sh bad
meeko check-app .
```

`check-app` sólo comprueba los `.meeko`: un error de tipos en `server/api/*.ts` o en `shared/` no lo detiene (imprime `.: OK`).

```sh good
meeko check .
```

## Notas

- **Qué no comprueba.** `meeko.config.ts` sólo se comprueba con TypeScript cuando su validación falla al cargarlo; una clave desconocida, como `sitemapp: true`, no da error. Tampoco ejecuta los loaders ni prerenderiza: un `prerenderEntries` que falta en una ruta dinámica sólo lo detecta `meeko build`.
- **`.env`.** Se lee antes de cargar la configuración, porque `meeko.config.ts` y `server/runtime.ts` pueden leer variables del proyecto. El entorno real gana.
- **Tipos de los servicios.** Desde `1.7` genera `.meeko/types/services.d.ts`, que infiere el tipo de `context.services` del export por defecto de `server/runtime.ts`; si el runtime usa `defineServerRuntime` autoimportado, escribe también una copia con los imports en `.meeko/types/server-runtime.ts`.
- **Rendimiento.** Lo más lento es TypeScript 7 (`tsc` nativo), que se ejecuta en procesos hijos, en serie: uno por cada `.meeko` de la aplicación y, después, uno por cada proyecto (`app`, `server` y `shared`). El tiempo crece con el número de componentes. Comprobar un solo componente lanza un único `tsc` sobre ese componente y sus imports, y es lo que conviene en un hook de pre-commit sobre los `.meeko` cambiados.
- **Windows y POSIX.** Las rutas de los diagnósticos son las del sistema: con `\` en Windows. Los mensajes de `tsc` usan rutas relativas al proyecto con `/`.
- **Avisos.** Los avisos (`MEEK101`, `MEEK109`…) no cambian el código de salida, pero siempre se imprimen, también junto a los errores.
