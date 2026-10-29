---
title: loadMeekoConfig
group: advanced
since: 1.0.0
description: Carga y valida meeko.config.ts (o .mts, .js, .mjs) de un proyecto con Node 24 y devuelve la configuración, o {} si no existe.
symbols:
  - "@meekojs/meeko/build#loadMeekoConfig"
types:
  - "@meekojs/meeko/build#MeekoConfig"
related:
  - "@meekojs/meeko/framework#defineMeekoConfig"
  - "@meekojs/meeko/build#buildProject"
  - "config:server"
  - "config:layers"
  - docs/framework.md#configuración
---

`loadMeekoConfig` importa la configuración de un proyecto como lo hacen `meeko dev`, `meeko check` y `meeko build`: busca `meeko.config.ts`, `.mts`, `.js` o `.mjs` en la carpeta, lo importa con el soporte de TypeScript de Node 24 (sin compilar ni empaquetar) y valida los campos que Meeko conoce. Devuelve el export por defecto, o `{}` si el proyecto no tiene configuración.

Sirve para herramientas que necesitan leer la configuración del proyecto: un script de despliegue que mira `server.adapter`, un generador que lee `site`, una prueba.

## Uso

```ts
import { loadMeekoConfig } from "@meekojs/meeko/build";

const config = await loadMeekoConfig(process.cwd());
const adapter = config.server?.adapter ?? "node";
console.log(`adaptador: ${adapter}, sitio: ${config.site ?? "(sin site)"}`);
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `projectRoot` | ruta | obligatorio | Carpeta del proyecto, donde está `meeko.config.*`. |

## Valor devuelto

Una promesa de `MeekoConfig`: el objeto exportado por defecto, tal cual (con `defineMeekoConfig` o sin él). No resuelve los módulos ni los layers, no aplica valores por defecto y no ejecuta los `setup` de los módulos: devuelve lo que escribiste.

| Caso | Resultado |
| --- | --- |
| Sin archivo de configuración | `{}` |
| Un archivo válido | El export por defecto. |
| Varios archivos (`meeko.config.ts` y `.mjs`) | Rechaza con `Error: Hay varios archivos de configuración de Meeko: …` |
| Un campo con un valor no válido | Rechaza con `TypeError: <archivo>: server.adapter debe ser "node", "cloudflare", "deno", "bun" o "static"` y similares. |
| El archivo no se puede importar | Rechaza con `Error: No se puede cargar <archivo>: <error de Node>`, con el original en `cause`. |
| Una clave que ni Meeko ni un módulo leen (desde `1.7`) | Avisa en la salida de errores y la devuelve igual: `[meeko] Aviso: meeko.config.ts tiene la clave desconocida "sitmap", que Meeko ignora. ¿Quisiste decir "sitemap"?`. |
| El export por defecto no es un objeto | Rechaza con `TypeError: <archivo> debe exportar por defecto un objeto de configuración de Meeko`. |

## Ejemplos

### Un script de despliegue que elige el destino

```ts
import { loadMeekoConfig } from "@meekojs/meeko/build";

const config = await loadMeekoConfig(process.cwd());
switch (config.server?.adapter ?? "node") {
  case "cloudflare": console.log("npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc"); break;
  case "static": console.log("rsync -a .meeko/output/static/ servidor:/srv/www/"); break;
  default: console.log("docker build -t tienda .");
}
```

### Comprobar la configuración en una prueba

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMeekoConfig } from "@meekojs/meeko/build";

test("producción declara el sitio público", async () => {
  const config = await loadMeekoConfig(process.cwd());
  assert.match(String(config.site), /^https:\/\//);
});
```

## Errores comunes

### Un valor que no es válido

```ts bad
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ server: { adapter: "node", port: "8080" } });
```

`TypeError: C:\proyectos\tienda\meeko.config.ts: server.port debe ser un entero entre 0 y 65535`. En `meeko check` y `meeko build`, el error empieza además por el `TS2322` del archivo, con su línea y su columna.

```ts good
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ server: { adapter: "node", port: 8080 } });
```

### Dos archivos de configuración

```text bad
meeko.config.ts
meeko.config.mjs
```

`Error: Hay varios archivos de configuración de Meeko: C:\proyectos\tienda\meeko.config.ts, C:\proyectos\tienda\meeko.config.mjs`. Queda uno solo.

```text good
meeko.config.ts
```

### Esperar que rechace una clave mal escrita

```ts bad
export default defineMeekoConfig({ sitemapp: true });
```

`loadMeekoConfig` valida los valores de las claves que conoce y devuelve las demás tal cual: `{ sitemapp: true }` carga y la opción no hace nada. Desde `1.7` lo avisa, una vez por configuración, en la salida de errores: `[meeko] Aviso: meeko.config.ts tiene la clave desconocida "sitemapp", que Meeko ignora. ¿Quisiste decir "sitemap"?`. Con `modules`, el aviso llega al cargar los módulos (`meeko dev`, `meeko build`, `meeko check`), porque sus `meta.configKey` también son claves válidas. Es un aviso y no un error porque esa configuración cargaba en `1.6`; `tsc` no lo detecta, porque el tipo de `defineMeekoConfig` admite las claves de módulos que no aumentan `MeekoConfig`. Hasta `1.6` no había aviso.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ site: "https://example.com", sitemap: true });
```

## Notas

- **Ejecuta código.** Importar la configuración ejecuta `meeko.config.ts` y lo que importa, con Node: úsalo sólo con proyectos de confianza.
- **TypeScript.** Node 24 elimina los tipos al importar: sintaxis de TypeScript que no se puede borrar (`enum`, `namespace` con valores) no funciona en la configuración.
- **Mensajes.** Desde `1.7`, los errores de validación de `meeko.config.ts` y del tema están en español (`server.port debe ser un entero entre 0 y 65535`); los de `document.head`, `document.seo` y `server.contentSecurityPolicy`, que comparten la validación de `useHead` y de la cabecera CSP, siguen en inglés.
- **Variables de entorno.** No lee el `.env`; si la configuración usa `process.env`, cárgalo antes (la CLI lo hace en `dev`, `build`, `start`, `preview` y `check`).
- **Caché.** El contenido del archivo forma parte de la URL del import: si no cambia, Node reutiliza el módulo ya cargado sin volver a ejecutarlo, y si cambia, carga la versión nueva. Los módulos que importa la configuración sí quedan en la caché de Node durante todo el proceso.
