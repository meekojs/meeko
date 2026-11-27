---
title: meeko styles
group: commands
since: 1.12.0
description: Escribe .meeko/styles/main.css, la hoja global procesada que mantiene meeko dev, sin arrancar el servidor, para el editor y para meekoSortClasses "stylesheet" en CI.
symbols:
  - "cli:styles"
related:
  - "cli:dev"
  - "cli:check"
  - "cli:clean"
  - docs/framework-configuration.md#hoja-global-procesada-para-el-editor
  - docs/editors.md#orden-por-la-hoja-global
---

`meeko styles` escribe `.meeko/styles/main.css`: la hoja global del proyecto (`app/styles/main.css` con sus `@import`, las hojas que registran los módulos y los plugins de CSS de Vite aplicados) ya procesada, tal como la mantiene `meeko dev`. La leen el editor, para completar las clases que sólo genera el pipeline de CSS, y `meekoSortClasses: "stylesheet"` de Prettier, para ordenarlas.

Usa la misma canalización de Vite que `meeko dev`, con los plugins y `extendViteConfig` de los módulos, pero en un servidor sin puerto, WebSocket ni vigilantes que se cierra al terminar. No genera tipos, no ejecuta TypeScript ni comprueba los `.meeko`. Escribe el archivo de forma atómica (un temporal que se renombra), así que un lector nunca ve media hoja, y sólo lo sustituye si cambia su contenido.

## Uso

```sh
meeko styles
```

```text
C:\proyectos\tienda\.meeko\styles\main.css
```

La salida es la ruta absoluta del archivo escrito. Un proyecto sin hojas de estilos no escribe nada y lo dice:

```text
C:\proyectos\tienda: sin hojas de estilos
```

## Opciones

| Opción         | Tipo | Por defecto | Descripción                                                                              |
| -------------- | ---- | ----------- | ---------------------------------------------------------------------------------------- |
| `[directorio]` | ruta | `.`         | Raíz del proyecto. Se lee su `.env` antes de cargar `meeko.config.ts` y los plugins CSS. |

No hay más opciones.

## Resultado

| Caso                                  | Salida estándar                             | Salida de errores                                                | Código |
| ------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- | ------ |
| Hoja escrita (o ya al día)            | `<ruta de .meeko/styles/main.css>`          |                                                                  | `0`    |
| El proyecto no tiene hojas de estilos | `<ruta del proyecto>: sin hojas de estilos` |                                                                  | `0`    |
| Las hojas no compilan                 |                                             | `[meeko] .meeko/styles/main.css conserva la versión anterior: …` | `1`    |

Sin hojas, el comando borra una `.meeko/styles/main.css` antigua en lugar de dejarla: el orden de Prettier y el completado del editor no deben seguir una hoja que ya no existe. Si las hojas no compilan, conserva la anterior.

## Ejemplos

### Ordenar las clases en CI

`.meeko/` está fuera de Git, así que sin `meeko dev` previo `meekoSortClasses: "stylesheet"` no ve las utilidades de herramientas que se registran como plugin de Vite (como Tailwind con `@tailwindcss/vite`, el caso de `@meekojs/ui`) y ordena distinto que en local. Ejecuta `meeko styles` antes de Prettier:

```yaml
# .github/workflows/ci.yml
- run: npm ci
- run: npx meeko styles
- run: npx prettier --check .
```

`meeko check` también escribe la hoja al terminar bien, con el mismo contenido: un trabajo que ya ejecuta `meeko check` antes de Prettier no necesita este paso. Si sólo formatea, `meeko styles` es la opción barata, porque no comprueba tipos.

### Preparar el editor tras clonar

```sh
git clone https://github.com/ejemplo/tienda.git
cd tienda
npm install
npx meeko styles
```

El editor ofrece como `main.css (global, procesada)` las clases que sólo genera el pipeline de CSS, sin esperar al primer `meeko dev`. Leer la hoja no ejecuta el proyecto, así que también sirve en un workspace no confiable.

## Errores comunes

### Esperar que `meeko build` la escriba

```sh bad
meeko build
prettier --check .
```

`meeko build` no escribe `.meeko/styles/main.css`: el CSS del build está minificado y mezcla la hoja global con los `<style>` de los componentes.

```sh good
meeko styles
prettier --check .
```

### Ignorar el código de salida

```sh bad
meeko styles; prettier --check .
```

Si las hojas no compilan, `meeko styles` avisa y sale con `1`, pero `;` ejecuta Prettier igualmente con la hoja anterior (o sin ella), y el orden depende de lo que hubiera en disco.

```sh good
meeko styles && prettier --check .
```

### Usarlo como comprobación del proyecto

```sh bad
meeko styles
meeko build
```

`meeko styles` sólo procesa las hojas de estilos: no comprueba los `.meeko` ni ejecuta TypeScript, así que un error de tipos en `server/api/*.ts` pasa sin avisar.

```sh good
meeko check
meeko build
```

## Notas

- **Mismo contenido que `meeko dev`.** Para el mismo proyecto escribe lo mismo que `meeko dev`: la misma canalización de Vite, con los plugins de los módulos. El contenido de la hoja sigue a lo que generen Vite y sus plugins y puede cambiar en cualquier versión; su ruta sí se mantiene durante 1.x (véase [la política de estabilidad](../../stability.md#fuera-del-contrato)).
- **Qué hace `meeko clean`.** Elimina `.meeko/styles/main.css` con el resto de `.meeko/`; `meeko styles` la vuelve a escribir.
- **`.env`.** Se lee antes de cargar la configuración y los plugins CSS, que pueden necesitar variables del proyecto, como en `meeko dev`. El entorno real gana.
- **Rendimiento.** Carga Vite y los plugins de CSS del proyecto, pero no genera tipos ni ejecuta TypeScript, así que cuesta menos que `meeko check`.
- **Detalles de la hoja.** El formato, los avisos y cuándo la reescribe `meeko dev` están en [Hoja global procesada para el editor](../../framework-configuration.md#hoja-global-procesada-para-el-editor).
