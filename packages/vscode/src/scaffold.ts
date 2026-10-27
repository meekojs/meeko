import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** A file that a «Meeko: nuevo…» command writes; `append` adds to an existing file instead. */
export interface ScaffoldFile {
  readonly path: string;
  readonly content: string;
  readonly append?: boolean;
}

/** The Meeko project that contains `path`: the nearest folder with `meeko.config.*` or `app/pages`. */
export function projectRootOf(path: string): string | undefined {
  for (let current = path; ; current = dirname(current)) {
    if (["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"].some((name) => existsSync(join(current, name)))
      || existsSync(join(current, "app", "pages"))) return current;
    if (dirname(current) === current) return undefined;
  }
}

const pascal = (text: string): string => text.replace(/(?:^|[-_\s]+)([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase());
const camel = (text: string): string => { const value = pascal(text); return value.charAt(0).toLowerCase() + value.slice(1); };

/** Segments of a route such as `/users/[id]`, or a message when it is not one. */
function routeSegments(route: string): string[] | string {
  const path = route.trim().replace(/^\/api(?=\/|$)/, "");
  if (!path.startsWith("/")) return "La ruta empieza por /, por ejemplo /users/[id]";
  const segments = path.split("/").filter(Boolean);
  const invalid = segments.find((segment) => !/^(?:[a-z0-9][a-z0-9-]*|\[(?:\.\.\.)?[A-Za-z_$][\w$]*\])$/.test(segment));
  return invalid ? `«${invalid}» no es un segmento válido: minúsculas, dígitos y guiones, o [param]` : segments;
}

/**
 * `AppCard` → `app/components/App/Card.meeko` when `app/components/App` exists (autoimports name a
 * component by its folders and file), else `app/components/AppCard.meeko`. `App/Card` is a path.
 */
export function componentFile(root: string, name: string, indent = "  "): ScaffoldFile | string {
  const trimmed = name.trim().replace(/\.meeko$/, "");
  if (!/^[A-Z][A-Za-z0-9]*(?:\/[A-Z][A-Za-z0-9]*)*$/.test(trimmed)) return "Usa PascalCase, por ejemplo AppCard o App/Card";
  const components = join(root, "app", "components");
  let path: string;
  if (trimmed.includes("/")) path = join(components, `${trimmed}.meeko`);
  else {
    const words = trimmed.match(/[A-Z][a-z0-9]*/g) ?? [trimmed];
    let directory = components;
    let used = 0;
    while (used < words.length - 1 && existsSync(join(directory, words[used]!))) directory = join(directory, words[used++]!);
    path = join(directory, `${words.slice(used).join("")}.meeko`);
  }
  return { path, content: `<template>\n${indent}<div></div>\n</template>\n` };
}

/** `/users/[id]` → `app/pages/users/[id].meeko`, `/users` → `app/pages/users/index.meeko`, `/` → `app/pages/index.meeko`. */
export function pageFile(root: string, route: string, indent = "  "): ScaffoldFile | string {
  const segments = routeSegments(route);
  if (typeof segments === "string") return segments;
  const last = segments.at(-1);
  const path = last && last.startsWith("[")
    ? join(root, "app", "pages", ...segments) + ".meeko"
    : join(root, "app", "pages", ...segments, "index.meeko");
  const title = last ? pascal(last.replace(/^\[(?:\.\.\.)?|\]$/g, "")) : "Inicio";
  return {
    path,
    content: `<script lang="ts">\nuseHead({ title: ${JSON.stringify(title)} });\n</script>\n\n<template>\n${indent}<section>\n${indent}${indent}<h1>${title}</h1>\n${indent}</section>\n</template>\n`,
  };
}

/** The Standard Schema library of the project, from its `package.json`. */
export function schemaLibrary(root: string): "valibot" | "zod" | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const dependencies = { ...manifest["devDependencies"], ...manifest["dependencies"] };
    return "valibot" in dependencies ? "valibot" : "zod" in dependencies ? "zod" : undefined;
  } catch { return undefined; }
}

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type EndpointMethod = (typeof methods)[number];

