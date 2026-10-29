import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { generateTypeScriptAutoImports } from "../autoimports-ts.js";
import { generateAppTypes } from "./check-app.js";
import type { AppTypesOptions } from "./check-app.js";
import { frameworkTsconfigPaths, resolveProjectAliases } from "./aliases.js";
import { loadMeekoConfig, resolveConfigSources } from "./config.js";
import { generateServerContracts } from "./contracts-generate.js";
import { generateRoutes } from "./generate.js";
import { generatePageContracts } from "./page-contracts-generate.js";
import { generateRouteBlockTypes, routeBlockTypesDirectory } from "./route-block-types.js";
import { generateServicesTypes, servicesDeclaration } from "./services-types.js";

export const projectNames = ["app", "server", "shared"] as const;

const compilerOptions = {
  target: "ES2022", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022", "DOM"],
  types: ["node", "vite/client"], strict: true, noEmit: true, allowArbitraryExtensions: true,
  exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, verbatimModuleSyntax: true,
  skipLibCheck: true,
} as const;

const generatedIncludes: Record<(typeof projectNames)[number], string[]> = {
  app: [
    "generated/entry-client.ts", "generated/clients.client.ts", "generated/socket-contracts.ts",
    "types/**/*.d.meeko.ts", "types/routes.d.ts", "types/virtual-pages.d.ts",
    "types/server-contracts.d.ts", "types/autoimports/client.d.ts",
  ],
  server: [
    "generated/entry-server.ts", "generated/clients.server.ts", "generated/socket-contracts.ts",
    "generated/page-contracts.server.ts", "types/virtual-pages.d.ts", "types/routes.d.ts",
    "types/**/*.d.meeko.ts", "types/autoimports/server.d.ts", `${routeBlockTypesDirectory}/**/*.route.ts`,
    // The type of RequestContext.services, from server/runtime.ts.
    servicesDeclaration,
  ],
  shared: ["types/autoimports/shared.d.ts"],
};

async function writeIfChanged(file: string, source: string): Promise<void> {
  try { if (await readFile(file, "utf8") === source) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(file, source, "utf8");
}

/** Keeps TypeScript's three execution scopes under Meeko's generated directory. */
export async function generateFrameworkTsconfigs(projectRoot: string): Promise<string[]> {
  const generatedRoot = join(resolve(projectRoot), ".meeko");
  const config = await loadMeekoConfig(projectRoot);
  const sourceRoots = (await resolveConfigSources(projectRoot, config)).map(({ root }) => relative(generatedRoot, root).replaceAll("\\", "/"));
  const aliases = await resolveProjectAliases(projectRoot, config);
  await mkdir(generatedRoot, { recursive: true });
  const configs: string[] = [];
  for (const name of projectNames) {
    const file = join(generatedRoot, `tsconfig.${name}.json`);
    const includes = [...generatedIncludes[name]];
    const excludes: string[] = [];
    for (const root of sourceRoots) {
      if (name === "app") {
        includes.push(`${root}/app/**/*.ts`, `${root}/server/**/*.client.ts`, `${root}/shared/**/*.client.ts`);
        excludes.push(`${root}/app/pages/**/*.route.ts`, `${root}/app/**/*.server.ts`, `${root}/app/**/*.shared.ts`);
      } else if (name === "server") {
        includes.push(`${root}/server/**/*.ts`, `${root}/app/**/*.server.ts`, `${root}/app/pages/**/*.route.ts`, `${root}/shared/**/*.server.ts`);
        excludes.push(`${root}/server/**/*.client.ts`, `${root}/server/**/*.shared.ts`);
      } else {
        includes.push(`${root}/shared/**/*.ts`, `${root}/app/**/*.shared.ts`, `${root}/server/**/*.shared.ts`);
        excludes.push(`${root}/shared/**/*.client.ts`, `${root}/shared/**/*.server.ts`);
      }
    }
    // `#server/` only in the server project, `@/` not in shared/: see `aliasesForScope`.
    const paths = frameworkTsconfigPaths(projectRoot, aliases, name === "app" ? "client" : name, generatedRoot);
    const source = JSON.stringify({
      compilerOptions: { ...compilerOptions, rootDirs: name === "shared" ? undefined : ["..", "./types"], ...(Object.keys(paths).length ? { paths } : {}) },
      include: includes,
      ...(excludes.length ? { exclude: excludes } : {}),
    }, null, 2) + "\n";
    await writeIfChanged(file, source);
    configs.push(file);
  }
  return configs;
}

/**
 * Generates declarations without loading a Vite server into the editor host. `options` reach the
 * component declarations: the editor's open documents and its tolerance to a component being written.
 */
export async function prepareFrameworkTypeDeclarations(projectRoot: string, options: AppTypesOptions = {}): Promise<string[]> {
  const root = resolve(projectRoot);
  const routes = await generateRoutes(root);
  const server = await generateServerContracts(root);
  const components = await generateAppTypes(root, options);
  await generateRouteBlockTypes(root);
  const pageContracts = await generatePageContracts(root);
  const services = await generateServicesTypes(root);
  const imports = await generateTypeScriptAutoImports(root);
  const tsconfigs = await generateFrameworkTsconfigs(root);
  // What `meeko routes` lists: the declarations and manifests a project reads, not the copies.
  return [routes.types, routes.manifest, server.types, server.manifest, ...components, pageContracts, services, imports.client, imports.server, imports.shared, ...tsconfigs];
}

/** Whether the project has the `.meeko/tsconfig.*.json` that Vite resolves from its `tsconfig.json`. */
export function hasFrameworkTsconfigs(projectRoot: string): boolean {
  return projectNames.every((name) => existsSync(join(resolve(projectRoot), ".meeko", `tsconfig.${name}.json`)));
}
