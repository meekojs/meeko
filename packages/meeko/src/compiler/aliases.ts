import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Where a path alias may be used, from the folder it points to, as with the autoimports:
 * `shared` everywhere, `app` in `app/` and `server/` (not in `shared/`), `server` only on the server.
 */
export type PathAliasScope = "shared" | "app" | "server";

/** The scope of the code that imports through an alias: the TypeScript project it belongs to. */
export type AliasImporterScope = "client" | "server" | "shared";

/** A resolved path alias: `@/` and the folders it points to, in order. */
export interface PathAlias {
  /** The prefix, ending in `/`: `"@/"`. */
  readonly prefix: string;
  /** Absolute folders, tried in order: the project's and then each layer's for a default alias. */
  readonly targets: readonly string[];
  readonly scope: PathAliasScope;
}

/** The alias whose prefix starts `specifier` (the longest one, as TypeScript `paths`), and the rest. */
export function matchPathAlias(aliases: readonly PathAlias[], specifier: string): { readonly alias: PathAlias; readonly rest: string } | undefined {
  let found: PathAlias | undefined;
  for (const alias of aliases) {
    if (specifier.startsWith(alias.prefix) && (!found || alias.prefix.length > found.prefix.length)) found = alias;
  }
  return found ? { alias: found, rest: specifier.slice(found.prefix.length) } : undefined;
}

/** The absolute paths an aliased specifier may name, in order; `undefined` without an alias. */
export function aliasCandidates(aliases: readonly PathAlias[], specifier: string): string[] | undefined {
  const match = matchPathAlias(aliases, specifier);
  return match ? match.alias.targets.map((target) => join(target, match.rest)) : undefined;
}

/** Whether code of `importer` scope may use an alias of `scope`, as the generated tsconfigs declare it. */
export function aliasAvailable(scope: PathAliasScope, importer: AliasImporterScope): boolean {
  if (scope === "shared") return true;
  if (scope === "app") return importer !== "shared";
  return importer === "server";
}

function within(root: string, file: string): string | undefined {
  const path = relative(root, file);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path) ? undefined : path.replaceAll("\\", "/");
}

/**
 * The TypeScript project of a file of the project or a layer, as `.meeko/tsconfig.*.json` include
 * them: `.shared.ts` is shared, `.server.ts` and the `*.route.ts` of `app/pages` are server,
 * `.client.ts` is client, and otherwise its folder decides (`app/` is client, `.meeko` included).
 * `undefined` outside `app/`, `server/` and `shared/`.
 */
export function aliasImporterScope(file: string, sourceRoots: readonly string[]): AliasImporterScope | undefined {
  const name = basename(file);
  for (const root of [...sourceRoots].sort((a, b) => b.length - a.length)) {
    const path = within(resolve(root), resolve(file));
    if (!path || !/^(?:app|server|shared)\//.test(path)) continue;
    if (/\.shared\.[cm]?tsx?$/.test(name)) return "shared";
    if (/\.server\.[cm]?tsx?$/.test(name) || (/\.route\.[cm]?tsx?$/.test(name) && path.startsWith("app/pages/"))) return "server";
    if (/\.client\.[cm]?tsx?$/.test(name)) return "client";
    return path.startsWith("server/") ? "server" : path.startsWith("app/") ? "client" : "shared";
  }
  return undefined;
}

/** The diagnostic code and message of an alias used where its folder is not available, or `undefined`. */
export function aliasScopeProblem(alias: PathAlias, importer: AliasImporterScope, specifier: string): { readonly code: string; readonly message: string } | undefined {
  if (aliasAvailable(alias.scope, importer)) return undefined;
  if (alias.scope === "server") {
    const where = importer === "shared"
      ? "el código de shared/, que también se ejecuta en el navegador,"
      : "el código de app/ (también el <script> y la plantilla de un componente), que también se ejecuta en el navegador,";
    return {
      code: "MEEK108",
      message: `${specifier}: el alias ${alias.prefix} apunta a código que sólo existe en el servidor, y ${where} no puede importarlo, ni siquiera con import type. Úsalo en server/, en un *.server.ts o en <script server>; en el componente, pide los datos con useApi o useRpcQuery, y para un tipo usa ~/server/…`,
    };
  }
  return {
    code: "MEEK118",
    message: `${specifier}: el alias ${alias.prefix} apunta a app/, que shared/ no ve: el código de shared/ también se ejecuta en el servidor y sólo puede importar de shared/. Mueve ese código a shared/ o usa ${alias.prefix} desde app/ o server/`,
  };
}

/**
 * `paths` of a tsconfig for `aliases`: each prefix maps to its folders in order, written by `path`
 * (relative to the tsconfig, or absolute). With `types`, the folder of generated component declarations
 * (`.meeko/types`) follows each folder of the project, so `@/components/Card.meeko` finds its
 * `.d.meeko.ts`, as `rootDirs` does for a relative import.
 */
export function aliasTsconfigPaths(
  aliases: readonly PathAlias[], path: (target: string) => string, types?: { readonly root: string; readonly directory: string },
): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const alias of aliases) {
    const targets: string[] = [];
    for (const target of alias.targets) {
      targets.push(`${path(target).replace(/\/$/, "")}/*`);
      const mirrored = types ? within(types.root, target) : undefined;
      if (types && mirrored !== undefined && mirrored !== ".meeko" && !mirrored.startsWith(".meeko/")) {
        targets.push(`${path(join(types.directory, mirrored)).replace(/\/$/, "")}/*`);
      }
    }
    paths[`${alias.prefix}*`] = [...new Set(targets)];
  }
  return paths;
}
