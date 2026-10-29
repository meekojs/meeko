---
title: defineMeekoConfig
group: macros
since: 1.0.0
description: Declara la configuración de meeko.config.ts con sus tipos (layers, módulos, autoimports, aliases, servidor, CSS, documento, sitemap y tema) sin cambiarla.
symbols:
  - "@meekojs/meeko/framework#defineMeekoConfig"
types:
  - "@meekojs/meeko/framework#MeekoConfig"
related:
  - "@meekojs/meeko/framework#defineMeekoModule"
  - "config:server"
  - "config:layers"
  - "config:modules"
  - "config:imports"
  - "config:theme"
  - docs/framework.md#configuración
  - docs/framework.md#layers
---

`defineMeekoConfig(config)` declara la configuración del proyecto en `meeko.config.ts`. En ejecución devuelve el mismo objeto; su papel es dar tipos y completado a cada clave y conservar los literales (`const T`), para que `server.adapter` siga discriminado y las opciones de cada adaptador se comprueben.

`meeko dev`, `meeko build`, `meeko check`, el plugin de Vite y el servidor de lenguaje leen el export por defecto de `meeko.config.ts`. Cada clave tiene su página en el grupo «Configuración» de esta referencia.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: { adapter: "node", port: 4173 },
  site: "https://example.com",
  sitemap: true,
  theme: true,
});
```

## Parámetros

| Clave | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `layers` | `string[]` | `[]` | Carpetas o paquetes que aportan páginas, componentes, layouts y autoimports. |
| `extends` | `string[]` | `[]` | Alias obsoleto de `layers`. |
| `modules` | módulos, rutas o `[módulo, opciones]` | `[]` | Módulos de Meeko (`defineMeekoModule`). |
| `imports` | `{ appDirs?, sharedDirs?, serverDirs? }` | las carpetas estándar | Carpetas extra de autoimports por ámbito. |
| `alias` | `Record<string, string \| false>` | ninguno | Aliases de ruta propios, además de `~/`, `@/`, `#shared/` y `#server/`. |
| `server` | `{ adapter, … }` | `{ adapter: "node" }` | El adaptador (`"node"`, `"bun"`, `"deno"`, `"cloudflare"` o `"static"`) y sus opciones: `host`, `port`, `contentSecurityPolicy`, `headers`… **`adapter` es obligatorio si declaras `server`.** |
| `css` | `{ scopeAttribute?: "all" \| "matched" }` | `"all"` | Qué elementos reciben el atributo de `<style scoped>`. |
| `document` | `DocumentConfig` | ninguno | `<head>`, `lang` y atributos del documento de toda la aplicación. |
| `dev` | `{ serverLogs? }` | ninguno | Opciones de `meeko dev`. |
| `site` | URL | `MEEKO_PUBLIC_ORIGIN` | Origen público, para el sitemap y las URL absolutas. |
| `sitemap` / `robots` | `boolean` u opciones | `false` | Escriben `sitemap.xml` y `robots.txt` en el build. |
| `theme` | `boolean` u opciones | `false` | Tema claro/oscuro sin parpadeo y `<MeekoThemeToggle>`. |

Un módulo puede añadir su propia clave (su `meta.configKey`), con sus opciones.

## Valor devuelto

El mismo objeto, con su tipo literal. Cambiar `meeko.config.ts` exige reiniciar `meeko dev`.

## Ejemplos

### Layers, módulos y autoimports

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  layers: ["./layers/base"],
  modules: ["@acme/seo", ["./modules/accent", { initial: "teal" }]],
  imports: {
    appDirs: ["app/services"],
    sharedDirs: ["shared/validators"],
    serverDirs: ["server/services", "server/repositories"],
  },
  alias: { "#emails": "./server/emails" },
});
```

### Un sitio estático con CSP

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "static",
    contentSecurityPolicy: { "default-src": ["'self'"], "img-src": ["'self'", "data:"] },
  },
  site: "https://docs.example.com",
  sitemap: { exclude: ["/borradores/*"] },
  robots: { disallow: ["/borradores/"] },
});
```

### Cloudflare Workers

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: { adapter: "cloudflare" },
  css: { scopeAttribute: "matched" },
  document: { lang: "es" },
});
```

## Errores comunes

### `server` sin `adapter`

```ts bad
export default defineMeekoConfig({ server: { port: 3000 } });
```

`meeko check` da `TS2322: Type '{ port: number; }' is not assignable to type 'MeekoServerConfig | undefined'.` con `Property 'adapter' is missing`, y la carga de la configuración falla con `meeko.config.ts: server.adapter debe ser "node", "cloudflare", "deno", "bun" o "static"`.

<!-- no-check -->
```ts good
export default defineMeekoConfig({ server: { adapter: "node", port: 3000 } });
```

### Un adaptador que no existe

```ts bad
export default defineMeekoConfig({ server: { adapter: "vercel" } });
```

`meeko check` da `TS2322: Type '"vercel"' is not assignable to type '"bun" | "cloudflare" | "deno" | "node" | "static"'.` y la misma parada al cargar la configuración.

<!-- no-check -->
```ts good
export default defineMeekoConfig({ server: { adapter: "node" } });
```

### Una clave mal escrita

`defineMeekoConfig` acepta claves que no conoce, porque los módulos añaden las suyas (`meta.configKey`), también sin aumentar `MeekoConfig`: rechazarlas en los tipos rompería configuraciones válidas de `1.x`. La opción mal escrita se ignora, y desde `1.7` la carga de la configuración lo avisa con la clave más parecida: `[meeko] Aviso: meeko.config.ts tiene la clave desconocida "sitmap", que Meeko ignora. ¿Quisiste decir "sitemap"?`. Hasta `1.6` no había ningún aviso.

```ts bad
export default defineMeekoConfig({ sitmap: true });
```

<!-- no-check -->
```ts good
export default defineMeekoConfig({ site: "https://example.com", sitemap: true });
```

## Notas

- **Dónde se ejecuta.** En Node, al cargar la configuración: nunca en el navegador ni en el servidor de producción, que recibe sólo lo que el build escribe en el manifiesto. No importes código de la aplicación en `meeko.config.ts`.
- **Variables de entorno.** `meeko dev`, `build`, `start`, `preview` y `check` leen el `.env` del proyecto antes de cargar la configuración; `MEEKO_PORT` y `MEEKO_HOST` sustituyen a `server.port` y `server.host`.
- **Secretos.** La configuración acaba en el build: los secretos se leen en el servidor, en `server/runtime.ts`, no aquí.
- **Sitemap.** Las URL de `sitemap.xml` son absolutas: con `sitemap` y sin `site` ni `MEEKO_PUBLIC_ORIGIN`, `meeko build` se detiene antes de compilar. `meeko check` no lo comprueba.
- **Sin `defineMeekoConfig`.** Un objeto exportado sin ella también se carga, pero sin tipos ni completado.