/**
 * An API endpoint and its public schemas, which `meeko check` requires: `GET /users/[id]` →
 * `server/api/users/[id].get.ts` with `getUsersById{Params,Response}` in
 * `shared/schemas/users.ts`, added to that file when it exists.
 */
export function endpointFiles(root: string, method: EndpointMethod, route: string, library: "valibot" | "zod", indent = "  "): ScaffoldFile[] | string {
  const segments = routeSegments(route);
  if (typeof segments === "string") return segments;
  if (!segments.length) return "Indica la ruta del endpoint, por ejemplo /users";
  const verb = method.toLowerCase();
  const last = segments.at(-1)!;
  const endpoint = last.startsWith("[")
    ? join(root, "server", "api", ...segments.slice(0, -1), `${last}.${verb}.ts`)
    : join(root, "server", "api", ...segments, `index.${verb}.ts`);
  const statics = segments.filter((segment) => !segment.startsWith("["));
  const params = segments.filter((segment) => segment.startsWith("[")).map((segment) => segment.replace(/^\[(?:\.\.\.)?|\]$/g, ""));
  const base = `${verb}${statics.map(pascal).join("")}${params.length ? `By${params.map(pascal).join("And")}` : ""}`;
  const resource = statics[0] ?? "api";
  const schemas = join(root, "shared", "schemas", `${camel(resource)}.ts`);
  const names = {
    params: params.length ? `${base}Params` : undefined,
    body: method === "POST" || method === "PUT" || method === "PATCH" ? `${base}Body` : undefined,
    response: `${base}Response`,
  };
  const object = (fields: string) => `${library === "valibot" ? "v" : "z"}.object(${fields ? `{ ${fields} }` : "{}"})`;
  const text = library === "valibot" ? "v.string()" : "z.string()";
  const flag = library === "valibot" ? "v.boolean()" : "z.boolean()";
  const exported = [
    ...(names.params ? [`export const ${names.params} = ${object(params.map((param) => `${param}: ${text}`).join(", "))};`] : []),
    ...(names.body ? [`export const ${names.body} = ${object("")};`] : []),
    `export const ${names.response} = ${object(`ok: ${flag}`)};`,
  ];
  const existing = existsSync(schemas) ? readFileSync(schemas, "utf8") : undefined;
  if (existing && exported.some((line) => existing.includes(line.slice(0, line.indexOf(" =")) + " "))) {
    return `${relative(root, schemas).replaceAll("\\", "/")} ya exporta un schema de ${method} ${route}`;
  }
  const header = library === "valibot" ? `import * as v from "valibot";\n` : `import { z } from "zod";\n`;
  const schemaFile: ScaffoldFile = existing === undefined
    ? { path: schemas, content: `${header}\n${exported.join("\n")}\n` }
    : { path: schemas, content: `${existing.endsWith("\n") ? "" : "\n"}\n${exported.join("\n")}\n`, append: true };
  const specifier = relative(dirname(endpoint), schemas).replaceAll("\\", "/").replace(/\.ts$/, ".js");
  const imported = [names.params, names.body, names.response].filter(Boolean).join(", ");
  const fields = [
    ...(names.params ? [`${indent}params: ${names.params},`] : []),
    ...(names.body ? [`${indent}body: ${names.body},`] : []),
    `${indent}response: ${names.response},`,
    `${indent}handler: () => ({ ok: true }),`,
  ];
  return [
    { path: endpoint, content: `import { defineApiRoute } from "@meekojs/meeko/server";\nimport { ${imported} } from "${specifier.startsWith(".") ? specifier : `./${specifier}`}";\n\nexport default defineApiRoute({\n${fields.join("\n")}\n});\n` },
    schemaFile,
  ];
}

export const endpointMethods: readonly EndpointMethod[] = methods;
