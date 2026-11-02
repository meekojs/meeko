---
title: generateOpenApi
group: server
since: 1.0.0
description: Generates an OpenAPI 3.1 document for the application's API and RPC endpoints from an explicit registry of public schemas.
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
source-hash: 380b0bd75b386ae161a3226b4e63d38220fab4ed6e201c6e56012e0ae82a8410
---

`generateOpenApi(options)` traverses the server manifest, loads each `server/api` endpoint and `server/rpc` procedure, and writes an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document with their paths, parameters, bodies, responses and security. It only publishes schemas registered by the caller in `publicSchemas`: a contract using a schema outside the registry is an error, so no internal schema leaks accidentally.

It is optional and runs outside the server, in a script or CI. Meeko does not depend on a converter: `toJsonSchema` receives the one from the schema library, such as `@valibot/to-json-schema`.

## Usage

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

Run it with a TypeScript loader (`npx tsx scripts/openapi.ts`): `load` imports `.ts` files from `server/`.

## Parameters

`generateOpenApi(options)` takes an `OpenApiOptions` object:

| Option          | Type                                 | Default              | Description                                                                                                                                       |
| --------------- | ------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest`      | `ServerManifest`                     | required             | Endpoints, as returned by `discoverServerManifest` from `@meekojs/meeko/build`.                                                                   |
| `info`          | `{ title: string; version: string }` | required             | The document's `info`.                                                                                                                            |
| `publicSchemas` | `Record<string, Schema>`             | required             | Schemas that may be published, by name: the name is the `components.schemas` key. A JavaScript identifier; the same instance cannot appear twice. |
| `toJsonSchema`  | `(schema: Schema) => unknown`        | required             | Converts a schema to JSON Schema; must return a serializable object.                                                                              |
| `load`          | `(file: string) => Promise<unknown>` | required             | Loads a manifest file's module; its default export is the definition.                                                                             |
| `cookieName`    | `string`                             | `"__Host-meeko.sid"` | Cookie for the `sessionCookie` security scheme.                                                                                                   |

## Return value

A promise with the document as a JSON object:

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

- **API.** One operation per method, with `operationId` `<clave del cliente con _>_<método>`. `[id]` segments become `{id}` and their schemas come from `params`; `query` provides `in: "query"` parameters; `body` provides `requestBody`; `status` (`200`, `201`, `202` or `204`) provides the response. `auth: "required"` adds `security: [{ sessionCookie: [] }]`.
- **RPC.** A `POST` at its path (`/_meeko/rpc/…`) with `operationId` `rpc_<id con _>`, `input` as the body and `output` as the `200` response.

## Examples

### The public schema registry

<!-- no-check -->

```ts
// shared/schemas/public.ts: sólo lo que el documento puede mostrar
export { userParams, userSchema } from "./user";
export { orderInput, orderSchema } from "./order";
```

Private schemas (for an internal webhook, for example) stay outside; if an endpoint uses them, `generateOpenApi` fails instead of publishing them.

### Check the document in CI

```sh
npx tsx scripts/openapi.ts && npx @redocly/cli lint openapi.json
git diff --exit-code openapi.json   # el contrato publicado no cambia sin revisión
```

## Common mistakes

### A schema outside the registry

```ts bad
// server/api/users/[id].get.ts usa userSchema, que no está en publicSchemas
await generateOpenApi({ ...options, publicSchemas: { orderSchema } });
```

`Error: OpenAPI <archivo> response uses a schema outside publicSchemas`, with the endpoint file's path (`params`, `query`, `body`, `input` or `output` depending on the field).

<!-- no-check -->

```ts good
await generateOpenApi({ ...options, publicSchemas: { orderSchema, userSchema, userParams } });
```

### A catch-all route or non-JSON response

```text bad
server/api/files/[...path].get.ts
server/api/report.get.ts con contentType: "response"
```

`Error: OpenAPI cannot represent catch-all route /api/files/[...path]` and `Error: OpenAPI non-JSON response requires an explicit representation: …`. Document these routes manually or leave them out of the manifest you pass.

```text good
Rutas con segmentos [id] y respuestas JSON con schema
```

### No `load`

```ts bad
await generateOpenApi({ manifest, info, publicSchemas, toJsonSchema });
```

`TypeError: OpenAPI generation requires a module loader`.

<!-- no-check -->

```ts good
await generateOpenApi({ manifest, info, publicSchemas, toJsonSchema, load: (file) => import(pathToFileURL(file).href) });
```

### A converter that does not return an object

```ts bad
toJsonSchema: (schema) => JSON.stringify(convert(schema)),
```

`Error: OpenAPI schema userSchema is not representable as JSON Schema`. If the converter throws (a `transform` JSON Schema cannot express), the error is `OpenAPI schema userSchema cannot be converted: …`.

<!-- no-check -->

```ts good
toJsonSchema: (schema) => toJsonSchema(schema as never), // un objeto, no un texto
```

## Notes

- **Outside the server.** Does not run in `meeko build` or production: call it from a script. It loads handlers, so their imports must resolve in that process.
- **Security.** The explicit registry guarantees the document only shows what you chose to publish; review the `openapi.json` diff like any public contract.
- **Route parameters.** Each `[nombre]` segment must exist in the `params` schema (an object with `properties`); if missing, `OpenAPI path parameter id is missing from … params schema`.
- **Duplicates.** Two operations with the same method and path are an error (`OpenAPI duplicate operation: GET /api/users`).
