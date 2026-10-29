---
title: generateOpenApi
group: server
since: 1.0.0
description: Genera un documento OpenAPI 3.1 de los endpoints de API y RPC de la aplicación a partir de un registro explícito de schemas públicos.
symbols:
  - "@meekojs/meeko/server#generateOpenApi"
types:
  - "@meekojs/meeko/server#OpenApiOptions"
related:
  - "@meekojs/meeko/server#defineApiRoute"
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/build#discoverServerManifest"
  - docs/framework.md#api-y-rpc
  - docs/framework.md#build-despliegue-y-verificación
---

`generateOpenApi(options)` recorre el manifiesto de servidor, carga cada endpoint de `server/api` y cada procedimiento de `server/rpc`, y escribe un documento [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) con sus rutas, parámetros, cuerpos, respuestas y seguridad. Sólo publica los schemas que el llamador registra en `publicSchemas`: un contrato que usa un schema fuera del registro es un error, así que ningún schema interno se filtra por accidente.

Es opcional y se ejecuta fuera del servidor, en un script o en CI. Meeko no depende de un conversor: `toJsonSchema` recibe el de la librería de schemas, como `@valibot/to-json-schema`.

## Uso

<!-- no-check -->
```ts
// scripts/openapi.ts
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { toJsonSchema } from "@valibot/to-json-schema";
import { discoverServerManifest } from "@meekojs/meeko/build";
import { generateOpenApi } from "@meekojs/meeko/server";
import type { Schema } from "@meekojs/meeko/server";
import * as schemas from "../shared/schemas/public";

const document = await generateOpenApi({
  manifest: await discoverServerManifest(process.cwd()),
  info: { title: "API de la tienda", version: "1.4.0" },
  publicSchemas: schemas,
  toJsonSchema: (schema: Schema) => toJsonSchema(schema as never),
  load: (file) => import(pathToFileURL(file).href),
});
await writeFile("openapi.json", JSON.stringify(document, null, 2));
```

Ejecútelo con un cargador de TypeScript (`npx tsx scripts/openapi.ts`): `load` importa los `.ts` de `server/`.

## Parámetros

`generateOpenApi(options)` recibe un objeto `OpenApiOptions`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `manifest` | `ServerManifest` | obligatorio | Los endpoints, como los devuelve `discoverServerManifest` de `@meekojs/meeko/build`. |
| `info` | `{ title: string; version: string }` | obligatorio | `info` del documento. |
| `publicSchemas` | `Record<string, Schema>` | obligatorio | Los schemas que se pueden publicar, por nombre: el nombre es la clave de `components.schemas`. Un identificador de JavaScript; una misma instancia no puede aparecer dos veces. |
| `toJsonSchema` | `(schema: Schema) => unknown` | obligatorio | Convierte un schema en JSON Schema; debe devolver un objeto serializable. |
| `load` | `(file: string) => Promise<unknown>` | obligatorio | Carga el módulo de un archivo del manifiesto; su export por defecto es la definición. |
| `cookieName` | `string` | `"__Host-meeko.sid"` | La cookie del esquema de seguridad `sessionCookie`. |

## Valor devuelto

Una promesa con el documento como objeto JSON:

```json
{
  "openapi": "3.1.0",
  "info": { "title": "API de la tienda", "version": "1.4.0" },
  "paths": {
    "/api/users/{id}": {
      "get": {
        "operationId": "users_byId_get",
        "parameters": [{ "in": "path", "name": "id", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "OK", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/userSchema" } } } } }
      }
    }
  },
  "components": {
    "schemas": { "userSchema": { "type": "object" } },
    "securitySchemes": { "sessionCookie": { "type": "apiKey", "in": "cookie", "name": "__Host-meeko.sid" } }
  }
}
```

- **API.** Una operación por método, con `operationId` `<clave del cliente con _>_<método>`. Los segmentos `[id]` pasan a `{id}` y sus schemas salen de `params`; `query` da los parámetros `in: "query"`; `body`, el `requestBody`; `status` (`200`, `201`, `202` o `204`), la respuesta. `auth: "required"` añade `security: [{ sessionCookie: [] }]`.
- **RPC.** Un `POST` en su ruta (`/_meeko/rpc/…`) con `operationId` `rpc_<id con _>`, `input` como cuerpo y `output` como respuesta `200`.

## Ejemplos

### El registro de schemas públicos

<!-- no-check -->
```ts
// shared/schemas/public.ts: sólo lo que el documento puede mostrar
export { userParams, userSchema } from "./user";
export { orderInput, orderSchema } from "./order";
```

Los schemas privados (los de un webhook interno, por ejemplo) se quedan fuera; si un endpoint los usa, `generateOpenApi` falla en lugar de publicarlos.

### Comprobar el documento en CI

```sh
npx tsx scripts/openapi.ts && npx @redocly/cli lint openapi.json
git diff --exit-code openapi.json   # el contrato publicado no cambia sin revisión
```

## Errores comunes

### Un schema fuera del registro

```ts bad
// server/api/users/[id].get.ts usa userSchema, que no está en publicSchemas
await generateOpenApi({ ...options, publicSchemas: { orderSchema } });
```

`Error: OpenAPI <archivo> response uses a schema outside publicSchemas`, con la ruta del archivo del endpoint (`params`, `query`, `body`, `input` u `output` según el campo).

<!-- no-check -->
```ts good
await generateOpenApi({ ...options, publicSchemas: { orderSchema, userSchema, userParams } });
```

### Una ruta catch-all o una respuesta no JSON

```text bad
server/api/files/[...path].get.ts
server/api/report.get.ts con contentType: "response"
```

`Error: OpenAPI cannot represent catch-all route /api/files/[...path]` y `Error: OpenAPI non-JSON response requires an explicit representation: …`. Documente esas rutas a mano o déjelas fuera del manifiesto que pasa.

```text good
Rutas con segmentos [id] y respuestas JSON con schema
```

### Sin `load`

```ts bad
await generateOpenApi({ manifest, info, publicSchemas, toJsonSchema });
```

`TypeError: OpenAPI generation requires a module loader`.

<!-- no-check -->
```ts good
await generateOpenApi({ manifest, info, publicSchemas, toJsonSchema, load: (file) => import(pathToFileURL(file).href) });
```

### Un conversor que no devuelve un objeto

```ts bad
toJsonSchema: (schema) => JSON.stringify(convert(schema)),
```

`Error: OpenAPI schema userSchema is not representable as JSON Schema`. Si el conversor lanza (un `transform` que JSON Schema no expresa), el error es `OpenAPI schema userSchema cannot be converted: …`.

<!-- no-check -->
```ts good
toJsonSchema: (schema) => toJsonSchema(schema as never), // un objeto, no un texto
```

## Notas

- **Fuera del servidor.** No se ejecuta en `meeko build` ni en producción: llámelo desde un script. Carga los handlers, así que sus imports deben resolverse en ese proceso.
- **Seguridad.** El registro explícito es la garantía de que el documento sólo muestra lo que decidió publicar; revise el diff de `openapi.json` como cualquier contrato público.
- **Parámetros de ruta.** Cada segmento `[nombre]` debe existir en el schema de `params` (un objeto con `properties`); si falta, `OpenAPI path parameter id is missing from … params schema`.
- **Duplicados.** Dos operaciones con el mismo método y ruta son un error (`OpenAPI duplicate operation: GET /api/users`).
