---
title: meeko clean
group: commands
since: 1.1.0
description: Borra lo que genera Meeko en un proyecto (.meeko/ y la caché de Vite) y, con --all, también node_modules, sin seguir nunca enlaces.
symbols:
  - "cli:clean"
related:
  - "cli:dev"
  - "cli:build"
  - docs/framework.md#limpiar-el-proyecto
---

`meeko clean` devuelve un proyecto a su estado de origen: borra `.meeko/` (tipos, entradas, manifiestos, builds y los `tsconfig.*` generados) y la caché de Vite en `node_modules/.vite`. Con `--all` borra además `node_modules` entero. Nada más: los archivos de la aplicación, `.env`, `package.json` y los lockfiles nunca se tocan.

Sólo actúa sobre un proyecto Meeko y borra una lista fija de rutas dentro de él, sin entrar nunca en un enlace simbólico o una junction: es seguro con `link:` de pnpm y con `npm link`.

## Uso

```sh
meeko clean --dry-run
```

```text
Se borraría .meeko (90 archivos, 942.0 KiB)
Se borraría node_modules/.vite (2 archivos, 169 B)
Se liberarían 942.1 KiB en C:\proyectos\tienda (simulación: no se ha borrado nada)
```

```sh
meeko clean
```

```text
Borrado .meeko (90 archivos, 942.0 KiB)
Borrado node_modules/.vite (2 archivos, 169 B)
Liberados 942.1 KiB en C:\proyectos\tienda
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `[directorio]` | ruta | `.` | Raíz del proyecto. Debe tener `meeko.config.*` o `@meekojs/meeko` en `dependencies` o `devDependencies`. |
| `--all` | bandera | no | Borra `node_modules` entero en lugar de sólo `node_modules/.vite`. |
| `--dry-run` | bandera | no | Mide lo que se borraría, sin borrar nada. |

Las dos banderas pueden ir en cualquier orden y posición después de `clean`: `meeko clean --all --dry-run .` es válido. No hay más: `--force` da `Opción desconocida para clean: --force`.

## Resultado

| Línea | Salida | Cuándo |
| --- | --- | --- |
| `Borrado <ruta> (N archivos, M enlaces (sin seguir), tamaño)` | estándar | Cada ruta borrada. `Se borraría …` con `--dry-run`; `Borrado en parte …` si algo falló dentro. |
| `Liberados <tamaño> en <proyecto>` | estándar | Al terminar. Con `--dry-run`, `Se liberarían … (simulación: no se ha borrado nada)`. |
| `Nada que limpiar en <proyecto>` | estándar | Si ninguna de las rutas existe. |
| `Omitido <ruta>: <motivo>` | errores | Una ruta cuya carpeta padre es un enlace, como `node_modules/.vite` con `node_modules` enlazado. |
| `No se puede borrar <ruta>: <mensaje>` | errores | Un archivo que sigue bloqueado tras los reintentos. |

El código de salida es `0` salvo que algo no se pudiera borrar o el directorio no se admita, que es `1`.

## Ejemplos

### Reinstalar desde cero

```sh
meeko clean --all
pnpm install
```

Los enlaces de `node_modules` (los de pnpm, o `node_modules/@meekojs/meeko` con `link:`) se borran como enlaces: el repositorio al que apuntan queda intacto. El informe los cuenta aparte, como `4 enlaces (sin seguir)`.

### Antes de un build limpio en CI

```sh
npx meeko clean
npx meeko build
```

Útil cuando una caché de CI restaura un `.meeko/` de otra rama. `meeko build` vacía su carpeta de salida en cada ejecución, pero no borra los tipos ni los manifiestos de rutas que ya no existen.

### Ver cuánto ocupa lo generado

```sh
meeko clean --all --dry-run
```

```text
Se borraría .meeko (90 archivos, 942.0 KiB)
Se borraría node_modules (2 archivos, 4 enlaces (sin seguir), 169 B)
Se liberarían 942.1 KiB en C:\proyectos\tienda (simulación: no se ha borrado nada)
```

El tamaño sólo cuenta los archivos que se borrarían, no el destino de los enlaces.

## Errores comunes

### Ejecutarlo fuera de un proyecto

```sh bad
cd ..
meeko clean
```

```text
Meeko no limpia C:\proyectos: no es un proyecto Meeko (no tiene meeko.config.ts ni @meekojs/meeko en dependencies o devDependencies de package.json)
```

El comando se niega antes de medir nada, con código `1`. También rechaza la raíz de una unidad (`es la raíz del sistema de archivos`) y la carpeta personal del usuario o cualquiera que la contenga.

```sh good
meeko clean tienda
```

### Esperar que borre otras carpetas de build

```sh bad
meeko clean --force dist
```

`Opción desconocida para clean: --force`. Y sin la bandera, `dist/` tampoco se borraría: la lista de rutas es fija (`.meeko`, `node_modules/.vite` y, con `--all`, `node_modules`).

```sh good
meeko clean
rm -rf dist
```

### Una ruta mal escrita

```sh bad
meeko clean ./tiend
```

`No se puede limpiar C:\proyectos\tiend: el directorio no existe`, con código `1`. Apuntar a la carpeta personal da `Meeko no limpia C:\Users\ana: es la carpeta personal del usuario o la contiene`.

```sh good
meeko clean ./tienda
```

### Limpiar mientras `meeko dev` sigue en marcha

```sh bad
# con meeko dev corriendo en otra terminal
meeko clean
```

El borrado no falla, pero `meeko dev` escribe `.meeko/` sólo al arrancar: el servidor sigue respondiendo con los módulos que ya tenía en memoria, sin las entradas en disco, y `.meeko/types/` queda vacío para el editor y para `tsc` hasta el siguiente `meeko dev` o `meeko check`.

```sh good
# Ctrl+C en meeko dev
meeko clean
meeko dev
```

## Notas

- **Seguridad.** El directorio se resuelve a su ruta real; cada ruta borrada debe estar dentro de él, y una ruta cuya carpeta padre es un enlace a otro sitio se omite con aviso. Los enlaces y las junctions se borran como enlaces, sin entrar.
- **Windows.** Los bloqueos transitorios de Windows (`EBUSY`, `EPERM`, `EACCES`, `ENOTEMPTY`, típicos de antivirus e indexadores) se reintentan cinco veces con espera creciente (de 50 a 800 ms). Los archivos de sólo lectura se desbloquean antes de borrarlos. Una junction se elimina con `rmdir` sin recursión, que sólo quita el punto de reparación.
- **POSIX.** Los enlaces simbólicos se eliminan con `unlink`, sin seguirlos.
- **Qué no borra.** `.env`, los lockfiles, `package.json`, `public/`, `dist/` y cualquier otra carpeta. Para un monorepo, ejecútalo en cada aplicación.
- **Rendimiento.** Borra por lotes de 32 archivos en paralelo. `--dry-run` recorre el árbol entero para medirlo, así que en un `node_modules` grande también tarda.
- **Sin nada que borrar.** Si no existe ninguna de las rutas, imprime `Nada que limpiar en <proyecto>` y termina con código `0`.
