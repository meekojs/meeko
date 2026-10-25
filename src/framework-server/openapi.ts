import type { ApiRouteDefinition, RpcDefinition, Schema } from "./contracts.js";
import type { ServerManifest, ServerModuleLoader } from "./discovery.js";
import { serializeJson } from "../server.js";

export interface OpenApiOptions {
  manifest: ServerManifest;
  info: { title: string; version: string };
  /** Only schemas explicitly exported from shared/schemas belong here. */
  publicSchemas: Readonly<Record<string, Schema>>;
  /** For Valibot, supply a converter from @valibot/to-json-schema. */
  toJsonSchema(schema: Schema): unknown;
  /** Resolves each manifest file key to its handler module. */
  load: ServerModuleLoader;
  cookieName?: string;
}

type JsonSchema = Record<string, unknown>;
type PathItem = Record<string, unknown>;

function asSchema(value: unknown, name: string): JsonSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`OpenAPI schema ${name} is not representable as JSON Schema`);
  serializeJson(value);
  return value as JsonSchema;
}

function properties(value: JsonSchema, name: string): { properties: Record<string, JsonSchema>; required: Set<string> } {
  if (value.type !== "object" || !value.properties || typeof value.properties !== "object" || Array.isArray(value.properties)) throw new Error(`OpenAPI ${name} must convert to an object schema with properties`);
  const entries = Object.entries(value.properties as Record<string, unknown>);
  const result: Record<string, JsonSchema> = {};
  for (const [key, schema] of entries) result[key] = asSchema(schema, `${name}.${key}`);
  const required = new Set(Array.isArray(value.required) ? value.required.filter((key): key is string => typeof key === "string") : []);
  return { properties: result, required };
}

function publicPath(pathname: string): string {
  return pathname.replace(/\[\.\.\.[^\]]+\]/g, () => { throw new Error(`OpenAPI cannot represent catch-all route ${pathname}`); })
    .replace(/\[([A-Za-z_$][\w$]*)\]/g, "{$1}");
}

/** Generates OpenAPI only from a caller-provided public schema registry. */
export async function generateOpenApi(options: OpenApiOptions): Promise<Record<string, unknown>> {
  if (typeof options.load !== "function") throw new TypeError("OpenAPI generation requires a module loader");
  const load = options.load;
  const registry = new Map<Schema, string>();
  for (const [name, schema] of Object.entries(options.publicSchemas)) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`Invalid public schema name: ${name}`);
    if (registry.has(schema)) throw new Error(`Duplicate public schema instance: ${name}`);
    registry.set(schema, name);
  }
  const schemas: Record<string, JsonSchema> = {};
  const ref = (schema: Schema | undefined, label: string): { $ref: string } => {
    if (!schema) throw new Error(`OpenAPI ${label} requires a schema`);
    const name = registry.get(schema);
    if (!name) throw new Error(`OpenAPI ${label} uses a schema outside publicSchemas`);
    if (!schemas[name]) {
      let converted: unknown;
      try { converted = options.toJsonSchema(schema); }
      catch (error) { throw new Error(`OpenAPI schema ${name} cannot be converted: ${error instanceof Error ? error.message : String(error)}`); }
      schemas[name] = asSchema(converted, name);
    }
    return { $ref: `#/components/schemas/${name}` };
  };
  const paths: Record<string, PathItem> = {};
  const usePath = (path: string): PathItem => paths[path] ??= {};
  const requireDefinition = async (file: string): Promise<Record<string, unknown>> => {
    const module = await load(file);
    if (!module || typeof module !== "object" || !("default" in module) || !module.default || typeof module.default !== "object") throw new Error(`OpenAPI handler has no default definition: ${file}`);
    return module.default as Record<string, unknown>;
  };
  for (const endpoint of options.manifest.api) {
    const definition = await requireDefinition(endpoint.file) as unknown as ApiRouteDefinition<Schema | undefined, Schema | undefined, Schema | undefined, Schema | undefined>;
    if (definition.contentType === "response") throw new Error(`OpenAPI non-JSON response requires an explicit representation: ${endpoint.file}`);
    const operation: Record<string, unknown> = { operationId: `${endpoint.clientKey.replaceAll(".", "_")}_${endpoint.method.toLowerCase()}`, responses: { "200": { description: "OK", content: { "application/json": { schema: ref(definition.response, `${endpoint.file} response`) } } } } };
    const parameters: Array<Record<string, unknown>> = [];
    const routeParams = [...endpoint.pathname.matchAll(/\[([A-Za-z_$][\w$]*)\]/g)].map((match) => match[1]!);
    if (routeParams.length) {
      const { $ref } = ref(definition.params, `${endpoint.file} params`);
      const converted = schemas[$ref.slice("#/components/schemas/".length)]!;
      const object = properties(converted, `${endpoint.file} params`);
      for (const name of routeParams) {
        const schema = object.properties[name];
        if (!schema) throw new Error(`OpenAPI path parameter ${name} is missing from ${endpoint.file} params schema`);
        parameters.push({ in: "path", name, required: true, schema });
      }
    }
    if (definition.query) {
      const { $ref } = ref(definition.query, `${endpoint.file} query`);
      const converted = schemas[$ref.slice("#/components/schemas/".length)]!;
      const object = properties(converted, `${endpoint.file} query`);
      for (const [name, schema] of Object.entries(object.properties)) parameters.push({ in: "query", name, required: object.required.has(name), schema });
    }
    if (parameters.length) operation.parameters = parameters;
    if (definition.body) operation.requestBody = { required: true, content: { "application/json": { schema: ref(definition.body, `${endpoint.file} body`) } } };
    if (definition.auth === "required") operation.security = [{ sessionCookie: [] }];
    const path = publicPath(endpoint.pathname);
    const item = usePath(path);
    const method = endpoint.method.toLowerCase();
    if (item[method]) throw new Error(`OpenAPI duplicate operation: ${endpoint.method} ${path}`);
    item[method] = operation;
  }
  for (const endpoint of options.manifest.rpc) {
    const definition = await requireDefinition(endpoint.file) as unknown as RpcDefinition<Schema, Schema>;
    const item = usePath(endpoint.pathname);
    if (item.post) throw new Error(`OpenAPI duplicate operation: POST ${endpoint.pathname}`);
    item.post = {
      operationId: `rpc_${endpoint.id.replaceAll(".", "_")}`,
      requestBody: { required: true, content: { "application/json": { schema: ref(definition.input, `${endpoint.file} input`) } } },
      responses: { "200": { description: "OK", content: { "application/json": { schema: ref(definition.output, `${endpoint.file} output`) } } } },
      ...(definition.auth === "required" ? { security: [{ sessionCookie: [] }] } : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: options.info,
    paths,
    components: { schemas, securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: options.cookieName ?? "__Host-meeko.sid" } } },
  };
}
