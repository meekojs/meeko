---
title: meeko doctor
group: commands
since: 1.8.0
description: Inspecciona el entorno local del proyecto (Node, paquetes, configuración, artefactos de .meeko/ y servidor de lenguaje) sin ejecutar su código, leer .env ni modificar archivos.
symbols:
  - "cli:doctor"
related:
  - "cli:check"
  - "cli:routes"
  - "cli:lsp"
  - docs/doctor.md
---

`meeko doctor` revisa lo que necesitan `meeko check`, el editor y `meeko dev` para arrancar: la versión de Node, el `package.json`, qué versión de cada paquete de Meeko y de sus herramientas resuelve desde el proyecto, la configuración, los artefactos básicos de `.meeko/` y el servidor de lenguaje del proyecto. Imprime un informe legible o, con `--json`, el mismo informe estructurado para adjuntarlo a una incidencia.

La inspección es estática: lee `meeko.config.*` sin ejecutarlo, no carga `.env`, no importa módulos, no lanza el LSP, no se conecta a servicios y no escribe ningún archivo. Comprueba presencia y resolución; para validar el proyecto completo usa [`meeko check`](/docs/reference/meeko-check).

## Uso

```sh
meeko doctor .
```

```text
Meeko doctor — C:\proyectos\tienda
Proyecto: application · Node 24.22.3

OK Node 24.22.3; Meeko requiere Node 24 o superior.
OK package.json válido.
OK Meeko 1.9.0 resuelve desde el proyecto.
OK Configuración leída estáticamente: los módulos importados, las funciones y sus opciones no se ejecutan.
OK Los artefactos básicos de .meeko están presentes; esto no garantiza que estén actualizados.
OK Servidor de lenguaje del proyecto disponible.

Paquetes:
  @meekojs/meeko: 1.9.0
  @meekojs/ui: 1.9.0
  typescript: 7.0.2
  vite: 8.3.8

La elección efectiva del editor depende de la confianza del workspace y de su configuración; este informe no consulta ni modifica VS Code.
No se ejecutaron módulos ni configuración, no se cargó .env y no se modificó ningún archivo.
```

`Paquetes` sólo enumera los que resuelven desde el proyecto, entre `@meekojs/meeko`, `@meekojs/ui`, `@meekojs/i18n`, `@meekojs/eslint-plugin`, `@meekojs/prettier-plugin`, `typescript`, `vite`, `eslint` y `prettier`.

## Opciones

| Opción         | Tipo    | Por defecto | Descripción                                                                                       |
| -------------- | ------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `[directorio]` | ruta    | `.`         | Raíz de la aplicación o del workspace que se inspecciona.                                         |
| `--json`       | bandera | no          | Imprime el informe como JSON en lugar del texto legible. Puede ir antes o después del directorio. |

No hay más opciones: `--verbose` da `Opción desconocida para doctor: --verbose`, con el uso y código `1`.

## Resultado

Cada comprobación es una línea `OK`, `AVISO` o `ERROR`. `AVISO` señala un estado que puede ser normal, como un proyecto aún sin preparar o una herramienta opcional sin instalar; `ERROR`, un requisito incumplido.

| Comprobación (`id`) | `OK`                                                                                          | Si falla                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `node`              | Node 24 o superior                                                                            | `ERROR`                                                                |
| `manifest`          | `package.json` es JSON válido                                                                 | `AVISO`                                                                |
| `meeko`             | `@meekojs/meeko` resuelve desde el directorio                                                 | `AVISO`: instala dependencias o construye el workspace                 |
| `config`            | La configuración se lee estáticamente, o no hay archivo                                       | `AVISO`, sin repetir el error, que podría contener secretos            |
| `generated`         | Existen los `tsconfig.*.json`, `types/routes.d.ts` y `generated/entry-client.ts` de `.meeko/` | `AVISO`. Sólo se comprueba si el directorio tiene `app/`               |
| `language-server`   | El paquete `@meekojs/meeko` del proyecto incluye `meeko-language-server`                      | `AVISO`: el editor puede recurrir al servidor incluido en su extensión |

| Caso                    | Salida                                                            | Código |
| ----------------------- | ----------------------------------------------------------------- | ------ |
| Sin `ERROR`             | El informe en la salida estándar, aunque haya avisos              | `0`    |
| Con algún `ERROR`       | El informe en la salida estándar                                  | `1`    |
| El directorio no existe | `No existe el directorio <ruta absoluta>` en la salida de errores | `1`    |

Con `--json`, el informe tiene `schemaVersion: 1`, `root`, `node`, `projectKind` (`application`, `workspace` o `unknown`), `packageManager` si el `package.json` lo declara, `packages` (nombre, versión, carpeta, entrada y servidor de lenguaje de cada uno), `config` (`mode: "static"`, el archivo y los nombres de `modules` y de `extends` y `layers`), `generated` (cada artefacto con `exists`), `languageServer`, `checks` (`id`, `status` y `message`) y `ok`, que es `false` si alguna comprobación es `error`.

```json
{
	"schemaVersion": 1,
	"root": "C:\\proyectos\\tienda",
	"node": "24.22.3",
	"projectKind": "application",
	"packageManager": "pnpm@12.14.0",
	"checks": [{ "id": "node", "status": "ok", "message": "Node 24.22.3; Meeko requiere Node 24 o superior." }],
	"ok": true
}
```

El extracto omite `packages`, `config`, `generated` y `languageServer`.

## Ejemplos

### Antes de abrir una incidencia

```sh
pnpm exec meeko doctor . --json > doctor.json
```

El JSON no incluye valores de `.env`, opciones de los módulos ni contenido de catálogos, pero sí rutas absolutas del equipo: revísalo antes de adjuntarlo.

### Una aplicación dentro de un monorepo

```sh
pnpm exec meeko doctor apps/tienda
```

Inspecciona `apps/tienda` y resuelve los paquetes desde esa carpeta, como lo haría la aplicación.

### En CI, sólo como requisito de Node

```sh
meeko doctor . && meeko check .
```

`doctor` sólo falla con un `ERROR`, que hoy es una versión de Node inferior a 24; la comprobación del proyecto la hace `meeko check`.

## Errores comunes

### Tomar un `AVISO` de artefactos por un fallo

```sh bad
meeko doctor . || echo "proyecto roto"
```

`AVISO Faltan artefactos de .meeko; …` no cambia el código de salida, que sigue siendo `0`. Los artefactos se generan al preparar el proyecto:

```sh good
meeko routes .
```

### Esperar que valide los tipos

```sh bad
meeko doctor .
```

Con un error de tipos en una página, `doctor` imprime `OK` en todas sus líneas: sólo comprueba que los archivos de `.meeko/` existen, no que estén actualizados ni que el código compile.

```sh good
meeko check .
```

### Un directorio que no existe

```sh bad
meeko doctor ./tiend
```

`No existe el directorio C:\proyectos\tiend` en la salida de errores y código `1`, sin informe.

```sh good
meeko doctor ./tienda
```

## Notas

- **Sin ejecutar código.** `meeko.config.*` se lee como texto: un módulo importado, una función o una expresión dinámica no se ejecutan ni aparecen como cargados en `modules`.
- **Servidor de lenguaje.** Informa del servidor que el proyecto tiene disponible, no del que ejecuta el editor: eso depende de la confianza del workspace y de los ajustes de VS Code. Véase [Editores](/docs/editors).
- **Texto en español.** `OK`, `AVISO`, `ERROR` y los mensajes son la salida literal de la CLI. En un script, lee `checks[].id` y `checks[].status` del JSON en lugar del texto, que puede mejorar en cualquier versión.
- **Windows y POSIX.** Las rutas del informe usan el separador del sistema.
